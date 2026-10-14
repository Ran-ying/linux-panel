import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { StateStore } from '../platform/state-store.js';
import { AuthService } from '../platform/auth/service.js';

const domain = 'https://linux.example.com';
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'lp-public-test-'));
  const modulesPath = join(root, 'modules');
  await mkdir(modulesPath);
  const statePath = join(root, 'data', 'state.json');
  const auth = new AuthService(new StateStore(statePath));
  await auth.bootstrap('admin', 'A sufficiently long test password!');
  const app = await createApp({ root, modulesPath, statePath, publicOrigin: domain, production: true });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const login = (ip, password, origin = domain, host = 'linux.example.com', peer = '127.0.0.1') =>
    app.inject({
      method: 'POST', url: '/api/auth/login', remoteAddress: peer,
      headers: {
        host, origin, 'x-panel-client': 'web',
        'x-forwarded-for': ip, 'x-forwarded-proto': 'https'
      },
      payload: { username: 'admin', password }
    });
  return { app, login };
}

test('production requires canonical HTTPS origin; never starts without it', async () => {
  await assert.rejects(createApp({ production: true, publicOrigin: '' }), /PANEL_PUBLIC_ORIGIN/);
  await assert.rejects(createApp({ production: true, publicOrigin: 'http://linux.example.com' }), /PANEL_PUBLIC_ORIGIN/);
  await assert.rejects(createApp({ production: true, publicOrigin: 'https://linux.example.com/' }), /exact origin/);
});

test('production denies missing/foreign Origin and mismatched Host', async t => {
  const { app, login } = await setup(t);
  assert.equal((await login('198.51.100.11', 'A sufficiently long test password!', undefined)).statusCode, 200);
  assert.equal((await login('198.51.100.11', 'A sufficiently long test password!', '')).statusCode, 403);
  assert.equal((await login('198.51.100.11', 'A sufficiently long test password!', 'https://evil.example')).statusCode, 403);
  assert.equal((await login('198.51.100.11', 'A sufficiently long test password!', domain, 'evil.example')).statusCode, 421);
  const plain = await app.inject({ url: '/api/auth/status', headers: { host: 'linux.example.com' } });
  assert.equal(plain.statusCode, 200);
  assert.match(plain.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.match(plain.headers['strict-transport-security'], /max-age=/);
  assert.equal(plain.headers['x-content-type-options'], 'nosniff');
});

test('login behind localhost proxy sets Secure cookies and rate limits independently per client', async t => {
  const { login } = await setup(t);
  const attacker = '198.51.100.20';
  const owner = '203.0.113.44';
  for (let i = 0; i < 5; i++) {
    const fail = await login(attacker, 'wrong password');
    assert.equal(fail.statusCode, 401);
  }
  assert.equal((await login(attacker, 'A sufficiently long test password!')).statusCode, 429);
  const ok = await login(owner, 'A sufficiently long test password!');
  assert.equal(ok.statusCode, 200, 'another real client must not share proxy IP lockout');
  assert.match(ok.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
  assert.match(ok.headers['set-cookie'], /Secure/);
});

test('untrusted remote client cannot spoof its source IP through forwarded headers', async t => {
  const { login } = await setup(t);
  const peer = '203.0.113.66';
  for (let i = 0; i < 5; i++) {
    const fail = await login('198.51.100.' + (i + 1), 'wrong password', domain, 'linux.example.com', peer);
    assert.equal(fail.statusCode, 401);
  }
  const locked = await login('198.51.100.88', 'A sufficiently long test password!', domain, 'linux.example.com', peer);
  assert.equal(locked.statusCode, 429);
});
