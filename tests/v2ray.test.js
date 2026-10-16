import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
