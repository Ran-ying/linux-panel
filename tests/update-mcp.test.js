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
import { registerUpdateActions } from '../platform/update-actions.js';
import { createUpdateController } from '../platform/update-controller.js';

const origin='http://127.0.0.1:4188',resource=origin+'/mcp';
function parse(text){const d=text.split('\n').filter(s=>s.startsWith('data:'));return JSON.parse(d.length?d.at(-1).slice(5).trim():text);}
test('MCP proposal is visible to old read clients when globally enabled and Broker installed',async t=>{
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
  const readTools=readList.data.result.tools.map(x=>x.name);
  assert.ok(readTools.includes('system.info'));
  assert.ok(readTools.includes('panel.update.request'));
  const updateList=await rpc(update.token,'tools/list');
  assert.deepEqual(updateList.data.result.tools.map(x=>x.name),readTools);
  // An existing read-only-scoped OAuth grant gets the globally enabled
  // proposal Action, without requiring a separate scope upgrade.
  const proposal=await rpc(read.token,'tools/call',
    {name:'panel.update.request',arguments:{targetSha:'a'.repeat(40)}});
  assert.equal(proposal.status,200,JSON.stringify(proposal));
  assert.notEqual(proposal.data.result?.isError,true);
  assert.equal((await store.snapshot()).updateRequest.target,'a'.repeat(40));
  assert.equal((await app.inject({method:'POST',url:'/api/extensions/mcp/update/approve',
    payload:{id:(await store.snapshot()).updateRequest.id,currentPassword:'bad',code:'000000'}})).statusCode,401);
  await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:false,allowUpdates:false,
    tools:{'system.info':true}},user.id);
  const hidden=await rpc(update.token,'tools/list');
  assert.equal(hidden.status,200);
  assert.equal(hidden.data.result.tools.some(x=>x.name==='panel.update.request'),false);
  assert.equal(hidden.data.result.tools.some(x=>x.name==='system.info'),true);
  await data.revokeGrant(update.grant.id,user.id);
  assert.equal((await rpc(update.token,'tools/list')).status,401);
});


test('MCP direct update is globally enabled for existing OAuth clients and revoked immediately by policy',async t=>{
  const oldFlag=process.env.PANEL_UPDATER_ENABLED;
  const oldTrigger=process.env.PANEL_UPDATE_TRIGGER;
  process.env.PANEL_UPDATER_ENABLED='1';
  const folder=await mkdtemp(join(tmpdir(),'lp-direct-mcp-'));
  process.env.PANEL_UPDATE_TRIGGER=join(folder,'trigger');
  t.after(()=>{
    if(oldFlag===undefined)delete process.env.PANEL_UPDATER_ENABLED;
    else process.env.PANEL_UPDATER_ENABLED=oldFlag;
    if(oldTrigger===undefined)delete process.env.PANEL_UPDATE_TRIGGER;
    else process.env.PANEL_UPDATE_TRIGGER=oldTrigger;
    return rm(folder,{recursive:true,force:true});
  });
  const statePath=join(folder,'state.json'),store=new StateStore(statePath);
  const auth=new AuthService(store);
  const user=await auth.bootstrap('admin','safe direct update test password');
  const registry=new ActionRegistry();
  await new ModuleManager(join(process.cwd(),'modules'),registry).loadAll();
  // The app registers built-in platform Actions in addition to module Actions.
  registerUpdateActions(registry,createUpdateController({store,root:process.cwd(),auth,enabled:true}));
  await setMcpPolicy(store,registry,{
    enabled:true,registrationEnabled:true,allowUpdates:false,allowDirectUpdates:true,
    tools:{'system.info':true,'panel.update.status':true}
  },user.id);
  const data=new OAuthStore(store,registry,resource);
  const client=await data.register({client_name:'Direct test',redirect_uris:['https://client.example/cb']});
  const mint=async scopes=>{
    const grant=await data.createGrant(client.id,user.id,scopes,resource);
    const token=secret();
    await data.saveToken({accessToken:token,accessTokenExpiresAt:new Date(Date.now()+3600000),
      refreshToken:secret(),refreshTokenExpiresAt:new Date(Date.now()+7200000),scope:scopes},
      await data.client(client.id),{id:user.id,grantId:grant.id,resource});
    return {token,grant};
  };
  const reader=await mint(['system:read']);
  const statusReader=await mint(['panel:read']);
  const direct=await mint(['panel:update:execute']);
  const app=await createApp({root:process.cwd(),statePath,
    modulesPath:join(process.cwd(),'modules'),production:false});
  await app.listen({host:'127.0.0.1',port:0});
  t.after(()=>app.close());
  const url='http://127.0.0.1:'+app.server.address().port+'/mcp';
  const rpc=async(token,method,params)=>{
    const res=await fetch(url,{method:'POST',signal:AbortSignal.timeout(8000),
      headers:{authorization:'Bearer '+token,'content-type':'application/json',
        accept:'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})})});
    return {status:res.status,data:parse(await res.text())};
  };
  const readList=await rpc(reader.token,'tools/list');
  const globalTools=readList.data.result.tools.map(x=>x.name);
  assert.ok(globalTools.includes('system.info'));
  assert.ok(globalTools.includes('panel.update.status'));
  assert.ok(globalTools.includes('panel.update.execute'));
  const statusList=await rpc(statusReader.token,'tools/list');
  assert.deepEqual(statusList.data.result.tools.map(x=>x.name),globalTools);
  const directList=await rpc(direct.token,'tools/list');
  assert.deepEqual(directList.data.result.tools.map(x=>x.name),globalTools);
  // An older read-scoped login can now invoke direct execute *only* while
  // the global direct gate and isolated Broker are enabled.
  const queued=await rpc(reader.token,'tools/call',
    {name:'panel.update.execute',arguments:{targetSha:'a'.repeat(40)}});
  assert.equal(queued.status,200,JSON.stringify(queued));
  assert.notEqual(queued.data.result?.isError,true);
  assert.equal((await store.snapshot()).updateRequest?.approved,true);
  assert.equal((await store.snapshot()).updateRequest?.target,'a'.repeat(40));
  const detail=await rpc(statusReader.token,'tools/call',
    {name:'panel.update.status',arguments:{}});
  assert.equal(detail.status,200,JSON.stringify(detail));
  assert.equal(detail.data.result?.structuredContent?.pending?.approved,true,
    JSON.stringify(detail.data));

  await setMcpPolicy(store,registry,{
    enabled:true,registrationEnabled:false,allowUpdates:false,allowDirectUpdates:false,
    tools:{'system.info':true,'panel.update.status':true}
  },user.id);
  const afterDisable=(await rpc(direct.token,'tools/list')).data.result.tools.map(x=>x.name);
  assert.equal(afterDisable.includes('panel.update.execute'),false,
    'revoking direct Web policy immediately removes direct update');
  assert.equal(afterDisable.includes('panel.update.status'),true);
  await data.revokeGrant(direct.grant.id,user.id);
  assert.equal((await rpc(direct.token,'tools/list')).status,401);
});
