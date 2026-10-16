import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { StateStore } from '../platform/state-store.js';
import { AuthService } from '../platform/auth/service.js';
import { ActionRegistry } from '../core/action-registry.js';
import { ModuleManager } from '../core/module-manager.js';
import { OAuthStore, secret } from '../extensions/mcp/oauth-store.js';
import { setMcpPolicy } from '../platform/mcp-policy.js';

const origin='http://127.0.0.1:4188',resource=origin+'/mcp';
function parseRPC(text) {
  const matched=text.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim());
  if (matched.length) return JSON.parse(matched.at(-1));
  return JSON.parse(text);
}

test('real HTTP MCP: global read tools even with legacy narrow grant, revoke whole client', async t=>{
  const folder=await mkdtemp(join(tmpdir(),'lp-mcp-live-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const statePath=join(folder,'private.json'),store=new StateStore(statePath);
  const auth=new AuthService(store);
  const user=await auth.bootstrap('admin','a long secret password for this test');
  const registry=new ActionRegistry();
  const manager=new ModuleManager(join(process.cwd(),'modules'),registry);
  await manager.loadAll();
  await setMcpPolicy(store,registry,{
    enabled:true,registrationEnabled:true,tools:{'system.info':true,'system.resources':false,'services.list':false}
  },user.id);
  const oauth=new OAuthStore(store,registry,resource);
  const client=await oauth.register({client_name:'Local test',redirect_uris:['https://client.example/cb']});
  const grant=await oauth.createGrant(client.id,user.id,['system:read'],resource);
  const access=secret();
  await oauth.saveToken({accessToken:access,accessTokenExpiresAt:new Date(Date.now()+3600000),
    refreshToken:secret(),refreshTokenExpiresAt:new Date(Date.now()+7200000),
    scope:['system:read']},await oauth.client(client.id),
    {id:user.id,grantId:grant.id,resource});
  const app=await createApp({root:process.cwd(),statePath,
    modulesPath:join(process.cwd(),'modules'),production:false});
  await app.listen({host:'127.0.0.1',port:0});
  t.after(()=>app.close());
  const address=app.server.address();
  const url='http://127.0.0.1:'+address.port+'/mcp';
  const rpc=async(request,bearer=access)=>{
    const response=await fetch(url,{
      method:'POST',signal:AbortSignal.timeout(8000),
      headers:{'content-type':'application/json','accept':'application/json, text/event-stream',
        ...(bearer?{authorization:'Bearer '+bearer}:{})},
      body:JSON.stringify({jsonrpc:'2.0',id:1,...request})
    });
    return {status:response.status,headers:response.headers,data:parseRPC(await response.text())};
  };
  const unauthed=await rpc({method:'tools/list'},null);
  assert.equal(unauthed.status,401);
  assert.match(unauthed.headers.get('www-authenticate'),/resource_metadata=/);
  const found=await rpc({method:'tools/list'});
  assert.equal(found.status,200,JSON.stringify(found.data));
  assert.ok(found.data.result?.tools, JSON.stringify(found.data));
  const exposed=found.data.result.tools.map(x=>x.name);
  assert.ok(exposed.includes('system.info'));
  assert.ok(exposed.includes('system.resources'),'legacy checkbox cannot hide an MCP-exposed read Action');
  assert.ok(exposed.includes('services.list'),'old system-only OAuth grant cannot hide new tools');
  const terminal=found.data.result.tools.find(tool=>tool.name==='terminal.execute');
  assert.ok(terminal);
  assert.deepEqual(terminal.inputSchema.required,['command']);
  assert.equal(terminal.inputSchema.properties.command.type,'string');
  const command=await rpc({method:'tools/call',params:{name:'terminal.execute',arguments:{command:"printf 'mcp-terminal\\n'; exit 4"}}});
  if(process.getuid?.()!==0){
    assert.equal(command.data.result.structuredContent.stdout,'mcp-terminal\n');
    assert.equal(command.data.result.structuredContent.exitCode,4);
  }else assert.equal(command.data.result.isError,true);
  const result=await rpc({method:'tools/call',params:{name:'system.info',arguments:{}}});
  assert.equal(result.status,200,JSON.stringify(result.data));
  const output=JSON.parse(result.data.result.content[0].text);
  assert.equal(typeof output.hostname,'string');
  assert.equal((await store.snapshot()).audit.at(-1).event,'mcp.action.execute');
  await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:true,tools:{'system.resources':true}},user.id);
  const hidden=await rpc({method:'tools/list'});
  assert.equal(hidden.status,200,JSON.stringify(hidden.data));
  assert.ok(hidden.data.result?.tools, JSON.stringify(hidden.data));
  assert.deepEqual(hidden.data.result.tools.map(x=>x.name),exposed,
    'changing obsolete per-tool checkboxes does not change the globally exposed tool list');
  await oauth.revokeGrant(grant.id,user.id);
  const revoked=await rpc({method:'tools/list'});
  assert.equal(revoked.status,401);
});
