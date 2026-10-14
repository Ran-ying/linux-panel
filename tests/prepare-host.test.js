import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/prepare-host.sh', import.meta.url).pathname;
const worker = new URL('../scripts/update-worker.sh', import.meta.url).pathname;
function run(...args) {
  return spawnSync('bash', [script, ...args], {encoding:'utf8', timeout:20000});
}

test('host preparation help describes opt-in apply', () => {
  const r = run('--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--install-node/);
  assert.match(r.stdout, /--create-swap/);
  assert.match(r.stdout, /--apply/);
});

test('host preparation check mode is read-only', () => {
  const r = run('--check');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY-RUN/);
  assert.match(r.stdout, /No changes/);
});

test('host preparation read-only plan works with or without existing Node24', () => {
  const r = run('--install-node');
  assert.equal(r.status, 0, r.stdout+'\n'+r.stderr);
  assert.match(r.stdout, /DRY-RUN/);
  assert.match(r.stdout, /Will NOT alter/);
  assert.match(r.stdout, /already exists|Plan: fetch official Node/);
});

test('regression: dry-run succeeds on hosts where Node24 already exists; apply refuses overwrite', () => {
  const folder=mkdtempSync(join(tmpdir(),'linux-panel-prep-existing-'));
  try {
    const nodeDest=join(folder,'node24');
    mkdirSync(nodeDest);
    // Exercise the actual script branch with its fixed destination replaced
    // in a temporary copy. Never touch /opt/node24 on CI or a real host.
    const original=readFileSync(script,'utf8');
    assert.match(original, /NODE_DEST=\/opt\/node24/);
    const fixture=join(folder,'prepare-host.sh');
    writeFileSync(fixture,original.replace('NODE_DEST=/opt/node24',
      'NODE_DEST='+nodeDest));
    const dry=spawnSync('bash',[fixture,'--install-node'],{encoding:'utf8',timeout:20000});
    assert.equal(dry.status,0,dry.stdout+'\n'+dry.stderr);
    assert.match(dry.stdout,/already exists; dry-run only/);
    const apply=spawnSync('bash',[fixture,'--install-node','--apply'],
      {encoding:'utf8',timeout:20000});
    assert.notEqual(apply.status,0);
    assert.match(apply.stderr,/already exists; refusing to overwrite/);
  } finally {
    rmSync(folder,{recursive:true,force:true});
  }
});

test('host preparation forbids apply without chosen action', () => {
  const r = run('--apply');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /requires a chosen operation/);
});

test('host preparation rejects excessive swap allocation', () => {
  const r = run('--create-swap', '4096');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /512\.\.2048/);
});

test('updater non-root build path supports isolated Node 24', () => {
  const text = readFileSync(worker,'utf8');
  assert.match(text, /as_updater\(\).*PATH=\/opt\/node24\/bin:/);
  assert.match(text, /export PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
});
