import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readlink,symlink,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createNginxOperations,parseNginxDirectives} from '../platform/privileged/nginx-operations.js';
import {NGINX_CONTRACTS} from '../platform/privileged/nginx-contracts.js';
import {createPrivilegedHandlers} from '../platform/privileged/handlers.js';
import {dispatchPrivileged} from '../platform/privileged/server.js';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import {setup} from '../modules/nginx/index.js';
import {NGINX_UNIT_CONTRACT} from '../platform/privileged/nginx-unit-contracts.js';

test('fixed root unit allows address families and bind capability needed by nginx -t',async()=>{
  const unit=await readFile(new URL('../deployment/systemd/linux-panel-privileged.service',import.meta.url),'utf8');
  assert.match(unit,/^RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);
  assert.match(unit,/^CapabilityBoundingSet=.*\bCAP_NET_BIND_SERVICE\b/m);
  assert.match(unit,/^NoNewPrivileges=true$/m);
  assert.doesNotMatch(unit,/CAP_SYS_ADMIN|CAP_SYS_MODULE|AF_PACKET/);
});


async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'nginx-configs-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const dir of ['sites-available','sites-enabled','conf.d'])await mkdir(join(root,dir));
  const events=[];let syntaxGood=true,reloadGood=true;
  const runner=async(command,args)=>{
    events.push([command,...args]);
    if(args[0]==='-t'&& !syntaxGood)throw Object.assign(new Error('invalid syntax'),{code:1,stderr:'nginx: invalid configuration'});
    if(args[0]==='reload'&& !reloadGood)throw Object.assign(new Error('reload refused'),{code:1,stderr:'reload refused'});
    return {stdout:'',stderr:'ok'};
  };
  const ops=createNginxOperations({root,requireRoot:false,runner});
  return {root,ops,events,syntax(value){syntaxGood=value;},reload(value){reloadGood=value;}};
}
test('Nginx inventory distinguishes available, symlink-enabled, conf.d and blocks outside targets',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'sites-available','alpha'),'server {\nlisten 443 ssl;\nserver_name a.test b.test;\n}');
  await symlink('../sites-available/alpha',join(f.root,'sites-enabled','alpha'));
  await writeFile(join(f.root,'sites-available','disabled'),'server { server_name disabled.test; }');
  await writeFile(join(f.root,'conf.d','other.conf'),'listen 8888;');
  const outside=await mkdtemp(join(tmpdir(),'nginx-external-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'secret'),'server_name secret.test;');
  await symlink(join(outside,'secret'),join(f.root,'sites-enabled','escape'));
  const list=await f.ops.sites();
  assert.equal(list.count,3);
  assert.equal(list.enabledCount,2);
  assert.equal(list.sites.find(s=>s.name==='alpha').enabled,'启用链接');
  assert.equal(list.sites.find(s=>s.name==='alpha').revision,(await f.ops.read({name:'alpha'})).revision);
  assert.equal(list.sites.find(s=>s.name==='disabled').enabled,'未启用');
  assert.equal(list.sites.find(s=>s.name==='other.conf').editable,false);
  assert.ok(list.warnings.some(s=>s.includes('目录外')));
  assert.ok(!JSON.stringify(list).includes('secret.test'));
  assert.equal(parseNginxDirectives('server { # listen 999;\n listen [::]:443 ssl; \n server_name safe.test; }').listens,'[::]:443, ssl');
});

test('Nginx create/edit/enable/disable/remove with revisions and fixed command argv',async t=>{
  const f=await fixture(t);
  const name='new.test',path=join(f.root,'sites-available',name);
  const created=await f.ops.apply({name,operation:'create',revision:'',content:'server { listen 80; }'});
  assert.equal(created.ok,true);assert.equal(created.reloaded,false);
  assert.equal((await stat(path)).mode&0o777,0o644);
  const first=await f.ops.read({name});assert.equal(first.enabled,false);
  await assert.rejects(f.ops.apply({name,operation:'edit',revision:'0'.repeat(64),content:'changed'}),{statusCode:409});
  await assert.rejects(f.ops.apply({name:'../escape',operation:'edit',revision:first.revision,content:'changed'}),{statusCode:400});
  const updated=await f.ops.apply({name,operation:'edit',revision:first.revision,content:'server { listen 8080; }'});
  assert.equal(updated.ok,true);assert.equal(updated.reloaded,false);
  await f.ops.apply({name,operation:'enable',revision:updated.revision});
  assert.equal(await readlink(join(f.root,'sites-enabled',name)),'../sites-available/new.test');
  const current=await f.ops.read({name});
  assert.equal(current.enabled,true);
  const disabled=await f.ops.apply({name,operation:'disable',revision:current.revision});
  assert.equal(disabled.ok,true);assert.equal(disabled.reloaded,true);
  const removed=await f.ops.apply({name,operation:'remove',revision:disabled.revision});
  assert.equal(removed.ok,true);assert.equal(removed.reloaded,false);
  assert.equal(await f.ops.sites().then(r=>r.count),0);
  assert.ok(f.events.some(e=>e[0]==='/usr/sbin/nginx'&&e[1]==='-t'));
  assert.ok(f.events.some(e=>e[0]==='/bin/systemctl'&&e[1]==='reload'&&e[2]==='nginx.service'));
  assert.ok(f.events.every(e=>e.length<=3 && ['/usr/sbin/nginx','/bin/systemctl'].includes(e[0])));
});

