import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';
import { OAuthStore } from '../extensions/mcp/oauth-store.js';
import { ActionRegistry } from '../core/action-registry.js';
import { ModuleManager } from '../core/module-manager.js';

const origin='http://127.0.0.1:4188',resource=origin+'/mcp';
async function fixture(t) {
  const folder=await mkdtemp(join(tmpdir(),'lp-oauth-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const statePath=join(folder,'panel-state.json');
  const store=new StateStore(statePath);
  const auth=new AuthService(store);
  await auth.bootstrap('admin','a very long passphrase for oauth test');
  const app=await createApp({root:process.cwd(),statePath,
    modulesPath:join(process.cwd(),'modules'),production:false});
  t.after(()=>app.close());
  const login=await app.inject({method:'POST',url:'/api/auth/login',
    headers:{'x-panel-client':'web'},
    payload:{username:'admin',password:'a very long passphrase for oauth test'}});
  assert.equal(login.statusCode,200);
  const cookie=login.headers['set-cookie'].split(';')[0],csrf=login.json().csrf;
  const enabled=await app.inject({method:'PUT',url:'/api/extensions/mcp/settings',
    headers:{cookie,'x-panel-csrf':csrf},
    payload:{enabled:true,registrationEnabled:true,tools:{'system.info':true,'system.resources':true}}});
  assert.equal(enabled.statusCode,200);
  return {app,store,cookie,csrf};
}

test('OAuth discovery, PKCE approval, refresh and immediate server revocation',async t=>{
  const {app,store,cookie,csrf}=await fixture(t);
  const metadata=(await app.inject('/.well-known/oauth-authorization-server')).json();
  assert.equal(metadata.issuer,origin);
  assert.deepEqual(metadata.code_challenge_methods_supported,['S256']);
  assert.equal(metadata.registration_endpoint,origin+'/oauth/register');
  const protectedMeta=(await app.inject('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(protectedMeta.resource,resource);
  assert.ok(protectedMeta.scopes_supported.includes('system:read'));
  const registered=await app.inject({method:'POST',url:'/oauth/register',
    payload:{client_name:'Test MCP Client',redirect_uris:['https://client.example/callback'],
      grant_types:['authorization_code','refresh_token'],
      response_types:['code'],token_endpoint_auth_method:'none'}});
  assert.equal(registered.statusCode,201,registered.body);
  const id=registered.json().client_id;
  const verifier=randomBytes(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const query=new URLSearchParams({client_id:id,response_type:'code',
    redirect_uri:'https://client.example/callback',scope:'system:read storage:read',
    state:'safety-check-123456',resource,code_challenge:challenge,code_challenge_method:'S256'});
  const url='/oauth/authorize?'+query.toString();
  const noLogin=await app.inject(url);
  assert.equal(noLogin.statusCode,302);
  assert.match(noLogin.headers.location,/next=/);
  const consent=await app.inject({url,headers:{cookie}});
  assert.equal(consent.statusCode,200,consent.body);
  assert.match(consent.body,/授权 MCP 客户端/);
  assert.match(consent.body,/client\.example/);
  const badCSRF=await app.inject({method:'POST',url:'/oauth/authorize',
    headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({...Object.fromEntries(query),'csrf':'invalid','decision':'approve'}).toString()});
  assert.equal(badCSRF.statusCode,403);
  const approved=await app.inject({method:'POST',url:'/oauth/authorize',
    headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({...Object.fromEntries(query),csrf,decision:'approve'}).toString()});
  assert.equal(approved.statusCode,302,approved.body);
  const location=new URL(approved.headers.location);
  assert.equal(location.origin,'https://client.example');
  assert.equal(location.searchParams.get('state'),'safety-check-123456');
  const code=location.searchParams.get('code');
  assert.ok(code);
  const getToken=async (body)=>app.inject({method:'POST',url:'/oauth/token',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams(body).toString()});
  const badResource=await getToken({client_id:id,grant_type:'authorization_code',
    code,redirect_uri:'https://client.example/callback',code_verifier:verifier,
    resource:'https://other.example/mcp'});
  assert.equal(badResource.statusCode,400);
  const wrongVerifier=await getToken({client_id:id,grant_type:'authorization_code',
    code,redirect_uri:'https://client.example/callback',code_verifier:'x'.repeat(43),resource});
  assert.equal(wrongVerifier.statusCode,400,'PKCE proof must be enforced');
  assert.equal((await getToken({client_id:id,grant_type:'authorization_code',
    code,redirect_uri:'https://client.example/callback',code_verifier:verifier,resource})).statusCode,
    400,'failed PKCE attempt must burn the compromised code');
  const newApproval=await app.inject({method:'POST',url:'/oauth/authorize',
    headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({...Object.fromEntries(query),csrf,decision:'approve'}).toString()});
  assert.equal(newApproval.statusCode,302,newApproval.body);
  const validCode=new URL(newApproval.headers.location).searchParams.get('code');
  const issued=await getToken({client_id:id,grant_type:'authorization_code',
    code:validCode,redirect_uri:'https://client.example/callback',code_verifier:verifier,resource});
  assert.equal(issued.statusCode,200,issued.body);
  const tokens=issued.json();
  assert.equal(tokens.token_type,'Bearer');
  assert.ok(tokens.refresh_token);
  const replay=await getToken({client_id:id,grant_type:'authorization_code',
    code:validCode,redirect_uri:'https://client.example/callback',code_verifier:verifier,resource});
  assert.equal(replay.statusCode,400,'authorization code must be single use');
  const registry=new ActionRegistry();
  await new ModuleManager(join(process.cwd(),'modules'),registry).loadAll();
  const storeOAuth=new OAuthStore(store,registry,resource);
  const valid=await storeOAuth.verifyAccessToken(tokens.access_token);
  assert.ok(valid);
  assert.ok(valid.scopes.includes('system:read'));
  assert.ok(valid.scopes.includes('storage:read'));
  assert.ok(valid.scopes.includes('services:read'),
    'owner-approved clients receive all enabled MCP read actions');
  const grants=(await app.inject({url:'/api/extensions/mcp/grants',headers:{cookie}})).json().grants;
  // Each approval creates a separate revocable grant. The first code was
  // deliberately burned by the invalid PKCE attempt; the second is active.
  assert.equal(grants.length,2);
  const latestGrant=grants.at(-1);
  assert.ok(latestGrant.scopes.includes('system:read'));
  assert.ok(latestGrant.scopes.includes('services:read'));
  const restricted=await app.inject({method:'PUT',url:'/api/extensions/mcp/grants/'+latestGrant.id,
    headers:{cookie,'x-panel-csrf':csrf},payload:{scopes:['system:read']}});
  assert.equal(restricted.statusCode,404,'per-client scope editing was removed');
  const refreshed=await getToken({client_id:id,grant_type:'refresh_token',
    refresh_token:tokens.refresh_token,resource});
  assert.equal(refreshed.statusCode,200,refreshed.body);
  assert.ok((await storeOAuth.verifyAccessToken(refreshed.json().access_token)).scopes.includes('services:read'));
  const revoked=await app.inject({method:'DELETE',url:'/api/extensions/mcp/grants/'+latestGrant.id,
    headers:{cookie,'x-panel-csrf':csrf}});
  assert.equal(revoked.statusCode,200);
  assert.equal(await storeOAuth.verifyAccessToken(tokens.access_token),null);
  assert.equal(await storeOAuth.verifyAccessToken(refreshed.json().access_token),null);
  assert.equal((await getToken({client_id:id,grant_type:'refresh_token',
    refresh_token:refreshed.json().refresh_token,resource})).statusCode,400);
});

test('OAuth metadata and client enrollment are closed while MCP is disabled',async t=>{
  const {app,cookie,csrf}=await fixture(t);
  await app.inject({method:'PUT',url:'/api/extensions/mcp/settings',
    headers:{cookie,'x-panel-csrf':csrf},
    payload:{enabled:false,registrationEnabled:false,tools:{'system.info':true}}});
  assert.equal((await app.inject('/.well-known/oauth-authorization-server')).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/oauth/register',
    payload:{client_name:'foo',redirect_uris:['https://client.example/cb']}})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/mcp',
    payload:{jsonrpc:'2.0',id:1,method:'tools/list'}})).statusCode,404);
});

