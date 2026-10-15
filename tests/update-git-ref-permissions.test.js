import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, statSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const installer = readFileSync(new URL('../scripts/install-update-broker.sh',import.meta.url),'utf8');
function cmd(executable,args,opts={}) {
  const r=spawnSync(executable,args,{encoding:'utf8',timeout:10000,...opts});
  assert.equal(r.status,0,r.stderr||r.stdout);
  return r.stdout.trim();
}
test('fresh Broker installer provisions group-read-only Git references, not group-write',()=>{
  assert.match(installer,/core\.sharedRepository 0640/);
  assert.match(installer,/chmod -- g\+rx,g\+s,g-w,o-w "\$d"/);
  assert.match(installer,/chmod -- g\+r,g-w,o-w "\$f"/);
  assert.match(installer,/chgrp -- linuxpanel "\$d"/);
  assert.match(installer,/chgrp -- linuxpanel "\$f"/);
  assert.match(installer,/runuser -u linuxpanel -- git -c "safe\.directory=\$ROOT" -C "\$ROOT" rev-parse HEAD/);
  assert.doesNotMatch(installer,/core\.sharedRepository group/);
});

test('Git refs remain group-readable after restrictive umask 077 and repeated commits',()=>{
  const dir=mkdtempSync(join(tmpdir(),'lp-git-ref-web-'));
  try {
    cmd('git',['init','-q','-b','main',dir]);
    cmd('git',['-C',dir,'config','user.name','Fixture']);
    cmd('git',['-C',dir,'config','user.email','fixture@example.invalid']);
    writeFileSync(join(dir,'first'),'v1\n');
    cmd('git',['-C',dir,'add','first']);
    cmd('git',['-C',dir,'commit','-qm','first']);
    const git=join(dir,'.git');
    cmd('git',['-C',dir,'config','--local','core.sharedRepository','0640']);
    for(const name of [git,join(git,'refs'),join(git,'refs','heads'),join(git,'objects')]) {
      cmd('chmod',['g+rx,g+s,g-w,o-w',name]);
      assert.notEqual(statSync(name).mode&0o2000,0,'Git directory must inherit group');
    }
    for(let i=2;i<=4;i++){
      writeFileSync(join(dir,'first'),'v'+i+'\n');
      cmd('bash',['-c','umask 077; git -C "$1" add first; git -C "$1" commit -qm "next"', 'bash',dir]);
      const head=join(git,'refs','heads','main');
      const mode=statSync(head).mode&0o777;
      assert.ok(mode&0o040, 'Web group must retain read on replaced main ref');
      assert.equal(mode&0o020,0, 'Web group must never gain write access');
      assert.equal(mode&0o007,0, 'Other users must never gain access');
      assert.match(cmd('git',['-C',dir,'rev-parse','HEAD']),/^[a-f0-9]{40}$/);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
