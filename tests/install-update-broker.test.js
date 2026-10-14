import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const path=new URL('../scripts/install-update-broker.sh',import.meta.url).pathname;
const text=readFileSync(path,'utf8');
const run=(...args)=>spawnSync('bash',[path,...args],{
  encoding:'utf8',timeout:20000,env:{...process.env}
});
test('broker explicit CLI advertises check/apply/verify/activate and disabled default',()=>{
 const r=run('--help');
 assert.equal(r.status,0,r.stderr);
 for(const flag of ['--check','--apply','--verify','--activate','--ack-acceptance']){
  assert.match(r.stdout,new RegExp(flag));
 }
 assert.match(r.stdout,/DISABLED/);
});
test('no arguments or unsupported flags refuse any installation',()=>{
 for(const args of [[],['--nonsense'],['--check','--apply'],['--apply','--ack-acceptance']]){
  const r=run(...args);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/BLOCK/);
 }
});
test('check mode is read-only and reports a blocker on unprovisioned hosts',()=>{
 const r=run('--check');
 // In CI this may block on sudo/EUID or missing pre-existing panel. Both
 // are fail-closed. Test should never try to install a root service.
 assert.notEqual(r.status,0);
 assert.match(r.stdout+r.stderr,/READ ONLY|sudo\/root/);
});
test('apply does not start watcher, enable Web gate or reboot services',()=>{
 const start=text.indexOf('if [[ "$MODE" == apply ]];then');
 const end=text.indexOf('# Explicit separate release gate',start);
 assert.ok(start>0&&end>start);
 const apply=text.slice(start,end);
 assert.match(apply,/fresh_checks/);
 assert.match(apply,/installed_checks/);
 assert.match(apply,/panel-state.before-broker.json/);
 assert.match(apply,/chown -R linuxpanel-updater:linuxpanel/);
 assert.doesNotMatch(apply,/systemctl enable|systemctl restart linux-panel/);
 assert.doesNotMatch(apply,/PANEL_UPDATER_ENABLED=1/);
});
test('activation is gated by acceptance and has disable-on-failure handling',()=>{
 assert.match(text,/\(\(ACK==1\)\) \|\| die/);
 assert.match(text,/systemctl enable --now linux-panel-update.path/);
 assert.match(text,/systemctl disable --now linux-panel-update.path/);
 assert.match(text,/PANEL_UPDATER_ENABLED=1/);
 assert.match(text,/panel.env.before-activation/);
});
test('preflight/verify check pinned GitHub source and effective sandbox',()=>{
 assert.match(text,/branch --show-current/);
 assert.match(text,/status --porcelain/);
 assert.match(text,/remote get-url origin/);
 assert.match(text,/ProtectSystem/);
 assert.match(text,/NoNewPrivileges/);
 assert.match(text,/ReadWritePaths/);
 assert.match(text,/runuser -u linuxpanel-updater -- git/);
 assert.match(text,/version>=240/);
 assert.doesNotMatch(text,/rm -rf|git reset --hard|systemctl reload nginx/);
});


test('real Git cleanliness preflight survives bash nounset and fails closed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'linux-panel-broker-nounset-'));
 try{
  const init=spawnSync('git',['init','-q','-b','main',dir],{encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);
  const remote=spawnSync('git',['-C',dir,'remote','add','origin',
    'https://github.com/example/linux-panel.git'],{encoding:'utf8'});
  assert.equal(remote.status,0,remote.stderr);
  const start=text.indexOf(" local git_branch=''");
  const end=text.indexOf('\n local f\n',start);
  assert.ok(start>0 && end>start,'Git preflight section must remain testable');
  const code=text.slice(start,end);
  const perform=(brokenStatus=false)=>spawnSync('bash',['-c',[
    'set -Eeuo pipefail',
    'ROOT='+JSON.stringify(dir),
    'pass(){ printf "PASS: %s\\n" "$1"; }',
    'block(){ printf "BLOCK: %s\\n" "$1"; }',
    'git_checked(){',
    brokenStatus? 'if [[ "$1" == status ]]; then return 123; fi':'',
    'git -C "$ROOT" "$@";',
    '}',
    'preflight(){',code,'}',
    'preflight'
  ].join('\n')],{encoding:'utf8',timeout:20000});
  const clean=perform();
  assert.equal(clean.status,0,clean.stderr);
  assert.match(clean.stdout,/PASS: Git checkout clean/);
  writeFileSync(join(dir,'untracked-file'),'dirty');
  const dirty=perform();
  assert.equal(dirty.status,0,dirty.stderr);
  assert.match(dirty.stdout,/BLOCK: Git checkout dirty/);
  assert.doesNotMatch(dirty.stdout,/PASS: Git checkout clean/);
  const failed=perform(true);
  assert.equal(failed.status,0,failed.stderr);
  assert.match(failed.stdout,/BLOCK: Git status failed/);
  assert.doesNotMatch(failed.stdout,/PASS: Git checkout clean/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
