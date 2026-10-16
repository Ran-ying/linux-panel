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
  assert.equal((await app.inject('/api/health')).statusCode, 401);
  assert.equal((await app.inject('/api/web/presentations')).statusCode, 401);
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
  // No optional business modules; platform-owned update Actions remain visible.
  assert.deepEqual((await app.inject({ url: '/api/modules', headers: { cookie } })).json().modules.map(m=>m.id), ['panel']);
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
  assert.equal(typeof ok.json().result.distribution, 'string');
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

test('logout must revoke the cookie on the server, not just hide the Web UI', async t => {
  const { app, admin, login } = await fixture(t);
  await admin();
  const { cookie, payload } = await login();
  const denied = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  assert.equal(denied.statusCode, 403);
  assert.equal((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode, 200);
  const ok = await app.inject({
    method: 'POST', url: '/api/auth/logout',
    headers: { cookie, 'x-panel-csrf': payload.csrf }
  });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.headers['set-cookie'], /Max-Age=0/);
  assert.equal((await app.inject({ url: '/api/auth/session', headers: { cookie } })).statusCode, 401);
});

const DAY_MS = 86400000;
function nearDays(expiresAt, since, days) {
  assert.ok(Math.abs(Date.parse(expiresAt) - since - days * DAY_MS) < 5000, 'expiry must match configured duration');
}

test('session policy defaults to 30 days and persists custom duration with matching cookie', async t => {
  const { app, admin, login, store, statePath } = await fixture(t);
  await admin();
  const before = Date.now();
  const first = await login();
  nearDays(first.payload.expiresAt, before, 30);
  assert.match(first.reply.headers['set-cookie'], /Max-Age=259199[89]|Max-Age=2592000/);
  const second = await login();
  const headers = { cookie:first.cookie, 'x-panel-csrf':first.payload.csrf, origin:'http://127.0.0.1:5173' };
  assert.deepEqual((await app.inject({url:'/api/auth/session-policy',headers})).json(), {days:30});
  const start = Date.now();
  const saved = await app.inject({method:'PUT',url:'/api/auth/session-policy',headers,payload:{days:7}});
  assert.equal(saved.statusCode,200,saved.body);
  nearDays(saved.json().expiresAt,start,7);
  assert.match(saved.headers['set-cookie'], /Max-Age=604799|Max-Age=604800/);
  const current = (await app.inject({url:'/api/auth/session',headers})).json();
  assert.equal(current.expiresAt,saved.json().expiresAt);
  const other = (await app.inject({url:'/api/auth/session',headers:{cookie:second.cookie}})).json();
  assert.equal(other.expiresAt,second.payload.expiresAt,'other devices must retain their existing expiry');
  const later = await login();
  nearDays(later.payload.expiresAt,Date.now(),7);
  const restarted = new AuthService(new StateStore(statePath));
  assert.deepEqual(await restarted.sessionPolicy(),{days:7});
  // General appearance settings must not reset the independent login policy.
  assert.equal((await app.inject({method:'PUT',url:'/api/panel/settings',headers,
    payload:{panelName:'Test',language:'zh-CN',theme:'dark'}})).statusCode,200);
  assert.equal((await store.snapshot()).authPolicy.sessionDays,7);
});

test('session policy requires login, CSRF, correct Origin and bounded integer days', async t => {
  const { app, admin, login } = await fixture(t);
  await admin();
  assert.equal((await app.inject({url:'/api/auth/session-policy'})).statusCode,401);
  assert.equal((await app.inject({method:'PUT',url:'/api/auth/session-policy',payload:{days:7}})).statusCode,401);
  const { cookie,payload } = await login();
  const headers={cookie,'x-panel-csrf':payload.csrf,origin:'http://127.0.0.1:5173'};
  assert.equal((await app.inject({method:'PUT',url:'/api/auth/session-policy',headers:{cookie},payload:{days:7}})).statusCode,403);
  assert.equal((await app.inject({method:'PUT',url:'/api/auth/session-policy',
    headers:{...headers,origin:'https://evil.example'},payload:{days:7}})).statusCode,403);
  for (const body of [{days:0},{days:366},{days:1.5},{days:'30'},{days:null},{days:30,extra:true},[],{}])
    assert.equal((await app.inject({method:'PUT',url:'/api/auth/session-policy',headers,payload:body})).statusCode,400);
  for (const days of [1,365])
    assert.equal((await app.inject({method:'PUT',url:'/api/auth/session-policy',headers,payload:{days}})).statusCode,200);
});

