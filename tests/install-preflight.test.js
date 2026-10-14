import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/install.sh', import.meta.url).pathname;
const run = (...args) => spawnSync('bash', [script, ...args], {
  encoding: 'utf8',
  timeout: 20_000,
  env: { ...process.env },
});

test('installer help documents read-only preflight and isolated Node', () => {
  const r = run('--help');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--preflight/);
  assert.match(r.stdout, /--node-bin/);
});

test('preflight blocks missing Node without making changes', () => {
  const r = run('--preflight', '--domain', 'panel-test.example.com', '--no-nginx',
    '--node-bin', '/path/not-existing-linux-panel-node/node');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /\[BLOCK\s*\].*Node\.js/);
  assert.match(r.stdout, /Preflight summary: [1-9][0-9]* blocker/);
  assert.match(r.stderr, /Preflight blocked installation/);
  assert.doesNotMatch(r.stdout + r.stderr, /Cloning|Installing locked root dependencies|Create your administrator account/);
});

test('preflight rejects invalid domain before checking host', () => {
  const r = run('--preflight', '--domain', 'bad domain', '--no-nginx');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Invalid --domain/);
  assert.doesNotMatch(r.stdout, /Linux Panel install preflight/);
});

test('preflight reports unsupported Nginx version rather than attempting upgrades', () => {
  const fake = mkdtempSync(join(tmpdir(), 'linux-panel-nginx-test-'));
  try {
    const nginx = join(fake, 'nginx');
    writeFileSync(nginx, '#!/usr/bin/env bash\nif [[ "$1" == "-v" ]]; then echo "nginx version: nginx/1.14.2" >&2; fi\n');
    chmodSync(nginx, 0o755);
    const r = spawnSync('bash', [script, '--preflight', '--domain', 'panel-test.example.com',
      '--cert', '/etc/hosts', '--key', '/etc/hosts'], {
      encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, PATH: fake + ':' + process.env.PATH },
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[BLOCK\s*\] Nginx 1\.14\.2 unsupported/);
    assert.match(r.stdout, /Upgrade manually without interrupting existing sites/);
    assert.doesNotMatch(r.stdout + r.stderr, /Cloning|Installing locked root dependencies/);
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test('preflight detects exact Nginx hostname reuse and refuses overwrite', () => {
  const fake = mkdtempSync(join(tmpdir(), 'linux-panel-nginx-host-'));
  try {
    const nginx = join(fake, 'nginx');
    writeFileSync(nginx, '#!/usr/bin/env bash\n' +
      'case "$1" in\n' +
      '  -v) echo "nginx version: nginx/1.24.0" >&2;;\n' +
      '  -t) exit 0;;\n' +
      '  -T) echo "  server_name panel-test.example.com;";;\n' +
      'esac\n');
    chmodSync(nginx, 0o755);
    const r = spawnSync('bash', [script, '--preflight', '--domain', 'panel-test.example.com',
      '--cert', '/etc/hosts', '--key', '/etc/hosts'], {
      encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, PATH: fake + ':' + process.env.PATH },
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Nginx 1\.24\.0/);
    assert.match(r.stdout, /Existing Nginx server_name panel-test\.example\.com/);
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});
