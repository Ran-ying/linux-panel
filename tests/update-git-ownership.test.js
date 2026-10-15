import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createUpdateController } from '../platform/update-controller.js';

const execFile = promisify(execFileCb);

// Git's built-in test hook reproduces cross-UID "dubious ownership" without
// requiring root or installing a second system user in ordinary Node CI.
test('Web updater checks source SHA when checkout is owned by another user',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lp-update-ownership-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=join(dir,'checkout');
  await execFile('git',['init','-q',root]);
  await execFile('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid',
    'commit','--allow-empty','-qm','initial']);
  const head=(await execFile('git',['-C',root,'rev-parse','HEAD'])).stdout.trim();
  assert.match(head,/^[a-f0-9]{40}$/);

  const previous=process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER='1';
  t.after(()=>{
    if(previous===undefined) delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
    else process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER=previous;
  });
  await assert.rejects(execFile('git',['-C',root,'rev-parse','HEAD'],
    {env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}),/dubious ownership/i,
  'ordinary Web process must reproduce the Git ownership failure');

  const ctrl=createUpdateController({
    store:{},root,auth:{},enabled:true
  });
  assert.deepEqual(await ctrl.check({targetSha:head}),{
    status:'up_to_date',currentSha:head,targetSha:head,source:'supplied_sha'
  });
  const newer='f'.repeat(40);
  const candidate=await ctrl.check({targetSha:newer});
  assert.equal(candidate.status,'update_available');
  assert.equal(candidate.currentSha,head);
  assert.equal(candidate.targetSha,newer);
});
