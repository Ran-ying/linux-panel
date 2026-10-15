import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createUpdateController } from '../platform/update-controller.js';

const execFile = promisify(execFileCb);

// CI uses a different real OS owner when passwordless sudo is available,
// unlike Git's optional test hook (not enabled in every distro Git build).
test('Web Git revision check accepts only configured foreign-owned checkout',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lp-update-ownership-'));
  const root=join(dir,'checkout');
  let foreignOwner=false;
  t.after(async()=>{
    if(foreignOwner) {
      await execFile('sudo',['-n','chown','-R',
        `${process.getuid()}:${process.getgid()}`,root]);
    }
    await rm(dir,{recursive:true,force:true});
  });
  await execFile('git',['init','-q',root]);
  await execFile('git',['-C',root,'-c','user.name=Test','-c','user.email=test@example.invalid',
    'commit','--allow-empty','-qm','initial']);
  const head=(await execFile('git',['-C',root,'rev-parse','HEAD'])).stdout.trim();
  assert.match(head,/^[a-f0-9]{40}$/);

  if(process.getuid?.()!==0) {
    try {
      await execFile('sudo',['-n','chown','-R','0:0',root],{timeout:5000});
      foreignOwner=true;
    } catch { /* Local development without passwordless sudo still tests parsing. */ }
  }
  if(foreignOwner) {
    await assert.rejects(execFile('git',['-C',root,'rev-parse','HEAD'],
      {env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}),/dubious ownership/i,
      'Web user must reproduce Git different-owner failure without exception');
  } else {
    t.diagnostic('Cross-UID ownership fixture unavailable on this host; parsing still checked.');
  }
  const ctrl=createUpdateController({store:{},root,auth:{},enabled:true});
  assert.deepEqual(await ctrl.check({targetSha:head}),{
    status:'up_to_date',currentSha:head,targetSha:head,source:'supplied_sha'
  });
  const newer='f'.repeat(40);
  const candidate=await ctrl.check({targetSha:newer});
  assert.equal(candidate.status,'update_available');
  assert.equal(candidate.currentSha,head);
  assert.equal(candidate.targetSha,newer);
});
