import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/api/src/create-app.js';
import { AuthService } from '../platform/auth/service.js';
import { StateStore } from '../platform/state-store.js';

async function fixture(t, withModules = false) {
  const root = await mkdtemp(join(tmpdir(), 'linux-panel-auth-'));
  await mkdir(join(root, 'modules'));
  const statePath = join(root, 'private', 'panel-state.json');
  const store = new StateStore(statePath);
  const auth = new AuthService(store);
  const app = await createApp({
    root, statePath,
    modulesPath: withModules ? join(process.cwd(), 'modules') : join(root, 'modules'),
    publicOrigin: '', production: false, logger: false
  });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  const admin = async () => auth.bootstrap('admin', 'Correct horse battery staple 2026!');
  const login = async (password = 'Correct horse battery staple 2026!') => {
    const reply = await app.inject({
      method: 'POST', url: '/api/auth/login',
      headers: { 'x-panel-client': 'web', origin: 'http://127.0.0.1:5173' },
      payload: { username: 'admin', password }
    });
    return { reply, cookie: reply.headers['set-cookie']?.split(';')[0], payload: reply.json() };
  };
  return { app, auth, store, statePath, admin, login };
}

test('first admin must be bootstrapped locally; Web cannot self-register', async t => {
  const { app, admin, statePath } = await fixture(t);
  assert.deepEqual((await app.inject('/api/auth/status')).json(), { initialized: false });
  assert.equal((await app.inject('/api/actions')).statusCode, 401);
  assert.equal((await app.inject('/api/panel/settings')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login',
    headers: { 'x-panel-client': 'web' },
    payload: { username: 'admin', password: 'anything' }
  })).statusCode, 503);
  await admin();
  assert.deepEqual((await app.inject('/api/auth/status')).json(), { initialized: true });
  assert.equal((await stat(statePath)).mode & 0o077, 0);
});

test('account sessions and built-in settings function with zero business modules', async t => {
  const { app, admin, login } = await fixture(t);
  await admin();
  const { cookie, payload, reply } = await login();
  assert.equal(reply.statusCode, 200);
  assert.match(reply.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
  assert.equal(payload.user.role, 'admin');
  assert.equal((await app.inject({ url: '/api/modules', headers: { cookie } })).json().modules.length, 0);
  assert.equal((await app.inject({ url: '/api/auth/session', headers: { cookie } })).json().user.username, 'admin');

  const csrf = payload.csrf;
  assert.equal((await app.inject({ method: 'PUT', url: '/api/panel/settings',
    headers: { cookie }, payload: { panelName: 'hello', language: 'zh-CN', theme: 'dark' }
  })).statusCode, 403);
  const updated = await app.inject({ method: 'PUT', url: '/api/panel/settings',
    headers: { cookie, 'x-panel-csrf': csrf, origin: 'http://127.0.0.1:5173' },
    payload: { panelName: 'My panel', language: 'zh-CN', theme: 'dark' }
  });
  assert.equal(updated.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/panel/settings', headers: { cookie } })).json().settings.panelName, 'My panel');
  assert.equal((await app.inject({ url: '/api/panel/audit', headers: { cookie } })).json().events[0].event, 'panel.settings.updated');

  const sessions = (await app.inject({ url: '/api/auth/sessions', headers: { cookie } })).json().sessions;
  assert.equal(sessions.length, 1);
  const revoked = await app.inject({
    method: 'DELETE', url: '/api/auth/sessions/' + sessions[0].id,
    headers: { cookie, 'x-panel-csrf': csrf }
  });
  assert.equal(revoked.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode, 401);
});

test('login rejects forged Origin, form posts and repeated password failures', async t => {
  const { app, admin, login } = await fixture(t);
  await admin();
  const missingHeader = await app.inject({ method: 'POST', url: '/api/auth/login',
    payload: { username: 'admin', password: 'Correct horse battery staple 2026!' } });
  assert.equal(missingHeader.statusCode, 403);
  const wrongOrigin = await app.inject({ method: 'POST', url: '/api/auth/login',
    headers: { 'x-panel-client': 'web', origin: 'https://evil.example' },
    payload: { username: 'admin', password: 'Correct horse battery staple 2026!' } });
  assert.equal(wrongOrigin.statusCode, 403);
  for (let i = 0; i < 5; i++) assert.equal((await login('wrong password')).reply.statusCode, 401);
  assert.equal((await login()).reply.statusCode, 429);
});

test('protected Action requests require a valid session, CSRF and permission checks', async t => {
  const { app, admin, login } = await fixture(t, true);
  await admin();
  assert.equal((await app.inject('/api/actions')).statusCode, 401);
  const { cookie, payload } = await login();
  const actions = (await app.inject({ url: '/api/actions', headers: { cookie } })).json().actions;
  assert.ok(actions.some(a => a.id === 'system.info'));
  const url = '/api/actions/system.info/execute';
  assert.equal((await app.inject({ method: 'POST', url, headers: { cookie }, payload: { input: {} } })).statusCode, 403);
  const ok = await app.inject({
    method: 'POST', url, headers: { cookie, 'x-panel-csrf': payload.csrf },
    payload: { input: {} }
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(typeof ok.json().result.hostname, 'string');
  const invalid = await app.inject({ method: 'POST', url,
    headers: { cookie, 'x-panel-csrf': payload.csrf },
    payload: { input: { extra: true } }
  });
  assert.equal(invalid.statusCode, 400);
});

test('changing password revokes existing sessions, new password allows login', async t => {
  const { app, admin, login } = await fixture(t);
  await admin();
  const { cookie, payload } = await login();
  const change = await app.inject({
    method: 'POST', url: '/api/auth/password',
    headers: { cookie, 'x-panel-csrf': payload.csrf },
    payload: { currentPassword: 'Correct horse battery staple 2026!', newPassword: 'a different long passphrase 2026!' }
  });
  assert.equal(change.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode, 401);
  assert.equal((await login()).reply.statusCode, 401);
  assert.equal((await login('a different long passphrase 2026!')).reply.statusCode, 200);
});

test('settings input validation prevents extra properties and invalid values', async t => {
  const { app, admin, login } = await fixture(t);
  await admin();
  const { cookie, payload } = await login();
  const bad = await app.inject({ method: 'PUT', url: '/api/panel/settings',
    headers: { cookie, 'x-panel-csrf': payload.csrf },
    payload: { panelName: 'x', language: 'zh-CN', theme: 'dark', superuser: true }
  });
  assert.equal(bad.statusCode, 400);
  assert.equal((await app.inject({ url: '/api/panel/settings', headers: { cookie } })).json().settings.panelName, 'Linux Panel');
});
