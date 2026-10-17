import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync,rmSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const worker=readFileSync(new URL('../scripts/update-worker.sh',import.meta.url),'utf8');
const installer=readFileSync(new URL('../scripts/install-update-broker.sh',import.meta.url),'utf8');
const aclHelper=new URL('../scripts/configure-git-web-acl.py',import.meta.url).pathname;
const restrictedGit=new URL('./helpers/restrict-sgid-exec.py',import.meta.url).pathname;
function cmd(executable,args,{expect=0,...extra}={}){
 const result=spawnSync(executable,args,{encoding:'utf8',timeout:15000,...extra});
 assert.equal(result.status,expect,JSON.stringify({exe:executable,args,status:result.status,stderr:result.stderr}));
 return result.stdout.trim();
}
test('fresh installer uses local umask + inherited ACL and NEVER numeric Git sharedRepository',()=>{
 assert.match(installer,/core\.sharedRepository umask/);
 assert.match(installer,/configure-git-web-acl\.py/);
 assert.doesNotMatch(installer,/core\.sharedRepository 0640/);
 assert.doesNotMatch(installer,/RestrictSUIDSGID=no/);
 const helper=readFileSync(aclHelper,'utf8');
 assert.match(helper,/system\.posix_acl_default/);
 assert.match(helper,/system\.posix_acl_access/);
 assert.match(helper,/ACL_MASK, group_bits/);
 assert.doesNotMatch(helper,/chmod\s.*g\+w/);
});

test('new Git loose objects are repaired for group read without group write',t=>{
 if(process.platform!=='linux')return t.skip('POSIX ACLs require Linux');
 const embedded=worker.match(/<<'PY_GIT_OBJECT_ACL'\n([\s\S]+?)\nPY_GIT_OBJECT_ACL/);
 assert.ok(embedded,'Immutable worker must own the repair code');
 assert.match(worker,/ensure_git_objects_web_readable \|\| \{ record failed;exit 2; \}/);
 assert.match(worker,/ensure_tracked_web_read_access && ensure_git_objects_web_readable/);
 const root=mkdtempSync(join(tmpdir(),'lp-objects-acl-'));
 try{
  cmd('git',['init','-q',root]);
  cmd('git',['-C',root,'config','user.name','Fixture']);
  cmd('git',['-C',root,'config','user.email','fixture@example.invalid']);
  writeFileSync(join(root,'probe.txt'),'object permission probe\n');
  cmd('git',['-C',root,'add','probe.txt']);
  cmd('git',['-C',root,'commit','-qm','probe']);
  const sha=cmd('git',['-C',root,'rev-parse','HEAD']);
  const loose=join(root,'.git','objects',sha.slice(0,2),sha.slice(2));
  chmodSync(loose,0o400);
  assert.equal(statSync(loose).mode&0o070,0,'Fixture must start with group-inaccessible object');
  const user=cmd('id',['-un']),group=cmd('id',['-gn']);
  const repair=spawnSync('python3',['-I','-',root,user,group],{
   input:embedded[1],encoding:'utf8',timeout:15000
  });
  assert.equal(repair.status,0,repair.stderr);
  assert.ok(statSync(loose).mode&0o040,'Git commit object should be group readable');
  assert.equal(statSync(loose).mode&0o020,0,'Web group must not be able to write object');
  assert.equal(statSync(loose).mode&0o007,0,'No public object access');
  assert.equal(cmd('git',['-C',root,'cat-file','-t','HEAD']),'commit');
  assert.equal(cmd('git',['-C',root,'status','--porcelain']),'');
  // Symlinks must be rejected rather than followed to adjust outside files.
  const external=join(root,'outside.txt');
  writeFileSync(external,'untouched\n');
  chmodSync(external,0o600);
  symlinkSync(external,join(root,'.git','objects','malicious-link'));
  const refused=spawnSync('python3',['-I','-',root,user,group],{
   input:embedded[1],encoding:'utf8',timeout:15000
  });
  assert.notEqual(refused.status,0,'Symlink entry must fail closed');
  assert.equal(statSync(external).mode&0o777,0o600,'Symlink target must not be modified');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Git fetch under RestrictSUIDSGID succeeds after ACL repair, repeated refs stay Web-readable',t=>{
 if(process.platform!=='linux')return t.skip('POSIX ACL and seccomp only on Linux');
 const available=spawnSync('python3',[restrictedGit,'--check'],{encoding:'utf8'});
 if(available.status===77)return t.skip('libseccomp not available on this host');
 assert.equal(available.status,0,available.stderr);
 const root=mkdtempSync(join(tmpdir(),'lp-git-acl-'));
 const source=join(root,'source'),remote=join(root,'origin.git'),target=join(root,'target');
 try{
  cmd('git',['init','-q','--bare',remote]);
  cmd('git',['init','-q','-b','main',source]);
  cmd('git',['-C',source,'config','user.name','Fixture']);
  cmd('git',['-C',source,'config','user.email','fixture@example.invalid']);
  writeFileSync(join(source,'test.txt'),'first\n');
  cmd('git',['-C',source,'add','test.txt']);
  cmd('git',['-C',source,'commit','-qm','first']);
  cmd('git',['-C',source,'remote','add','origin',remote]);
  cmd('git',['-C',source,'push','-q','origin','main']);
  cmd('git',['clone','-q','-b','main',remote,target]);
  const group=cmd('id',['-gn']),user=cmd('id',['-un']);
  const gitdir=join(target,'.git');
  // The fixture itself runs inside the real systemd RestrictSUIDSGID
  // sandbox during staging acceptance. Do not set SGID in its setup:
  // numeric sharedRepository alone already triggers the forbidden syscall.
  const commit=(value)=>{
   writeFileSync(join(source,'test.txt'),value+'\n');
   cmd('git',['-C',source,'add','test.txt']);
   cmd('git',['-C',source,'commit','-qm',value]);
   cmd('git',['-C',source,'push','-q','origin','main']);
  };
  cmd('git',['-C',target,'config','core.sharedRepository','0640']);
  commit('second');
  const broken=spawnSync('python3',[restrictedGit,'git','-C',target,'fetch','origin','main'],
   {encoding:'utf8',timeout:10000});
  assert.notEqual(broken.status,0,'Old sharedRepository must fail under seccomp');
  assert.match(broken.stderr,/Operation not permitted/);
  assert.match(broken.stderr,/unable to create temporary file/);

  // Existing operator repair: switch to umask; ACLs inherit on every new file.
  cmd('git',['-C',target,'config','core.sharedRepository','umask']);
  cmd('python3',[aclHelper,'--root',target,'--group',group,'--owner',user]);
  for(const value of ['second','third','fourth']){
   if(value!=='second')commit(value);
   cmd('python3',[restrictedGit,'git','-C',target,'fetch','origin','main']);
   cmd('python3',[restrictedGit,'git','-C',target,'merge','--ff-only','origin/main']);
   const main=join(gitdir,'refs','heads','main');
   const mode=statSync(main).mode&0o777;
   assert.equal(mode&0o020,0,'Group must never gain write');
   assert.equal(mode&0o007,0,'Other users must never gain access');
   assert.ok(mode&0o040,'Web group needs readable Git main ref');
   const hash=cmd('git',['-C',target,'rev-parse','HEAD']);
   assert.match(hash,/^[a-f0-9]{40}$/);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
