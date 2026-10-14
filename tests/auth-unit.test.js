import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../platform/state-store.js';
import { AuthService } from '../platform/auth/service.js';
import { hashPassword, verifyPassword } from '../platform/auth/password.js';
import { readSessionCookie, sessionCookie, clearSessionCookie } from '../platform/auth/cookies.js';

test('scrypt hashing uses fresh salts and verifies passwords', async () => {
  const one = await hashPassword('password with enough length');
  const two = await hashPassword('password with enough length');
  assert.notEqual(one, two);
  assert.equal(await verifyPassword('password with enough length', one), true);
  assert.equal(await verifyPassword('incorrect', one), false);
  assert.equal(await verifyPassword('incorrect', 'not-a-valid-hash'), false);
  await assert.rejects(hashPassword('short'));
});

test('cookie parser and secure flags', () => {
  const cookie = sessionCookie('dummy', { secure: true });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal(readSessionCookie('other=abc; lp_session=123; csrf=unrelated'), '123');
  assert.match(clearSessionCookie(), /Max-Age=0/);
});

test('bootstrap is exclusive and state survives store re-instantiation', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'linux-panel-state-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'private', 'state.json');
  const auth = new AuthService(new StateStore(path));
  await auth.bootstrap('firstAdmin', 'a secure bootstrapping password!');
  await assert.rejects(auth.bootstrap('secondAdmin', 'a secure bootstrapping password!'), /already exists/);
  const other = new AuthService(new StateStore(path));
  assert.equal(await other.isInitialized(), true);
  const raw = await readFile(path, 'utf8');
  assert.ok(!raw.includes('a secure bootstrapping password!'));
  assert.ok(raw.includes('scrypt-v1:'));
});

test('concurrent state mutations are serialized without lost updates', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'linux-panel-write-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = new StateStore(join(folder, 'state.json'));
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.mutate(state => {
    state.audit.push({ id: i });
  })));
  assert.equal((await store.snapshot()).audit.length, 20);
});