test('changing Web password invalidates previous MCP access and refresh credentials',async t=>{
  const {app,store,cookie,csrf}=await fixture(t);
  const registered=await app.inject({method:'POST',url:'/oauth/register',
    payload:{client_name:'Test client',redirect_uris:['https://client.example/cb']}});
  const clientId=registered.json().client_id;
  const registry=new ActionRegistry();
  await new ModuleManager(join(process.cwd(),'modules'),registry).loadAll();
  const data=new OAuthStore(store,registry,resource);
  const identity=(await store.snapshot()).users[0];
  const grant=await data.createGrant(clientId,identity.id,['system:read'],resource);
  const {secret}=await import('../extensions/mcp/oauth-store.js');
  const access=secret(),refresh=secret();
  await data.saveToken({accessToken:access,accessTokenExpiresAt:new Date(Date.now()+3600000),
    refreshToken:refresh,refreshTokenExpiresAt:new Date(Date.now()+7200000),scope:['system:read']},
    await data.client(clientId),{id:identity.id,grantId:grant.id,resource});
  assert.ok(await data.verifyAccessToken(access));
  const changed=await app.inject({method:'POST',url:'/api/auth/password',
    headers:{cookie,'x-panel-csrf':csrf},
    payload:{currentPassword:'a very long passphrase for oauth test',
      newPassword:'some other long password for test 2026'}});
  assert.equal(changed.statusCode,200);
  assert.equal(await data.verifyAccessToken(access),null);
  assert.equal(await data.getRefreshToken(refresh),null);
});

