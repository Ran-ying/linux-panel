import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';
import { ActionRegistry } from '../core/action-registry.js';
import { ModuleManager } from '../core/module-manager.js';
import { OAuthStore,secret } from '../extensions/mcp/oauth-store.js';
import { setMcpPolicy } from '../platform/mcp-policy.js';

const origin='http://127.0.0.1:4188',resource=origin+'/mcp';
function parse(text){const d=text.split('\n').filter(s=>s.startsWith('data:'));return JSON.parse(d.length?d.at(-1).slice(5).trim():text);}
test('MCP update tool requires distinct panel:update scope, allowlist and explicitly installed broker',async t=>{
  const previous=process.env.PANEL_UPDATER_ENABLED;
  process.env.PANEL_UPDATER_ENABLED='1';
  t.after(()=>{if(previous===undefined)delete process.env.PANEL_UPDATER_ENABLED;else process.env.PANEL_UPDATER_ENABLED=previous;});
  const folder=await mkdtemp(join(tmpdir(),'lp-mcp-update-test-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const statePath=join(folder,'state.json'),store=new StateStore(statePath);
  const auth=new AuthService(store);
  const user=await auth.bootstrap('admin','a long credential for update scope tests');
  const registry=new ActionRegistry();
  await new ModuleManager(join(process.cwd(),'modules'),registry).loadAll();
  await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:true,allowUpdates:true,
    tools:{'system.info':true}},user.id);
  const data=new OAuthStore(store,registry,resource);
  const client=await data.register({client_name:'MCP test',redirect_uris:['https://client.example/cb']});
  const mint=async scopes=>{
    const grant=await data.createGrant(client.id,user.id,scopes,resource);
    const token=secret();
    await data.saveToken({accessToken:token,accessTokenExpiresAt:new Date(Date.now()+3600000),
      refreshToken:secret(),refreshTokenExpiresAt:new Date(Date.now()+7200000),scope:scopes},
      await data.client(client.id),{id:user.id,grantId:grant.id,resource});
    return {token,grant};
  };
  const read=await mint(['system:read']);
  const update=await mint(['panel:update']);
  const app=await createApp({root:process.cwd(),statePath,
    modulesPath:join(process.cwd(),'modules'),production:false});
  await app.listen({host:'127.0.0.1',port:0});
  t.after(()=>app.close());
  const url='http://127.0.0.1:'+app.server.address().port+'/mcp';
  const rpc=async(token,method,params)=>{
    const res=await fetch(url,{method:'POST',signal:AbortSignal.timeout(8000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json','accept':'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})})});
    return {status:res.status,data:parse(await res.text())};
  };
  const readList=await rpc(read.token,'tools/list');
  assert.deepEqual(readList.data.result.tools.map(x=>x.name),['system.info']);
  const updateList=await rpc(update.token,'tools/list');
  assert.deepEqual(updateList.data.result.tools.map(x=>x.name),['panel.update.request']);
  const denied=await rpc(read.token,'tools/call',
    {name:'panel.update.request',arguments:{targetSha:'a'.repeat(40)}});
  assert.ok(denied.data.error || denied.data.result?.isError,'Read-only client must not invoke update tool');
  const proposal=await rpc(update.token,'tools/call',
    {name:'panel.update.request',arguments:{targetSha:'a'.repeat(40)}});
  assert.equal(proposal.status,200,JSON.stringify(proposal));
  assert.equal(proposal.data.result?.isError,false);
  assert.equal((await store.snapshot()).updateRequest.target,'a'.repeat(40));
  assert.equal((await app.inject({method:'POST',url:'/api/extensions/mcp/update/approve',
    payload:{id:(await store.snapshot()).updateRequest.id,currentPassword:'bad',code:'000000'}})).statusCode,403);
  await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:false,allowUpdates:false,
    tools:{'system.info':true}},user.id);
  const hidden=await rpc(update.token,'tools/list');
  assert.equal(hidden.status,200);
  assert.equal(hidden.data.result.tools.length,0);
  await data.revokeGrant(update.grant.id,user.id);
  assert.equal((await rpc(update.token,'tools/list')).status,401);
});