test('legacy session upgrades once and synchronizes cookie without reviving expired or revoked sessions', async t => {
  const {app,admin,login,store}=await fixture(t);
  await admin();
  const first=await login();
  const created=Date.now()-3600000;
  await store.mutate(state=>{
    const session=state.sessions[0];
    delete session.durationDays;
    session.createdAt=new Date(created).toISOString();
    session.expiresAt=new Date(created+12*3600000).toISOString();
  });
  const read=()=>app.inject({url:'/api/auth/session',headers:{cookie:first.cookie}});
  const upgraded=await read();
  assert.equal(upgraded.statusCode,200);
  nearDays(upgraded.json().expiresAt,created,30);
  const age=Number(upgraded.headers['set-cookie'].match(/Max-Age=(\d+)/)[1]);
  assert.ok(Math.abs(age-(30*86400-3600))<5);
  assert.equal((await read()).json().expiresAt,upgraded.json().expiresAt,'page refresh must not slide expiry');
  await store.mutate(state=>{
    delete state.sessions[0].durationDays;
    state.sessions[0].expiresAt=new Date(Date.now()-1000).toISOString();
  });
  assert.equal((await read()).statusCode,401);
  assert.equal((await store.snapshot()).sessions[0].durationDays,undefined);
  const fresh=await login();
  const headers={cookie:fresh.cookie,'x-panel-csrf':fresh.payload.csrf};
  await app.inject({method:'POST',url:'/api/auth/logout',headers});
  assert.equal((await app.inject({url:'/api/auth/session',headers})).statusCode,401);
});

test('command configuration is authenticated, CSRF/Origin protected and changes real read results',async t=>{
  if(process.getuid?.()===0){t.skip('terminal execution refuses root');return;}
  const {app,admin,login,store}=await fixture(t,true);
  await admin();
  const url='/api/actions/system.info/commands';
  assert.equal((await app.inject(url)).statusCode,401);
  const {cookie,payload}=await login();
  const headers={cookie,'x-panel-csrf':payload.csrf,origin:'http://127.0.0.1:5173'};
  const config=(await app.inject({url,headers})).json();
  assert.equal(config.editable,true);
  assert.equal(config.fields.length,6);
  const commands=Object.fromEntries(config.fields.map(field=>[field.key,field.value]));
  commands.distribution='printf configured-host';
  assert.equal((await app.inject({method:'PUT',url,headers:{cookie},payload:{commands}})).statusCode,403);
  assert.equal((await app.inject({method:'PUT',url,headers:{...headers,origin:'https://evil.example'},payload:{commands}})).statusCode,403);
  assert.equal((await app.inject({method:'PUT',url,headers,payload:{commands:{...commands,extra:'id'}}})).statusCode,400);
  assert.equal((await app.inject({method:'PUT',url,headers,payload:{commands}})).statusCode,200);
  assert.equal((await store.snapshot()).actionCommands['system.info'].distribution,'printf configured-host');
  const preview=await app.inject({method:'POST',url:'/api/actions/system.info/preview',headers,payload:{input:{}}});
  assert.equal(preview.json().steps[0].command,'printf configured-host');
  const result=await app.inject({method:'POST',url:'/api/actions/system.info/execute',headers,payload:{input:{}}});
  assert.equal(result.statusCode,200,result.body);
  assert.equal(result.json().result.distribution,'configured-host');
  assert.ok(!Object.hasOwn(result.json().result,'disk'));
  assert.ok(!Object.hasOwn(result.json().raw,'filesystem'));
  const resources=await app.inject({method:'POST',url:'/api/actions/system.resources/execute',headers,payload:{input:{}}});
  assert.equal(resources.statusCode,200,resources.body);
  assert.equal(typeof resources.json().result.disk.usagePercent,'number');
  assert.equal(resources.json().raw.filesystem.exitCode,0);
});