test('Nginx test failure and reload failure restore existing enabled site and prevent silent success',async t=>{
  const f=await fixture(t),name='site1',file=join(f.root,'sites-available',name);
  await writeFile(file,'server { listen 80; }');
  await symlink('../sites-available/site1',join(f.root,'sites-enabled',name));
  const original=await f.ops.read({name});
  f.syntax(false);
  const failed=await f.ops.apply({name,operation:'edit',revision:original.revision,content:'INVALID'});
  assert.equal(failed.ok,false);assert.equal(failed.reloaded,false);
  assert.equal(await readFile(file,'utf8'),original.content);
  assert.equal((await f.ops.read({name})).revision,original.revision);
  f.syntax(true);f.reload(false);
  const reloaded=await assert.rejects(f.ops.apply({name,operation:'disable',revision:original.revision}),{statusCode:503});
  assert.equal((await f.ops.read({name})).enabled,true,'failed reload restores enabled link');
  assert.equal(await readlink(join(f.root,'sites-enabled',name)),'../sites-available/site1');
  assert.ok(f.events.filter(e=>e[0]==='/bin/systemctl').length>=2);
});

test('Nginx safety: no arbitrary links, files, arguments, overlarge configs or extra properties',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.root,'sites-available','alpha'),'server {}');
  await symlink('/etc/passwd',join(f.root,'sites-enabled','alpha'));
  await assert.rejects(f.ops.read({name:'alpha'}),{statusCode:409});
  await assert.rejects(f.ops.apply({name:'alpha',operation:'remove',revision:''}),{statusCode:409});
  await assert.rejects(f.ops.apply({name:'../../outside',operation:'create',revision:'',content:'x'}),{statusCode:400});
  const handlers=createPrivilegedHandlers({privileged:false});
  for(const name of ['status','service','certificates','renew','sites','read','check','apply']){
    assert.equal(handlers.has('nginx.'+name),true);
    await assert.rejects(dispatchPrivileged({version:1,channel:'web',action:'nginx.'+name,input:{shell:'id'}},handlers),{statusCode:400});
    await assert.rejects(dispatchPrivileged({version:1,channel:'mcp',action:'nginx.'+name,input:{}},handlers),{statusCode:403});
  }
  assert.deepEqual(Object.keys(NGINX_CONTRACTS),
    ['status','service','certificates','renew','sites','read','check','apply']);
  assert.equal(handlers.has('nginx.repairExecutor'),true);
  for(const input of [{mode:'restart'}, {mode:'bad',confirmation:'APPLY_REVIEWED_NGINX_UNIT'},
    {mode:'stage',confirmation:'APPLY_REVIEWED_NGINX_UNIT',path:'/etc/systemd/system/ssh.service'}]){
    await assert.rejects(dispatchPrivileged({version:1,channel:'web',action:'nginx.repairExecutor',input},handlers),{statusCode:400});
  }
  assert.deepEqual(NGINX_UNIT_CONTRACT.inputSchema.required,['mode','confirmation']);
});

