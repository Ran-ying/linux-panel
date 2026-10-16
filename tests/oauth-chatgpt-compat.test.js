import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';
import { panelContentSecurityPolicy } from '../platform/http-security.js';

const origin='http://127.0.0.1:4188',resource=origin+'/mcp';
test('ChatGPT OAuth extension params and origin-only resource do not bypass PKCE',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'oauth-chatgpt-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const statePath=join(folder,'panel-state.json');
  const auth=new AuthService(new StateStore(statePath));
  await auth.bootstrap('admin','an example sufficiently long strong password');
  const app=await createApp({root:process.cwd(),statePath,
    modulesPath:join(process.cwd(),'modules'),production:false});
  t.after(()=>app.close());
  const login=await app.inject({method:'POST',url:'/api/auth/login',
    headers:{'x-panel-client':'web'},
    payload:{username:'admin',password:'an example sufficiently long strong password'}});
  assert.equal(login.statusCode,200);
  const cookie=login.headers['set-cookie'].split(';')[0],csrf=login.json().csrf;
  assert.equal((await app.inject({method:'PUT',url:'/api/extensions/mcp/settings',
    headers:{cookie,'x-panel-csrf':csrf},
    payload:{enabled:true,registrationEnabled:true,tools:{'system.info':true,'system.resources':true}}})).statusCode,200);
  const reg=await app.inject({method:'POST',url:'/oauth/register',
    payload:{client_name:'ChatGPT test',redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect']}});
  assert.equal(reg.statusCode,201);
  const id=reg.json().client_id;
  const verifier=randomBytes(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  // Real OAuth clients may use extra parameters; state/scope are optional by RFC 6749.
  // Resource remains *restricted* to this origin or its exact /mcp path.
  const basic={client_id:id,response_type:'code',
    redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',
    code_challenge_method:'S256',code_challenge:challenge,
    resource:origin,login_hint:'someone@example.com',
    target_flow:'chatgpt_siwc',prompt:'consent'};
  const query=new URLSearchParams(basic);
  const consent=await app.inject({url:'/oauth/authorize?'+query,headers:{cookie}});
  assert.equal(consent.statusCode,200,consent.body);
  // A normal browser form navigation otherwise sends Origin: null under
  // the application's global Referrer-Policy: no-referrer.
  assert.equal(consent.headers['referrer-policy'],'origin');
  assert.match(consent.headers['content-security-policy'],
    /form-action 'self' https:\/\/chatgpt\.com;/);
  assert.match(consent.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.doesNotMatch(consent.headers['content-security-policy'],/evil\.example/);
  assert.equal(panelContentSecurityPolicy().includes("form-action 'self';"),true);
  assert.doesNotMatch(panelContentSecurityPolicy(),/https:\/\/chatgpt\.com/);
  assert.match(consent.body,/<meta name="referrer" content="origin">/);
  assert.match(consent.body,/system:read/);
  assert.match(consent.body,/services:read/);
  assert.doesNotMatch(consent.body,/value="undefined"/);
  const rejected=await app.inject({method:'POST',url:'/oauth/authorize',
    headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({...basic,resource:'https://evil.example/mcp',
      scope:'system:read',csrf,decision:'approve'}).toString()});
  assert.equal(rejected.statusCode,400);
  // The mitigation fixes the browser document policy, not authentication:
  // null, absent, and foreign origins remain rejected on authorization POST.
  for (const badHeaders of [{origin:'null'}, {origin:'https://evil.example'}, {}]) {
    const blocked=await app.inject({method:'POST',url:'/oauth/authorize',
      headers:{cookie,'content-type':'application/x-www-form-urlencoded',...badHeaders},
      payload:new URLSearchParams({...basic,csrf,decision:'approve'}).toString()});
    assert.equal(blocked.statusCode,403,JSON.stringify(badHeaders));
    assert.equal(blocked.json().error,'Origin not allowed');
  }
  assert.equal((await app.inject({url:'/api/auth/status'})).headers['referrer-policy'],
    'no-referrer','non-consent routes retain strict referrer policy');
  const invalidChallenge=await app.inject({url:'/oauth/authorize?'+new URLSearchParams({
    ...basic,code_challenge_method:'plain'}),headers:{cookie}});
  assert.equal(invalidChallenge.statusCode,400);
  const noInteraction=await app.inject({url:'/oauth/authorize?'+new URLSearchParams({
    ...basic,prompt:'none'}),headers:{cookie}});
  assert.equal(noInteraction.statusCode,400);
  const approved=await app.inject({method:'POST',url:'/oauth/authorize',
    headers:{cookie,origin,'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({...basic,csrf,decision:'approve'}).toString()});
  assert.equal(approved.statusCode,302,approved.body);
  const cb=new URL(approved.headers.location);
  assert.equal(cb.origin,'https://chatgpt.com');
  assert.equal(cb.searchParams.has('state'),false);
  const authCode=cb.searchParams.get('code');
  assert.ok(authCode);
  const token=await app.inject({method:'POST',url:'/oauth/token',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    payload:new URLSearchParams({client_id:id,grant_type:'authorization_code',
      redirect_uri:basic.redirect_uri,code:authCode,code_verifier:verifier,
      resource:origin}).toString()});
  assert.equal(token.statusCode,200,token.body);
  assert.ok(token.json().access_token);
  // A client-supplied state, however short, must be echoed exactly.
  const shortState=await app.inject({url:'/oauth/authorize?'+new URLSearchParams({
    ...basic,state:'x',scope:'system:read',resource}),headers:{cookie}});
  assert.equal(shortState.statusCode,200,shortState.body);
  // Duplicate security-critical keys remain forbidden.
  const duplicated=await app.inject({url:'/oauth/authorize?'+query+'&client_id=another',headers:{cookie}});
  assert.equal(duplicated.statusCode,400);
});

test('consent CSP adds only registered redirect origin, not arbitrary OAuth parameters',()=>{
  assert.match(panelContentSecurityPolicy('https://chatgpt.com'),
    /form-action 'self' https:\/\/chatgpt\.com;/);
  assert.throws(()=>panelContentSecurityPolicy("https://evil.example'; script-src *"),/Invalid|URL/);
  assert.throws(()=>panelContentSecurityPolicy('http://evil.example'),/Invalid/);
});
