import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const run=(args,options={})=>spawnSync('bash',['scripts/setup.sh',...args],{cwd:root,encoding:'utf8',...options});
test('guided setup requires explicit mode without TTY and plans without changes',()=>{
  assert.notEqual(run([]).status,0);
  assert.equal(run(['--help']).status,0);
  const plan=run(['--plan','--port','49331']);
  assert.equal(plan.status,0);
  assert.match(plan.stdout,/install.sh --port 49331/);
  assert.doesNotMatch(plan.stdout,/activate/);
  assert.doesNotMatch(plan.stdout,/enable-privileged/);
  const optin=run(['--plan','--port','49331','--enable-privileged','--privileged-node-bin','/opt/node24/bin/node']);
  assert.equal(optin.status,0,optin.stderr);
  assert.match(optin.stdout,/--enable-privileged/);
  assert.match(optin.stdout,/--privileged-node-bin/);
  assert.notEqual(run(['--check','--apply']).status,0);
  assert.notEqual(run(['--unknown']).status,0);
});
test('stdin bootstrap creates one administrator without printing the password',()=>{
  const temp=mkdtempSync(join(tmpdir(),'panel-init-'));
  const password=randomBytes(24).toString('hex');
  const call=input=>spawnSync(process.execPath,['scripts/admin-init.js','admin','--password-stdin'],{
    cwd:root,encoding:'utf8',input,env:{...process.env,PANEL_DATA_DIR:temp}});
  try {
    const bad=call('short\n');
    assert.notEqual(bad.status,0);
    const good=call(password+'\n');
    assert.equal(good.status,0,good.stderr);
    assert.ok(!good.stdout.includes(password));
    assert.ok(!good.stderr.includes(password));
    assert.ok(!readFileSync(join(temp,'panel-state.json'),'utf8').includes(password));
    assert.notEqual(call(password+'\n').status,0,'repeat bootstrap must refuse replacement');
  } finally {rmSync(temp,{recursive:true,force:true});}
});
test('stdin bootstrap rejects multiple password lines and unknown options',()=>{
  const temp=mkdtempSync(join(tmpdir(),'panel-init-invalid-'));
  try {
    const r=spawnSync(process.execPath,['scripts/admin-init.js','admin','--password-stdin'],{
      cwd:root,encoding:'utf8',input:'long-enough-password\nextra-line\n',env:{...process.env,PANEL_DATA_DIR:temp}});
    assert.notEqual(r.status,0);
    assert.match(r.stderr,/exactly one password line/);
    const wrong=spawnSync(process.execPath,['scripts/admin-init.js','admin','--unknown'],{cwd:root,encoding:'utf8'});
    assert.notEqual(wrong.status,0);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