test('Nginx status and service controls use fixed systemctl commands, test syntax before reload',async t=>{
  const f=await fixture(t);
  const snapshot=await f.ops.status();
  assert.equal(snapshot.installed,true);
  assert.equal(snapshot.configOk,true);
  assert.ok(f.events.some(entry=>entry[0]==='/bin/systemctl'&&entry.includes('show')));
  const checked=await f.ops.service({operation:'reload'});
  assert.equal(checked.ok,true);
  const reloadAt=f.events.findIndex(entry=>entry[1]==='reload');
  assert.ok(reloadAt>=1);
  assert.ok(f.events.slice(0,reloadAt).some(entry=>entry[1]==='-t'),
    'syntax check precedes root systemctl reload');
  f.syntax(false);
  const before=f.events.length;
  const denied=await f.ops.service({operation:'restart'});
  assert.equal(denied.ok,false);
  assert.ok(!f.events.slice(before).some(entry=>entry[1]==='restart'));
  await assert.rejects(f.ops.service({operation:'enable;rm -rf /'}),{statusCode:400});
});

test('SSL inventory never includes private keys and renewal uses only selected managed cert',async t=>{
  const f=await fixture(t);
  const certBase=join(f.root,'letsencrypt');
  const live=join(certBase,'live'),archive=join(certBase,'archive'),name='sample.test';
  const certStore=join(archive,name),liveStore=join(live,name);
  await mkdir(live,{recursive:true});await mkdir(certStore,{recursive:true});
  await mkdir(liveStore,{recursive:true});
  const pem=join(certStore,'cert1.pem');
  // Public PEM copied only into this disposable fixture; never persist or log private keys.
  const {execFileSync}=await import('node:child_process');
  const key=join(f.root,'ephemeral.key');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,
    '-out',pem,'-days','45','-subj','/CN=sample.test','-addext','subjectAltName=DNS:sample.test']);
  await symlink('../../archive/'+name+'/cert1.pem',join(liveStore,'cert.pem'));
  const bin=join(f.root,'certbot');
  await writeFile(bin,'fixture binary');
  const ops=createNginxOperations({root:f.root,requireRoot:false,runner:async(command,args)=>{
    f.events.push([command,...args]);return {stdout:'ok',stderr:''};
  },certificateRoot:live,certbot:bin});
  const certs=await ops.certificates();
  assert.equal(certs.installed,true);
  assert.equal(certs.count,1);
  assert.equal(certs.certificates[0].name,name);
  assert.deepEqual(certs.certificates[0].domains,['sample.test']);
  assert.ok(certs.certificates[0].daysRemaining>0);
  assert.ok(!JSON.stringify(certs).includes('PRIVATE KEY'));
  await assert.rejects(ops.renew({name:'../etc/shadow'}),{statusCode:400});
  await assert.rejects(ops.renew({name:'missing.test'}),{statusCode:404});
  const result=await ops.renew({name});
  assert.equal(result.ok,true);
  assert.equal(result.reloaded,true);
  assert.ok(f.events.some(e=>e[0]===bin&&e.join(' ').includes('renew --non-interactive --cert-name sample.test')));
  assert.ok(f.events.some(e=>e[0]==='/bin/systemctl'&&e[1]==='reload'));
  await symlink('/etc/passwd',join(liveStore,'unrelated.pem'));
  assert.equal((await ops.certificates()).count,1);
});

test('Nginx Web routes preserve write policy; MCP has only fixed Certbot write and selected reads',async()=>{
  const registry=new ActionRegistry();await setup({actions:registry,moduleId:'nginx'});
  const list=registry.list('mcp').map(x=>x.id);
  assert.deepEqual(list,['nginx.reconfigureRenewal','nginx.sites','nginx.check']);
  const fake={enabled:true,execute:async(action,input)=>action.id==='nginx.apply'
    ?{ok:true,status:'saved',revision:'',validated:false,reloaded:false,output:''}
    :action.id==='nginx.sites'?{source:'fixture',count:0,enabledCount:0,sites:[],warnings:[]}
      :{name:input.name,content:'config',revision:'1'.repeat(64),enabled:false}};
  const engine=new ActionEngine(registry,{privilegedClient:fake});
  const context={authenticated:true,userId:'admin',channel:'web'};
  await assert.rejects(engine.run('nginx.apply',{name:'foo',operation:'create',revision:'',content:'server{}'},'web'),{statusCode:403});
  const created=await engine.run('nginx.apply',{name:'foo',operation:'create',revision:'',content:'server{}'},'web',context);
  assert.equal(created.result.ok,true);
  await assert.rejects(engine.run('nginx.apply',{name:'foo',operation:'create',revision:'',content:'server{}'},'mcp',{authenticated:true,userId:'admin',channel:'mcp'}),{statusCode:404});
  await assert.rejects(engine.run('nginx.apply',{name:'foo',operation:'create',revision:'',content:'server{}',extra:true},'web',context),{statusCode:400});
});
