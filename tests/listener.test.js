import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../apps/api/src/create-app.js';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';
import {
  validateListener, listenerDefaults, resolveListener, resolvePublicOrigin
} from '../platform/listener.js';

const root=process.cwd(),password='very long password for listener test';
const origin='http://127.0.0.1:5173';
test('listener values reject invalid/busy privileged endpoints, derive loopback origin',()=>{
  assert.deepEqual(validateListener({host:'127.0.0.1',port:4888}),{host:'127.0.0.1',port:4888});
  assert.throws(()=>validateListener({host:'192.168.0.1',port:4888}));
  assert.throws(()=>validateListener({host:'0.0.0.0',port:80}));
  assert.throws(()=>validateListener({host:'0.0.0.0',port:65536}));
  assert.throws(()=>validateListener({host:'127.0.0.1',port:'4888'}));
  assert.deepEqual(listenerDefaults({PANEL_LISTEN_HOST:'0.0.0.0',PANEL_LISTEN_PORT:'4888'}),{host:'0.0.0.0',port:4888});
  assert.equal(resolvePublicOrigin({host:'127.0.0.1',port:4888}),'http://127.0.0.1:4888');
  assert.throws(()=>resolvePublicOrigin({host:'0.0.0.0',port:4888}),/PANEL_PUBLIC_ORIGIN/);
});
test('Web listener Action proposes, re-verifies admin credentials, persists for next restart',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lp-listener-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const statePath=join(dir,'panel-state.json');
  const store=new StateStore(statePath);
  await new AuthService(store).bootstrap('admin',password);
  const app=await createApp({root,statePath,modulesPath:join(root,'modules'),
    production:false,publicOrigin:'https://panel.example.com',
    listener:{host:'127.0.0.1',port:4188}});
  t.after(()=>app.close());
  const login=await app.inject({method:'POST',url:'/api/auth/login',
    headers:{origin,'x-panel-client':'web'},payload:{username:'admin',password}});
  assert.equal(login.statusCode,200,login.body);
  const headers={cookie:login.headers['set-cookie'].split(';')[0],
    origin,'x-panel-csrf':login.json().csrf};
  const actions=(await app.inject({url:'/api/actions',headers})).json().actions;
  assert.ok(actions.some(a=>a.id==='panel.listener.status'));
  assert.ok(actions.some(a=>a.id==='panel.listener.request'&&a.kind==='write'));
  const send=(id,input,head=headers)=>app.inject({method:'POST',
    url:'/api/actions/'+id+'/execute',headers:head,payload:{input}});
  const status=await send('panel.listener.status',{});
  assert.equal(status.statusCode,200,status.body);
  assert.deepEqual(status.json().result.active,{host:'127.0.0.1',port:4188});
  assert.equal(status.json().result.restartRequired,false);
  const noAuth=await send('panel.listener.request',{host:'0.0.0.0',port:5188},{});
  assert.equal(noAuth.statusCode,401);
  const badSchema=await send('panel.listener.request',{host:'0.0.0.0',port:'5188'});
  assert.equal(badSchema.statusCode,400);
  const preview=await app.inject({method:'POST',url:'/api/actions/panel.listener.request/preview',
    headers,payload:{input:{host:'0.0.0.0',port:5188}}});
  assert.equal(preview.statusCode,200);
  assert.equal((await store.snapshot()).listenerRequest,undefined);
  const request=await send('panel.listener.request',{host:'0.0.0.0',port:5188});
  assert.equal(request.statusCode,200,request.body);
  const id=request.json().result.id;
  assert.equal((await store.snapshot()).listener,undefined,'proposal cannot change config');
  const unauthorized=await app.inject({method:'POST',url:'/api/panel/listener/approve',
    headers:{cookie:headers.cookie,origin},payload:{id,currentPassword:password}});
  assert.equal(unauthorized.statusCode,403,'CSRF required');
  const wrong=await app.inject({method:'POST',url:'/api/panel/listener/approve',
    headers,payload:{id,currentPassword:'bad'}});
  assert.equal(wrong.statusCode,403);
  const approved=await app.inject({method:'POST',url:'/api/panel/listener/approve',
    headers,payload:{id,currentPassword:password}});
  assert.equal(approved.statusCode,200,approved.body);
  assert.equal(approved.json().status,'restart_required');
  assert.deepEqual((await store.snapshot()).listener,{host:'0.0.0.0',port:5188});
  const after=await send('panel.listener.status',{});
  assert.equal(after.json().result.restartRequired,true);
  assert.deepEqual(after.json().result.active,{host:'127.0.0.1',port:4188});
  assert.deepEqual(resolveListener(await store.snapshot()),{host:'0.0.0.0',port:5188});
  const reused=await app.inject({method:'POST',url:'/api/panel/listener/approve',
    headers,payload:{id,currentPassword:password}});
  assert.equal(reused.statusCode,409);
  const second=await send('panel.listener.request',{host:'127.0.0.1',port:4188});
  assert.equal(second.statusCode,200);
  const cancelled=await app.inject({method:'POST',url:'/api/panel/listener/cancel',
    headers,payload:{id:second.json().result.id}});
  assert.equal(cancelled.statusCode,200);
  assert.equal((await store.snapshot()).listenerRequest,undefined);
});
test('loopback-only production mode explicitly permits local HTTP but refuses wildcard/http',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lp-loopback-prod-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const app=await createApp({root,statePath:join(dir,'state.json'),production:true,
    publicOrigin:'http://127.0.0.1:4999',listener:{host:'127.0.0.1',port:4999}});
  t.after(()=>app.close());
  const r=await app.inject({url:'/api/auth/status',headers:{host:'127.0.0.1:4999'}});
  assert.equal(r.statusCode,200,r.body);
  assert.equal(r.headers['strict-transport-security'],undefined);
  await assert.rejects(createApp({root,production:true,
    publicOrigin:'http://127.0.0.1:4999',listener:{host:'0.0.0.0',port:4999}}),/Production requires HTTPS/);
  await assert.rejects(createApp({root,production:true,
    publicOrigin:'http://external.example.com',listener:{host:'0.0.0.0',port:4999}}),/Production requires HTTPS/);
});
test('install preflight is independent of reverse-proxy software',()=>{
  const shell=join(root,'scripts/install.sh');
  const r=spawnSync('bash',[shell,'--preflight','--host','127.0.0.1',
    '--port','49111','--node-bin','/path/to/not-installed/node'],
    {encoding:'utf8',timeout:20000});
  assert.equal(r.status,1);
  assert.match(r.stdout,/HTTP listener: 127.0.0.1:49111/);
  assert.doesNotMatch(r.stdout,/Nginx|nginx|certificate/);
  assert.match(r.stdout,/BLOCK.*Node.js/);
  const exposed=spawnSync('bash',[shell,'--preflight','--host','0.0.0.0'],
    {encoding:'utf8',timeout:20000});
  assert.equal(exposed.status,1);
  assert.match(exposed.stderr,/HTTPS --public-origin/);
});
