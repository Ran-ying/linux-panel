import test from 'node:test';
import assert from 'node:assert/strict';
import {panelContentSecurityPolicy} from '../platform/http-security.js';
test('terminal styles use a narrow per-document nonce, not unsafe inline policy',()=>{
  const nonce='fixtureStyleNonce1234567890';
  const policy=panelContentSecurityPolicy(null,nonce);
  assert.ok(policy.includes("style-src 'self' 'nonce-"+nonce+"'"));
  assert.ok(policy.includes("script-src 'self'"));
  assert.ok(!policy.includes('unsafe-inline'));
  assert.ok(!panelContentSecurityPolicy().includes('nonce-'));
  assert.throws(()=>panelContentSecurityPolicy(null,"bad'; script-src *"),/Invalid style nonce/);
});