test('offline_access is available only for refresh, not for MCP tools',async t=>{
  const {app,store,cookie,csrf}=await fixture(t);
  const meta=(await app.inject('/.well-known/oauth-authorization-server')).json();
  assert.ok(meta.scopes_supported.includes('offline_access'));
  const created=await app.inject({method:'POST',url:'/oauth/register',
    payload:{client_name:'Refresh test',redirect_uris:['https://client.example/finish']}});
  assert.equal(created.statusCode,201,created.body);
  const clientId=created.json().client_id;
  const verifier=randomBytes(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const params={
    client_id:clientId,response_type:'code',redirect_uri:'https://client.example/finish',
    scope:'system:read offline_access',state:'offline-state-123456',resource,
    code_challenge:challenge,code_challenge_method:'S256'
  };
  const consent=await app.inject({method:'POST',url:'/oauth/authorize',
    headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({...params,csrf,decision:'approve'}).toString()});
  assert.equal(consent.statusCode,302,consent.body);
  const code=new URL(consent.headers.location).searchParams.get('code');
  const token=await app.inject({method:'POST',url:'/oauth/token',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({client_id:clientId,grant_type:'authorization_code',
      redirect_uri:params.redirect_uri,code,code_verifier:verifier,resource}).toString()});
  assert.equal(token.statusCode,200,token.body);
  assert.ok(token.json().scope.split(' ').includes('offline_access'));
  const registry=new ActionRegistry();
  await new ModuleManager(join(process.cwd(),'modules'),registry).loadAll();
  const storeOAuth=new OAuthStore(store,registry,resource);
  assert.ok((await storeOAuth.verifyAccessToken(token.json().access_token)).scopes.includes('storage:read'));
  const refresh=await app.inject({method:'POST',url:'/oauth/token',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({client_id:clientId,grant_type:'refresh_token',
      refresh_token:token.json().refresh_token,resource}).toString()});
  assert.equal(refresh.statusCode,200,refresh.body);
  assert.ok((await storeOAuth.verifyAccessToken(refresh.json().access_token)).scopes.includes('storage:read'));
  const grants=(await app.inject({url:'/api/extensions/mcp/grants',headers:{cookie}})).json().grants;
  const narrowed=await app.inject({method:'PUT',url:'/api/extensions/mcp/grants/'+grants[0].id,
    headers:{cookie,'x-panel-csrf':csrf},payload:{scopes:['system:read']}});
  assert.equal(narrowed.statusCode,404,'per-client scope editing is not supported');
  const after=await app.inject({method:'POST',url:'/oauth/token',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({client_id:clientId,grant_type:'refresh_token',
      refresh_token:refresh.json().refresh_token,resource}).toString()});
  assert.equal(after.statusCode,200,after.body);
  assert.equal(after.json().scope.includes('offline_access'),true);
});

test('public client registration is bounded per source and can be disabled without revoking existing grants',async t=>{
  const {app,cookie,csrf,store}=await fixture(t);
  const create=async name=>app.inject({method:'POST',url:'/oauth/register',
    payload:{client_name:name,redirect_uris:['https://client.example/cb']}});
  const first=await create('trusted');
  assert.equal(first.statusCode,201);
  for(let i=0;i<4;i++)assert.equal((await create('anon'+i)).statusCode,201);
  assert.equal((await create('blocked')).statusCode,429);
  const disabled=await app.inject({method:'PUT',url:'/api/extensions/mcp/settings',
    headers:{cookie,'x-panel-csrf':csrf},
    payload:{enabled:true,registrationEnabled:false,tools:{'system.info':true}}});
  assert.equal(disabled.statusCode,200);
  // Another IP cannot register while the administrator switch is closed.
  assert.equal((await create('blocked2')).statusCode,429);
  const registry=new ActionRegistry();
  await new ModuleManager(join(process.cwd(),'modules'),registry).loadAll();
  const data=new OAuthStore(store,registry,resource);
  const user=(await store.snapshot()).users[0];
  const grant=await data.createGrant(first.json().client_id,user.id,['system:read'],resource);
  assert.ok(grant.id);
  assert.ok(await data.client(first.json().client_id),'previous client remains registered');
});
