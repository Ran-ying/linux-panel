import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../platform/state-store.js';
import { AuthService } from '../platform/auth/service.js';
import { totp, base32Encode, base32Decode } from '../platform/auth/totp.js';
import { createApp } from '../apps/api/src/create-app.js';

const HOST='http://127.0.0.1:5173', PASSWORD='Correct horse battery staple 2026!';
test('RFC 6238 TOTP SHA1 vector and base32 round-trip',()=>{
  assert.equal(base32Encode(Buffer.from('12345678901234567890')),'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),Buffer.from('12345678901234567890'));
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',59),'287082');
});
test('TOTP setup requires password+session CSRF, login needs second factor, recovery codes single use',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lp-totp-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const statePath=join(root,'state.json');
  const auth=new AuthService(new StateStore(statePath));
  await auth.bootstrap('admin',PASSWORD);
  const app=await createApp({root:process.cwd(),statePath,
    modulesPath:join(process.cwd(),'modules'),production:false,logger:false});
  t.after(()=>app.close());
  const login=(password=PASSWORD,secondFactor='')=>app.inject({method:'POST',url:'/api/auth/login',
    headers:{origin:HOST,'x-panel-client':'web'},payload:{username:'admin',password,secondFactor}});
  const start=await login();
  assert.equal(start.statusCode,200,start.body);
  const cookie=start.headers['set-cookie'].split(';')[0],csrf=start.json().csrf;
  assert.equal((await app.inject({method:'POST',url:'/api/auth/totp/setup',headers:{cookie,origin:HOST},
    payload:{currentPassword:PASSWORD}})).statusCode,403);
  const headers={cookie,origin:HOST,'x-panel-csrf':csrf};
  assert.equal((await app.inject({method:'POST',url:'/api/auth/totp/setup',headers,
    payload:{currentPassword:'bad'}})).statusCode,401);
  const pending=await app.inject({method:'POST',url:'/api/auth/totp/setup',headers,
    payload:{currentPassword:PASSWORD}});
  assert.equal(pending.statusCode,200,pending.body);
  const secret=pending.json().secret;
  assert.match(secret,/^[A-Z2-7]+$/);
  const code=totp(secret,Math.floor(Date.now()/30000));
  const enable=await app.inject({method:'POST',url:'/api/auth/totp/enable',headers,payload:{code}});
  assert.equal(enable.statusCode,200,enable.body);
  assert.equal(enable.json().recoveryCodes.length,10);
  assert.equal((await login()).statusCode,401);
  // A new TOTP time-step may not yet be available, so exercise recovery login.
  const recovery=enable.json().recoveryCodes[0];
  const authenticated=await login(PASSWORD,recovery);
  assert.equal(authenticated.statusCode,200,authenticated.body);
  assert.equal((await login(PASSWORD,recovery)).statusCode,401);
  const status=await app.inject({url:'/api/auth/totp',headers:{cookie:authenticated.headers['set-cookie'].split(';')[0]}});
  assert.deepEqual(status.json(),{enabled:true,recoveryCodesRemaining:9});
  assert.equal((await app.inject({url:'/api/auth/totp'})).statusCode,401);
});
test('account-wide failures constrain distributed login attempts',async t=>{
  const root=await mkdtemp(join(tmpdir(),'lp-throttle-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const auth=new AuthService(new StateStore(join(root,'state.json')));
  await auth.bootstrap('admin',PASSWORD);
  for(let n=0;n<12;n++)await assert.rejects(auth.login('admin','wrong',String(n)),{statusCode:401});
  await assert.rejects(auth.login('admin',PASSWORD,'new-ip'),{statusCode:429});
});
