import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StateStore} from '../platform/state-store.js';

test('private state survives a new store instance after durable atomic rename', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'linux-panel-state-fsync-'));
  t.after(() => rm(folder, {recursive:true, force:true}));
  const statePath = join(folder, 'nested', 'private.json');
  const store = new StateStore(statePath);
  await store.mutate(state => {
    state.settings.panelName = 'Durable one';
    state.audit.push({id:'a',at:'now',event:'test.first'});
  });
  await store.mutate(state => {
    state.settings.panelName = 'Durable two';
    state.audit.push({id:'b',at:'later',event:'test.second'});
  });
  const reopened = new StateStore(statePath);
  const state = await reopened.snapshot();
  assert.equal(state.settings.panelName, 'Durable two');
  assert.deepEqual(state.audit.map(a => a.event), ['test.first','test.second']);
  const metadata = await stat(statePath);
  assert.equal(metadata.isFile(), true);
  if (process.platform !== 'win32') assert.equal(metadata.mode & 0o777, 0o600);
  assert.deepEqual(await readdir(join(folder,'nested')), ['private.json'],
    'No temporary state file remains after a committed mutation');
});

test('a rejected update does not publish partial private JSON or block next commit', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'linux-panel-state-rollback-'));
  t.after(() => rm(folder, {recursive:true, force:true}));
  const store = new StateStore(join(folder, 'state.json'));
  await store.mutate(s => {s.settings.panelName = 'Before';});
  await assert.rejects(store.mutate(s => {
    s.settings.panelName = 'Uncommitted';
    throw new Error('Injected mutation failure before disk commit');
  }), /Injected mutation failure/);
  await store.mutate(s => {s.settings.panelName = 'After';});
  const fresh = new StateStore(join(folder, 'state.json'));
  assert.equal((await fresh.snapshot()).settings.panelName, 'After');
  assert.deepEqual(await readdir(folder), ['state.json']);
});
