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
  for(const name of ['sites','read','check','apply']){
    assert.equal(handlers.has('nginx.'+name),true);
    await assert.rejects(dispatchPrivileged({version:1,channel:'web',action:'nginx.'+name,input:{shell:'id'}},handlers),{statusCode:400});
    await assert.rejects(dispatchPrivileged({version:1,channel:'mcp',action:'nginx.'+name,input:{}},handlers),{statusCode:403});
  }
  assert.deepEqual(Object.keys(NGINX_CONTRACTS),['sites','read','check','apply']);
});

test('Nginx Web routes follow shared write policy; MCP only gets selected ordinary reads',async()=>{
  const registry=new ActionRegistry();await setup({actions:registry,moduleId:'nginx'});
  const list=registry.list('mcp').map(x=>x.id);
  assert.deepEqual(list,['nginx.sites','nginx.check']);
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
