import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const script = new URL('../scripts/install.sh', import.meta.url).pathname;
const run = (...args) => spawnSync('bash',[script,...args],{
  encoding:'utf8',timeout:20000,env:{...process.env}
});
test('installer help documents no proxy dependency and own listener',()=>{
  const r=run('--help');
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/--preflight/);
  assert.match(r.stdout,/--node-bin/);
  assert.match(r.stdout,/--resume/);
  assert.match(r.stdout,/--host ADDRESS/);
  assert.match(r.stdout,/--port PORT/);
  assert.match(r.stdout,/never touches third-party reverse proxies/);
});
test('read-only preflight blocks unavailable isolated Node without mutating host',()=>{
  const r=run('--preflight','--host','127.0.0.1','--port','49116',
    '--node-bin','/path/not-existing-node/node');
  assert.equal(r.status,1);
  assert.match(r.stdout,/\[BLOCK\s*\].*Node\.js/);
  assert.match(r.stdout,/Preflight summary: [1-9][0-9]* blocker/);
  assert.doesNotMatch(r.stdout,/Nginx|nginx|certificate/);
  assert.match(r.stderr,/Preflight blocked installation/);
});
test('invalid listener address and privileged port fail before installation',()=>{
  for(const args of [['--host','192.168.1.1'],['--port','80'],['--port','65536'],
    ['--port','abc'],['--host','0.0.0.0']]){
    const r=run('--preflight',...args);
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/Listen|--port|HTTPS/);
    assert.doesNotMatch(r.stdout,/Linux Panel install preflight/);
  }
});
test('existing proxy flags no longer impact installer',()=>{
  const r=run('--preflight','--no-nginx');
  assert.equal(r.status,1);
  assert.match(r.stderr,/Unknown option: --no-nginx/);
  const text=readFileSync(script,'utf8');
  assert.doesNotMatch(text,/nginx\s+-t|systemctl reload nginx|\/etc\/nginx/);
});

test('resume guard requires a root-owned clean checkout and does not reset',()=>{
  const text=readFileSync(script,'utf8');
  assert.match(text,/--resume requires a root-owned/);
  assert.match(text,/status --porcelain/);
  assert.match(text,/remote get-url origin/);
  assert.match(text,/Existing private state detected/);
  assert.doesNotMatch(text,/git reset --hard|rm -rf \/opt\/linux-panel/);
});
