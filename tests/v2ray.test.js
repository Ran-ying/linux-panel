import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createV2RayOperations} from '../platform/privileged/v2ray-operations.js';
import {createPrivilegedHandlers} from '../platform/privileged/handlers.js';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import {setup} from '../modules/v2ray/index.js';

const initial=JSON.stringify({log:{loglevel:'warning'},
  inbounds:[{tag:'local',listen:'127.0.0.1',port:10080,protocol:'socks'}],
  outbounds:[{tag:'direct',protocol:'freedom'}],
  inboundDetour:[{tag:'legacy',protocol:'http',port:10081}],
  routing:{rules:[]},dns:{servers:['1.1.1.1']},customUnknown:{value:true}},null,2)+'\n';
async function fixture(t,mock){
  const root=await mkdtemp(join(tmpdir(),'lp-v2ray-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'bin'),{recursive:true});
  await mkdir(join(root,'etc/v2ray'),{recursive:true});
  await writeFile(join(root,'bin/v2ray'),'fixture',{mode:0o755});
  await writeFile(join(root,'etc/v2ray/config.json'),initial,{mode:0o644});
  await chmod(join(root,'etc/v2ray/config.json'),0o644);
  const calls=[];
  const runner=async(path,args,opts)=>{
    calls.push({path,args});
    if(mock)return mock(path,args,opts,calls);
    if(args[0]==='version')return {ok:true,output:'V2Ray 5.47.0 (V2Fly) Custom'};
    return {ok:true,output:''};
  };
  return {root,calls,ops:createV2RayOperations({requireRoot:false,root,runner})};
}
test('V2Ray root handlers are fixed and config read is not exposed to MCP',async()=>{
  const registry=new ActionRegistry();
  await setup({actions:registry,moduleId:'v2ray'});
  const names=registry.list('web').filter(a=>a.id.startsWith('v2ray.')).map(a=>a.id).sort();
  assert.deepEqual(names,['v2ray.install','v2ray.read','v2ray.save','v2ray.service','v2ray.status','v2ray.test']);
  assert.deepEqual(registry.list('mcp').filter(a=>a.id.startsWith('v2ray.')).map(a=>a.id),['v2ray.status']);
  const handlers=createPrivilegedHandlers({privileged:false});
  for(const id of names){
    assert.equal(handlers.has(id),true);
    assert.equal(handlers.get(id).validate({extra:'test'}),false);
  }
  assert.equal(handlers.get('v2ray.install').validate({confirm:true}),true);
  assert.equal(handlers.get('v2ray.install').validate({confirm:false}),false);
  assert.equal(handlers.get('v2ray.service').validate({operation:'arbitrary'}),false);
});
test('V2Ray lists capabilities without config credentials and checks candidates safely',async t=>{
  const {ops,calls}=await fixture(t);
  const info=await ops.status();
  assert.equal(info.installed,true);
  assert.equal(info.version,'V2Ray 5.47.0');
  assert.equal(info.inbounds,2);
  assert.equal(info.outbounds,1);
  assert.equal(JSON.stringify(info).includes('customUnknown'),false);
  const data=await ops.read();
  assert.equal(JSON.parse(data.content).customUnknown.value,true);
  assert.match(data.revision,/^[0-9a-f]{64}$/);
  assert.equal((await ops.test({content:initial})).ok,true);
  assert.ok(calls.some(c=>c.args[0]==='test'&&c.args[1]==='-c'));
  await assert.rejects(ops.test({content:'{broken'}),/JSON/);
  assert.equal((await ops.read()).revision,data.revision);
});
test('V2Ray save preserves unknown fields and protects from concurrent editing',async t=>{
  const {ops,calls}=await fixture(t),before=await ops.read();
  const updated=before.content.replace('"warning"','"info"');
  const result=await ops.save({revision:before.revision,content:updated});
  assert.equal(result.ok,true);
  assert.equal(result.restarted,true);
  assert.notEqual(result.revision,before.revision);
  assert.equal((await ops.read()).content,updated);
  assert.ok(calls.some(c=>c.args.join(' ')==='restart v2ray.service'));
  await assert.rejects(ops.save({revision:before.revision,content:initial}),{statusCode:409});
  assert.equal((await ops.service({operation:'stop'})).ok,true);
});
test('Invalid candidate and failed restart restore original file and mode',async t=>{
  let badTest=true,failRestart=false;
  const {ops,root}=await fixture(t,(p,args)=>{
    if(args[0]==='version')return {ok:true,output:'V2Ray 5.47.0'};
    if(args[0]==='test'&&badTest)return {ok:false,output:'invalid config'};
    if(args[0]==='restart'&&failRestart){failRestart=false;return {ok:false,output:'restart failed'};}
    return {ok:true,output:''};
  });
  const before=await ops.read(),next=before.content.replace('"warning"','"debug"');
  const rejected=await ops.save({revision:before.revision,content:next});
  assert.equal(rejected.ok,false);
  assert.equal((await ops.read()).content,before.content);
  badTest=false;failRestart=true;
  const rolledBack=await ops.save({revision:before.revision,content:next});
  assert.equal(rolledBack.ok,false);
  assert.equal((await ops.read()).content,before.content);
  assert.equal((await stat(join(root,'etc/v2ray/config.json'))).mode&0o777,0o644);
  assert.equal((await readFile(join(root,'etc/v2ray/config.json'),'utf8')).includes('"legacy"'),true);
});
test('Ordinary ActionEngine rejects V2Ray service writes without privileged executor',async()=>{
  const registry=new ActionRegistry();await setup({actions:registry,moduleId:'v2ray'});
  const engine=new ActionEngine(registry);
  await assert.rejects(engine.run('v2ray.save',{content:initial,revision:'a'.repeat(64)},
    'web',{authenticated:true,userId:'owner',channel:'web'}),{statusCode:503});
});


async function archiveFixture(t){
  const root=await mkdtemp(join(tmpdir(),'lp-v2ray-install-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const payload=join(root,'payload');await mkdir(payload);
  for(const name of ['v2ray','geoip.dat','geosite.dat'])await writeFile(join(payload,name),'synthetic asset: '+name);
  const zip=join(root,'archive.zip');
  execFileSync('python3',['-c',
    'import zipfile,os,sys\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for n in ["v2ray","geoip.dat","geosite.dat"]:z.write(os.path.join(sys.argv[2],n),arcname=n)',
    zip,payload]);
  const digest=createHash('sha256').update(await readFile(zip)).digest('hex');
  const destination=join(root,'destination');await mkdir(destination);
  const unitPath=join(root,'units/v2ray.service');
  let rejectStart=false;
  const commands=[];
  const runner=async(command,args,options)=>{
    commands.push([command,...args]);
    if(command==='/usr/bin/unzip'){
      try{const {stdout='',stderr=''}=await promisify(execFile)(command,args,options);
        return {ok:true,output:String(stdout||stderr)};
      }catch(e){return {ok:false,output:String(e.message)};}
    }
    if(args[0]==='version')return {ok:true,output:'V2Ray 5.47.0'};
    if(args[0]==='show')return {ok:true,output:'not-found'};
    if(args[0]==='enable'&&rejectStart)return {ok:false,output:'synthetic start failure'};
    return {ok:true,output:''};
  };
  const ops=createV2RayOperations({requireRoot:false,root:destination,unitPath,
    assetUrl:'https://fixture.invalid/archive.zip',assetSha:digest,runner,
    download:async(_url,path)=>{await import('node:fs/promises').then(fs=>fs.copyFile(zip,path));}});
  return {root,destination,unitPath,ops,commands,runner,failStart:()=>{rejectStart=true;},archive:zip};
}
test('Uninstalled V2Ray requires explicit confirmation, verified release digest and loopback bootstrap',async t=>{
  const {destination,unitPath,ops,commands}=await archiveFixture(t);
  assert.equal((await ops.status()).installed,false);
  await assert.rejects(ops.install({confirm:false}),{statusCode:400});
  const installed=await ops.install({confirm:true});
  assert.equal(installed.ok,true);
  const info=await ops.status();assert.equal(info.installed,true);
  const cfg=JSON.parse((await ops.read()).content);
  assert.equal(cfg.inbounds[0].listen,'127.0.0.1');
  assert.equal(cfg.inbounds[0].port,10808);
  assert.equal(cfg.inbounds[0].protocol,'socks');
  assert.ok(commands.some(parts=>parts[1]==='enable'&&parts.includes('v2ray.service')));
  assert.equal((await stat(join(destination,'bin/v2ray'))).mode&0o777,0o755);
  assert.equal((await stat(join(destination,'etc/v2ray/config.json'))).mode&0o777,0o644);
  assert.equal((await stat(join(destination,'etc/v2ray'))).mode&0o777,0o755);
  assert.equal((await stat(unitPath)).mode&0o777,0o644);
  await assert.rejects(ops.install({confirm:true}),{statusCode:409});
});
test('Failed V2Ray bootstrap rolls back installed files and fails closed on hash mismatch',async t=>{
  const one=await archiveFixture(t);
  one.failStart();
  await assert.rejects(one.ops.install({confirm:true}),{statusCode:503});
  await assert.rejects(stat(join(one.destination,'bin/v2ray')),{code:'ENOENT'});
  await assert.rejects(stat(join(one.destination,'etc/v2ray/config.json')),{code:'ENOENT'});
  await assert.rejects(stat(one.unitPath),{code:'ENOENT'});
  assert.ok(one.commands.some(parts=>parts[1]==='daemon-reload'));
  const another=await archiveFixture(t);
  // Reuse the fixture's fake systemd runner. Without it this path reads the
  // HOST's real v2ray.service, so installed V2Ray blocks a checksum test with
  // 409 before the expected 503 SHA-256 rejection can ever be reached.
  const bad=createV2RayOperations({requireRoot:false,root:another.destination,unitPath:another.unitPath,
    assetSha:'0'.repeat(64),assetUrl:'https://fixture.invalid/archive.zip',runner:another.runner,
    download:async(_url,path)=>{await import('node:fs/promises').then(fs=>fs.copyFile(another.archive,path));}});
  await assert.rejects(bad.install({confirm:true}),{statusCode:503});
  assert.ok(another.commands.some(parts=>parts[1]==='show'&&parts.includes('v2ray.service')),
    'the installer probes the mocked systemd state rather than the host');
  assert.ok(!another.commands.some(parts=>parts[1]==='enable'),
    'a failed release digest must never enable the service');
  await assert.rejects(stat(join(another.destination,'bin/v2ray')),{code:'ENOENT'});
});
