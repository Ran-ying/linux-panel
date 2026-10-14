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
    payload:{enabled:true,tools:{'system.info':true,'system.cpu':true,'storage.usage':true}}});
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
  const issued=await getToken({client_id:id,grant_type:'authorization_code',
    code,redirect_uri:'https://client.example/callback',code_verifier:verifier,resource});
  assert.equal(issued.statusCode,200,issued.body);
  const tokens=issued.json();
  assert.equal(tokens.token_type,'Bearer');
  assert.ok(tokens.refresh_token);
  const storeOAuth=new OAuthStore(store,{list:()=>[]},resource);
  const valid=await storeOAuth.verifyAccessToken(tokens.access_token);
  // The fake registry has no MCP tools, so the token's effective scopes are empty.
  assert.ok(valid);
  assert.deepEqual(valid.scopes,[]);
  const grants=(await app.inject({url:'/api/extensions/mcp/grants',headers:{cookie}})).json().grants;
  assert.equal(grants.length,1);
  assert.deepEqual(grants[0].scopes,['system:read','storage:read']);
  const restricted=await app.inject({method:'PUT',url:'/api/extensions/mcp/grants/'+grants[0].id,
    headers:{cookie,'x-panel-csrf':csrf},payload:{scopes:['system:read']}});
  assert.equal(restricted.statusCode,200,restricted.body);
  const refreshed=await getToken({client_id:id,grant_type:'refresh_token',
    refresh_token:tokens.refresh_token,resource});
  assert.equal(refreshed.statusCode,200,refreshed.body);
  const revoked=await app.inject({method:'DELETE',url:'/api/extensions/mcp/grants/'+grants[0].id,
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
    payload:{enabled:false,tools:{'system.info':true}}});
  assert.equal((await app.inject('/.well-known/oauth-authorization-server')).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/oauth/register',
    payload:{client_name:'foo',redirect_uris:['https://client.example/cb']}})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:'/mcp',
    payload:{jsonrpc:'2.0',id:1,method:'tools/list'}})).statusCode,404);
});
