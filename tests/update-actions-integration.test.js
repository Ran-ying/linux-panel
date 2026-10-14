import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';
import { ActionRegistry } from '../core/action-registry.js';
import { ActionEngine } from '../core/action-engine.js';
import { registerUpdateActions } from '../platform/update-actions.js';
import { createUpdateController } from '../platform/update-controller.js';
import { setMcpPolicy } from '../platform/mcp-policy.js';

const password='a long secure test password for update';
const origin='http://127.0.0.1:5173';
test('registered update Actions are available through Web discovery and validate inputs',async t=>{
  const prev=process.env.PANEL_UPDATER_ENABLED;
  process.env.PANEL_UPDATER_ENABLED='1';
  t.after(()=>prev===undefined?delete process.env.PANEL_UPDATER_ENABLED:process.env.PANEL_UPDATER_ENABLED=prev);
  const dir=await mkdtemp(join(tmpdir(),'lp-update-actions-web-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'private.json');
  const store=new StateStore(path),auth=new AuthService(store);
  const user=await auth.bootstrap('admin',password);
  await setMcpPolicy(store,new ActionRegistry(),
    {enabled:false,registrationEnabled:false,allowUpdates:false,tools:{}},user.id);
  const app=await createApp({root:process.cwd(),modulesPath:join(process.cwd(),'modules'),
    statePath:path,publicOrigin:'',production:false});
  t.after(()=>app.close());
  const login=await app.inject({method:'POST',url:'/api/auth/login',
    headers:{'x-panel-client':'web',origin},
    payload:{username:'admin',password}});
  assert.equal(login.statusCode,200,login.body);
  const cookie=login.headers['set-cookie'].split(';')[0],csrf=login.json().csrf;
  const actions=(await app.inject({url:'/api/actions',headers:{cookie}})).json().actions;
  assert.deepEqual(actions.filter(a=>a.id.startsWith('panel.update.')).map(a=>a.id).sort(),
    ['panel.update.check','panel.update.request','panel.update.status']);
  const url='/api/actions/panel.update.request/execute';
  assert.equal((await app.inject({method:'POST',url,payload:{input:{}}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url,headers:{cookie,origin},payload:{input:{}}})).statusCode,403);
  assert.equal((await app.inject({method:'POST',url,headers:{cookie,'x-panel-csrf':csrf,origin},
    payload:{input:{extra:'unexpected'}}})).statusCode,400);
  const preview=await app.inject({method:'POST',url:'/api/actions/panel.update.request/preview',
    headers:{cookie,'x-panel-csrf':csrf,origin},payload:{input:{targetSha:'a'.repeat(40)}}});
  assert.equal(preview.statusCode,200,preview.body);
  assert.equal((await store.snapshot()).updateRequest,undefined,'preview cannot create an update');
  const response=await app.inject({method:'POST',url,headers:{cookie,'x-panel-csrf':csrf,origin},
    payload:{input:{targetSha:'a'.repeat(40)}}});
  assert.equal(response.statusCode,200,response.body);
  assert.equal(response.json().action,'panel.update.request');
  assert.equal(response.json().result.status,'approval_required');
  assert.equal(response.json().result.target,'a'.repeat(40));
  const status=await app.inject({method:'POST',url:'/api/actions/panel.update.status/execute',
    headers:{cookie,'x-panel-csrf':csrf,origin},payload:{input:{}}});
  assert.equal(status.statusCode,200,status.body);
  assert.equal(status.json().result.pending.id,response.json().result.id);
  assert.equal(status.json().result.lastResult,null);
  const check=await app.inject({method:'POST',url:'/api/actions/panel.update.check/execute',
    headers:{cookie,'x-panel-csrf':csrf,origin},payload:{input:{targetSha:'a'.repeat(40)}}});
  assert.equal(check.statusCode,200,check.body);
  assert.equal(check.json().result.verifiedRemote,false);
  assert.match(check.json().result.currentSha,/^[a-f0-9]{40}$/);
  assert.equal((await app.inject({method:'POST',url:'/api/panel/update/cancel',
    payload:{id:response.json().result.id}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/panel/update/cancel',
    headers:{cookie,origin},payload:{id:response.json().result.id}})).statusCode,403);
  const cancelled=await app.inject({method:'POST',url:'/api/panel/update/cancel',
    headers:{cookie,origin,'x-panel-csrf':csrf},payload:{id:response.json().result.id}});
  assert.equal(cancelled.statusCode,200,cancelled.body);
  assert.equal(cancelled.json().status,'cancelled');
  const afterCancel=await app.inject({method:'POST',url:'/api/actions/panel.update.status/execute',
    headers:{cookie,origin,'x-panel-csrf':csrf},payload:{input:{}}});
  assert.equal(afterCancel.json().result.pending,null);
});
test('ActionEngine refuses generic write Actions and unauthenticated proposals',async()=>{
  const registry=new ActionRegistry(),calls=[];
  registry.register('example',{id:'example.arbitrary',kind:'write',executionPolicy:'arbitrary',
    exposure:{web:true,mcp:true},permission:'danger:write',
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    execute:()=>{calls.push('danger');return {ok:true};}});
  const action=new ActionEngine(registry);
  await assert.rejects(action.run('example.arbitrary',{},'web',{authenticated:true,channel:'web',userId:'admin'}),{statusCode:403});
  assert.equal(calls.length,0);
  // Even a proposal-only write cannot execute without the server adapter's auth context.
  registry.register('example',{id:'example.proposal',kind:'write',executionPolicy:'proposal-only',
    exposure:{web:true,mcp:true},permission:'proposals:create',
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    execute:()=>{calls.push('proposal');return {ok:true};}});
  await assert.rejects(action.run('example.proposal',{}),{statusCode:403});
  assert.equal(calls.length,0);
});
