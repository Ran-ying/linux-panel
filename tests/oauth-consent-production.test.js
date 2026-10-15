import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';

test('production consent allows registered ChatGPT callback, without changing site-wide CSP',async t=>{
  const origin='https://panel.example.com';
  const domain='panel.example.com';
  const folder=await mkdtemp(join(tmpdir(),'oauth-csp-prod-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const statePath=join(folder,'state.json');
  const store=new StateStore(statePath);
  const auth=new AuthService(store);
  await auth.bootstrap('admin','high entropy password for production test');
  const app=await createApp({root:process.cwd(),statePath,
    modulesPath:join(process.cwd(),'modules'),publicOrigin:origin,production:true});
  t.after(()=>app.close());
  const ordinary=await app.inject({url:'/api/auth/status',headers:{host:domain}});
  assert.equal(ordinary.statusCode,200);
  assert.match(ordinary.headers['content-security-policy'],/form-action 'self';/);
  assert.doesNotMatch(ordinary.headers['content-security-policy'],/chatgpt\.com/);
  const login=await app.inject({method:'POST',url:'/api/auth/login',
    headers:{host:domain,origin,'x-panel-client':'web'},
    payload:{username:'admin',password:'high entropy password for production test'}});
  assert.equal(login.statusCode,200,login.body);
  const cookie=login.headers['set-cookie'].split(';')[0],csrf=login.json().csrf;
  const enabled=await app.inject({method:'PUT',url:'/api/extensions/mcp/settings',
    headers:{cookie,host:domain,origin,'x-panel-csrf':csrf},
    payload:{enabled:true,registrationEnabled:true,allowUpdates:true,tools:{'system.info':true}}});
  assert.equal(enabled.statusCode,200,enabled.body);
  const callback='https://chatgpt.com/connector_platform_oauth_redirect';
  const client=await app.inject({method:'POST',url:'/oauth/register',headers:{host:domain},
    payload:{client_name:'ChatGPT',redirect_uris:[callback]}});
  assert.equal(client.statusCode,201,client.body);
  const verifier=randomBytes(32).toString('base64url');
  const query=new URLSearchParams({
    client_id:client.json().client_id,response_type:'code',redirect_uri:callback,
    scope:'system:read',state:'test-opaque-state',
    resource:origin,code_challenge_method:'S256',
    code_challenge:createHash('sha256').update(verifier).digest('base64url')
  });
  const approval=await app.inject({url:'/oauth/authorize?'+query,headers:{host:domain,cookie}});
  assert.equal(approval.statusCode,200,approval.body);
  // A connected trusted client receives all currently enabled global Actions.
  const withoutScope=new URLSearchParams(query);
  withoutScope.delete('scope');
  const globalConsent=await app.inject({
    url:'/oauth/authorize?'+withoutScope,headers:{host:domain,cookie}
  });
  assert.equal(globalConsent.statusCode,200,globalConsent.body);
  assert.match(globalConsent.body,/<code>system:read<\/code>/);
  assert.match(globalConsent.body,/<code>panel:update<\/code>/);
  const explicitlyRequested=new URLSearchParams(query);
  explicitlyRequested.set('scope','panel:update');
  const updateConsent=await app.inject({
    url:'/oauth/authorize?'+explicitlyRequested,headers:{host:domain,cookie}
  });
  assert.equal(updateConsent.statusCode,200,updateConsent.body);
  assert.match(updateConsent.body,/<code>panel:update<\/code>/);

  assert.match(approval.headers['content-security-policy'],/form-action 'self' https:\/\/chatgpt\.com;/);
  assert.match(approval.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal(approval.headers['referrer-policy'],'origin');
  const posted=await app.inject({method:'POST',url:'/oauth/authorize',
    headers:{host:domain,cookie,origin,'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({...Object.fromEntries(query),csrf,decision:'approve'}).toString()});
  assert.equal(posted.statusCode,302,posted.body);
  assert.equal(new URL(posted.headers.location).origin,'https://chatgpt.com');
  assert.equal(new URL(posted.headers.location).searchParams.get('state'),'test-opaque-state');
  assert.ok(new URL(posted.headers.location).searchParams.get('code'));
});
