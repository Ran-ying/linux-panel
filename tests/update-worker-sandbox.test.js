// Disposable, rootless behavioral integration test for the fixed broker worker.
// Production absolute paths/privileged calls are changed only in a throwaway copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync,statSync,chmodSync,symlinkSync,readlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const original=readFileSync(new URL('../scripts/update-worker.sh',import.meta.url),'utf8');
const exec=(cmd,args,options={})=>{
 const x=spawnSync(cmd,args,{encoding:'utf8',timeout:20000,...options});
 assert.equal(x.status,0,cmd+': '+x.stderr);
 return x.stdout.trim();
};
const swap=(s,a,b)=>{
 assert.equal(s.split(a).length,2,'Expected unique worker anchor: '+a);
 return s.replace(a,b);
};
function prepare({withPrivileged=false}={}){
 const base=mkdtempSync(join(tmpdir(),'lp-updater-stage-'));
 const root=join(base,'code'),bare=join(base,'remote.git'),state=join(base,'state');
 const backup=join(base,'backup'),status=join(base,'status'),bin=join(base,'bin'),runtime=join(base,'run');
 for(const d of [root,state,backup,status,bin,runtime])mkdirSync(d,{recursive:true});
 exec('git',['init','-q','--bare',bare]);
 exec('git',['init','-q','-b','main',root]);
 exec('git',['-C',root,'config','user.name','Test']);
 exec('git',['-C',root,'config','user.email','test@example.invalid']);
 writeFileSync(join(root,'version'),'1\n');
 mkdirSync(join(root,'apps','api','src'),{recursive:true});
 writeFileSync(join(root,'package.json'),'{"name":"fixture","type":"module","version":"1.0.0"}\n');
 writeFileSync(join(root,'apps','api','src','server.js'),'export const version = 1;\n');
 writeFileSync(join(root,'apps','api','src','create-app.js'),'export const boot = 1;\n');
 writeFileSync(join(root,'.gitignore'),'node_modules/\napps/web/dist/\n');
 mkdirSync(join(root,'platform','privileged'),{recursive:true});
 const manifest={version:1,files:['server.js','handlers.js'],dependencies:['ajv']};
 writeFileSync(join(root,'platform','privileged','package-manifest.json'),JSON.stringify(manifest)+'\n');
 writeFileSync(join(root,'platform','privileged','server.js'),'export const ok = true;\n');
 writeFileSync(join(root,'platform','privileged','handlers.js'),
   'export function createPrivilegedHandlers(){return new Map([["old",true]])}\n');
 exec('git',['-C',root,'add','.']);
 exec('git',['-C',root,'commit','-qm','first']);
 const old=exec('git',['-C',root,'rev-parse','HEAD']);
 const remote='file://'+bare;
 exec('git',['-C',root,'remote','add','origin',remote]);
 exec('git',['-C',root,'push','-q','-u','origin','main']);
 writeFileSync(join(root,'version'),'2\n');
 writeFileSync(join(root,'package.json'),'{"name":"fixture","type":"module","version":"2.0.0"}\n');
 writeFileSync(join(root,'apps','api','src','create-app.js'),'export const boot = 2;\n');
 writeFileSync(join(root,'platform','privileged','handlers.js'),
   'export function createPrivilegedHandlers(){return new Map([["target",true]])}\n');
 exec('git',['-C',root,'commit','-qam','second']);
 const target=exec('git',['-C',root,'rev-parse','HEAD']);
 exec('git',['-C',root,'push','-q','origin','main']);
 exec('git',['-C',root,'reset','--hard',old]);
 // Simulate restrictive checkout ownership after Git reset under umask 077.
 chmodSync(join(root,'package.json'),0o600);
 chmodSync(join(root,'apps','api','src','create-app.js'),0o600);
 chmodSync(join(root,'apps','api','src'),0o700);
 // The original installed service already has runtime dependencies available
 // even when backup fails before the update reaches npm ci.
 mkdirSync(join(root,'node_modules','fastify'),{recursive:true});
 writeFileSync(join(root,'node_modules','fastify','package.json'),'{"name":"fastify"}\n');
 mkdirSync(join(root,'node_modules','ajv'),{recursive:true});
 writeFileSync(join(root,'node_modules','ajv','package.json'),'{"name":"ajv"}\n');
 writeFileSync(join(state,'panel-state.json'),'{"original":true}\n');
 const env=join(base,'panel.env'),pin=join(base,'pin');
 writeFileSync(env,'PANEL_LISTEN_PORT=4188\nPANEL_PUBLIC_ORIGIN=http://127.0.0.1:4188\n');
 writeFileSync(pin,remote+'\n');
 const fake=(name,text)=>writeFileSync(join(bin,name),'#!/bin/sh\n'+text+'\n',{mode:0o755});
 fake('systemctl','printf "systemctl:%s\n" "$1" >> "$TEST_LOG"\nexit 0');
 fake('curl','if [ "$FAIL_HEALTH_ALL" = 1 ]; then exit 22; fi\nif [ "$FAIL_HEALTH" = 1 ] && [ "$(git -C "$TEST_ROOT" rev-parse HEAD)" = "$TEST_TARGET" ]; then exit 22; fi\nexit 0');
 fake('sleep','exit 0');
 fake('chown','exit 0');
 fake('chgrp','printf "chgrp:%s\\n" "$*" >> "$TEST_LOG"\nexit 0');
 fake('df','printf "Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 5000000 0 %s 0%% /\\n" "${TEST_FREE_KIB:-4000000}"');
 fake('install',"src=; dst=; for x do src=\"$dst\"; dst=\"$x\"; done\nif [ \"$FAIL_SNAPSHOT_COPY\" = 1 ];then\n case \"$dst\" in */.state-snapshot.*)\n   printf 'truncated backup bytes' > \"$dst\"\n   exit 28\n   ;;\n esac\nfi\nexec /bin/cp -- \"$src\" \"$dst\"");
 // Simulate real npm removing/reinstalling dependencies under worker umask 077.
 // The Web account is a different UID and must receive group read/execute.
 fake('npm',`if [ "$1" = ci ]; then
 mkdir -p "$TEST_ROOT/node_modules/fastify" "$TEST_ROOT/node_modules/ajv"
 printf '{"name":"fastify"}\\n' > "$TEST_ROOT/node_modules/fastify/package.json"
 printf '{"name":"ajv"}\\n' > "$TEST_ROOT/node_modules/ajv/package.json"
 chmod 0700 "$TEST_ROOT/node_modules" "$TEST_ROOT/node_modules/fastify"
 chmod 0600 "$TEST_ROOT/node_modules/fastify/package.json"
 fi
 if [ "$FAIL_BUILD" = 1 ] && [ "$1" = test ]; then exit 19; fi
 if [ "$FAIL_ROLLBACK" = 1 ] && [ "$1" = run ] && [ "$2" = build:web ]; then exit 37; fi
 if [ "$1" = run ] && [ "$2" = build:web ]; then
 mkdir -p "$TEST_ROOT/apps/web/dist"
 printf '<html>ok</html>\\n' > "$TEST_ROOT/apps/web/dist/index.html"
 chmod 0700 "$TEST_ROOT/apps/web/dist"
 chmod 0600 "$TEST_ROOT/apps/web/dist/index.html"
 fi
 exit 0`);
 const meminfo=join(base,'meminfo');
 writeFileSync(meminfo,'MemAvailable:    3000000 kB\\nSwapFree:    3000000 kB\\n'.replaceAll('\\n','\n'));
 let worker=original.replaceAll('/proc/meminfo',JSON.stringify(meminfo));
 const privRoot=join(base,'privileged');
 if(withPrivileged){
   mkdirSync(join(privRoot,'releases',old,'node_modules'),{recursive:true});
   writeFileSync(join(privRoot,'releases',old,'.ready'),old+'\n');
   writeFileSync(join(privRoot,'releases',old,'handlers.js'),'// old release\n');
   symlinkSync('releases/'+old,join(privRoot,'current'));
   writeFileSync(join(base,'socket-ready'),'fixture');
 }
 worker=swap(worker,'PRIV_ROOT=/usr/local/lib/linux-panel-privileged','PRIV_ROOT='+JSON.stringify(privRoot));
 worker=swap(worker,'/opt/node24/bin/node --input-type=module -e',JSON.stringify(process.execPath)+' --input-type=module -e');
 worker=worker.replaceAll('[[ -S /run/linux-panel-privileged/executor.sock ]]','[[ -f '+JSON.stringify(join(base,'socket-ready'))+' ]]');
 worker=swap(worker,'"$(stat -c %u "$PRIV_ROOT")" -eq 0','-O "$PRIV_ROOT"');
 worker=swap(worker,'"$(stat -c %u "$PRIV_RELEASES")" -eq 0','-O "$PRIV_RELEASES"');
 worker=swap(worker,'"$(stat -c %u "$pkg")" -eq 0','-O "$pkg"');
 worker=swap(worker,'"$(stat -c %U "$source")" == "$USER"','-O "$source"');
 for(const [a,b] of [
  ['ROOT=/opt/linux-panel','ROOT='+JSON.stringify(root)],
  ['STATE=/var/lib/linux-panel','STATE='+JSON.stringify(state)],
  ['ROOT_BACKUP=/var/lib/linux-panel-update-root','ROOT_BACKUP='+JSON.stringify(backup)],
  ['RESULT=/var/lib/linux-panel-update-status/result.json','RESULT='+JSON.stringify(join(status,'result.json'))],
  ['EXPECTED_REMOTE=/etc/linux-panel/update-source','EXPECTED_REMOTE='+JSON.stringify(pin)],
  ['PANEL_ENV=/etc/linux-panel/panel.env','PANEL_ENV='+JSON.stringify(env)],
  ['exec 9> /run/linux-panel-root-updater/update.lock','exec 9> '+JSON.stringify(join(base,'update.lock'))],
  ['ALLOW_START=/run/linux-panel-root-updater/allow-panel-start','ALLOW_START='+JSON.stringify(join(runtime,'allow-panel-start'))],
  ['[[ -d /run/linux-panel-root-updater ]] || return 1','[[ -d '+JSON.stringify(runtime)+' ]] || return 1'],
  ['[[ "$EUID" -eq 0 ]] || exit 2',':'],
  ['"$(stat -c %u:%a "$TXN")" == 0:600','"$(stat -c %a "$TXN")" == 600'],
  ['"$(stat -c %u:%a "$backup")" == 0:600','"$(stat -c %a "$backup")" == 600'],
  ['export PATH=/usr/sbin:/usr/bin:/sbin:/bin','export PATH='+JSON.stringify(bin)+':/usr/sbin:/usr/bin:/sbin:/bin'],
  ['as_updater(){ /usr/bin/setpriv --reuid="$USER" --regid="$USER" --init-groups --inh-caps=-all --no-new-privs -- /usr/bin/env -i HOME=/var/lib/linux-panel-updater USER="$USER" LOGNAME="$USER" GIT_TERMINAL_PROMPT=0 PATH=/opt/node24/bin:/opt/linux-panel/runtime:/usr/local/bin:/usr/bin:/bin "$@"; }','as_updater(){ "$@"; }'],
  ['web_can_read(){\n  /usr/bin/setpriv --reuid=linuxpanel --regid=linuxpanel --init-groups --inh-caps=-all --no-new-privs -- /usr/bin/test -r "$1"\n}','web_can_read(){ /usr/bin/test -r "$1"; }'],
  ['"$(stat -c %U "$ROOT")" == "$USER"','-O "$ROOT"'],
  ['"$(stat -c %U "$path")" != "$USER"','! -O "$path"'],
  ['"$(stat -c %U "$parent")" != "$USER"','! -O "$parent"'],
  ['[[ -d "$ROOT_BACKUP" && ! -L "$ROOT_BACKUP" && "$(stat -c %u "$ROOT_BACKUP")" -eq 0 ]] || { record failed;exit 2; }','[[ -d "$ROOT_BACKUP" && ! -L "$ROOT_BACKUP" ]] || { record failed; exit 2; }']
 ])worker=swap(worker,a,b);
 const securityLine=worker.split('\n').find(x=>x.includes('[[ "$EXPECTED" =~ ^('));
 assert.ok(securityLine,'production must validate pinned remote');
 worker=swap(worker,securityLine,'[[ "$EXPECTED" == '+JSON.stringify(remote)+' ]] || { record failed; exit 2; }');
 // Test-only Bash builtin fault injection: emulate a kernel returning ENOSPC
 // AFTER writing partial bytes (a much harder case than preflight low df).
 worker=swap(worker,'record(){',`printf(){
  if [[ "\${TEST_PARTIAL_JOURNAL:-0}" == 1 &&
        "$1" == 'id=%s\\nsha=%s\\nold=%s\\n' ]];then
    builtin printf 'id=partial\\n'
    return 28
  fi
  if [[ "\${TEST_PARTIAL_RESULT:-0}" == 1 &&
        "$1" == '{"id":"%s","sha":"%s","status":"%s","at":"%s"}\\n' ]];then
    builtin printf '{"id":"partial"'
    return 28
  fi
  builtin printf "$@"
}
record(){`);
 const script=join(base,'worker.sh'),log=join(base,'events.log');
 let sequence=0;
 writeFileSync(log,'');
 writeFileSync(script,worker,{mode:0o700});
 exec('bash',['-n',script]);
 return {base,root,state,status,script,log,old,target,meminfo,privRoot,
  cleanup(){rmSync(base,{recursive:true,force:true})},
  run({sha=target,build=false,health=false,healthEverywhere=false,rollback=false,lowDisk=false,partialJournal=false,partialResult=false,partialBackup=false}={}){
   const id=(++sequence).toString(16).padStart(32,'0');
   writeFileSync(join(state,'update-trigger'),'id='+id+'\nsha='+sha+'\n');
   const process=spawnSync('bash',[script],{encoding:'utf8',timeout:20000,env:{
    ...globalThis.process.env,TEST_LOG:log,FAIL_BUILD:build?'1':'0',
    FAIL_HEALTH:health?'1':'0',FAIL_HEALTH_ALL:healthEverywhere?'1':'0',
     TEST_ROOT:root,TEST_TARGET:target,FAIL_ROLLBACK:rollback?'1':'0',
    TEST_FREE_KIB:lowDisk?'900000':'4000000',
    TEST_PARTIAL_JOURNAL:partialJournal?'1':'0',
    TEST_PARTIAL_RESULT:partialResult?'1':'0',
    FAIL_SNAPSHOT_COPY:partialBackup?'1':'0'
   }});
   const result=existsSync(join(status,'result.json'))?
    JSON.parse(readFileSync(join(status,'result.json'),'utf8')):null;
   return {process,result,head:exec('git',['-C',root,'rev-parse','HEAD']),
    state:readFileSync(join(state,'panel-state.json'),'utf8')};
  }
 };
}
for(const scenario of [
 {name:'successful fast-forward',options:{},expected:'success',updated:true},
 {name:'incorrect origin/main SHA',options:{sha:'a'.repeat(40)},expected:'failed',updated:false},
 {name:'build failure rollback',options:{build:true},expected:'rolled_back',updated:false},
 {name:'HTTP health failure rollback',options:{health:true},expected:'rolled_back',updated:false},
 {name:'old Web also unhealthy preserves root recovery journal',options:{healthEverywhere:true},expected:'failed',updated:false},
 {name:'rollback build failure reports failure',options:{build:true,rollback:true},expected:'failed',updated:false}
]){
 test('isolated updater worker: '+scenario.name,()=>{
  const f=prepare();
  try{
   const out=f.run(scenario.options);
   assert.equal(out.result.status,scenario.expected,JSON.stringify(out.process));
   assert.equal(out.head,scenario.updated?f.target:f.old);
   assert.equal(out.state,'{"original":true}\n');
   if(scenario.options.rollback || scenario.options.healthEverywhere){
     assert.equal(existsSync(join(f.base,'backup','active-transaction')),true,
       'A failed rollback must retain a root transaction journal for retry');
   }
  }finally{f.cleanup();}
 });
}

test('isolated updater worker: retry after rollback retains independent backup',()=>{
 const f=prepare();
 try{
   const first=f.run({build:true});
   assert.equal(first.result.status,'rolled_back');
   assert.equal(first.head,f.old);
   const second=f.run();
   assert.equal(second.result.status,'success');
   assert.equal(second.head,f.target);
 }finally{f.cleanup();}
});

test('recovery-only cannot consume an unapproved new trigger',()=>{
 const f=prepare();
 try{
  writeFileSync(join(f.state,'update-trigger'),'id='+'b'.repeat(32)+'\nsha='+f.target+'\n');
  const r=spawnSync('bash',[f.script,'--recover-only'],{
    encoding:'utf8',timeout:20000,env:{...process.env,TEST_LOG:f.log,TEST_ROOT:f.root}
  });
  assert.equal(r.status,0,r.stderr);
  assert.equal(readFileSync(join(f.state,'update-trigger'),'utf8').split('\n')[0],
    'id='+'b'.repeat(32));
  assert.equal(exec('git',['-C',f.root,'rev-parse','HEAD']),f.old);
 }finally{f.cleanup();}
});

test('1 GiB disk threshold refuses only genuinely low space before service interruption',()=>{
 const f=prepare();
 try{
  const blocked=f.run({lowDisk:true});
  assert.equal(blocked.result.status,'failed');
  assert.equal(blocked.head,f.old);
  assert.doesNotMatch(readFileSync(f.log,'utf8'),/systemctl:stop/);
  assert.match(blocked.process.stdout,/Insufficient free storage/);
 }finally{f.cleanup();}
});
test('low memory + swap refuses before touching panel and high memory allows update',()=>{
 const f=prepare();
 try{
  writeFileSync(f.meminfo,'MemAvailable: 200000 kB\nSwapFree: 200000 kB\n');
  const blocked=f.run();
  assert.equal(blocked.result.status,'failed');
  assert.equal(blocked.head,f.old);
  assert.doesNotMatch(readFileSync(f.log,'utf8'),/systemctl:stop/);
  assert.match(blocked.process.stdout,/Memory \+ swap below 768 MiB/);
 }finally{f.cleanup();}
});

test('partial ENOSPC journal write never publishes root journal or stops Web',()=>{
 const f=prepare();
 try {
  const out=f.run({partialJournal:true});
  assert.notEqual(out.process.status,0,'Journal failure must reject the job');
  assert.equal(out.result?.status,'failed','Reject transaction before stopping service');
  assert.equal(out.head,f.old);
  assert.equal(out.state,'{"original":true}\n');
  assert.equal(existsSync(join(f.base,'backup','active-transaction')),false);
  assert.doesNotMatch(readFileSync(f.log,'utf8'),/systemctl:stop/);
 }finally{f.cleanup();}
});

test('partial ENOSPC status write never exposes malformed JSON as result',()=>{
 const f=prepare();
 try {
  const out=f.run({sha:'a'.repeat(40),partialResult:true});
  assert.notEqual(out.process.status,0);
  assert.equal(out.result,null,'Failed atomic status must leave no result');
  assert.equal(out.head,f.old);
  assert.equal(existsSync(join(f.base,'status','result.json')),false);
  assert.equal(existsSync(join(f.base,'backup','active-transaction')),false);
 }finally{f.cleanup();}
});

test('partial backup ENOSPC preserves original state, journal and retryable recovery',()=>{
 const f=prepare();
 try {
  const out=f.run({partialBackup:true});
  assert.notEqual(out.process.status,0,'Partial backup must abort the job');
  assert.equal(out.result?.status,'failed');
  assert.equal(out.head,f.old,'No new Git revision may be published');
  assert.equal(out.state,'{"original":true}\n');
  assert.equal(existsSync(join(f.base,'backup','active-transaction')),true);
  assert.equal(existsSync(join(f.state,'update-processing')),true);
  const items=readFileSync(f.log,'utf8');
  assert.match(items,/systemctl:stop/);
  assert.match(items,/systemctl:start/,'Old Web should restart after failed backup');
  const entries=readdirSync(join(f.base,'backup'));
  assert.ok(entries.some(x=>x==='active-transaction'));
  assert.ok(!entries.some(x=>x.startsWith('.state-snapshot.')),
    'Truncated backup temp must not remain');
  assert.ok(!entries.some(x=>x.startsWith('panel-state.json.before-')),
    'Truncated snapshot must never be published as a trusted backup');
  const restored=spawnSync('bash',[f.script,'--recover-only'],{
    encoding:'utf8',timeout:20000,env:{...process.env,TEST_LOG:f.log,TEST_ROOT:f.root}
  });
  assert.equal(restored.status,0,JSON.stringify(restored));
  const final=JSON.parse(readFileSync(join(f.status,'result.json'),'utf8'));
  assert.equal(final.status,'rolled_back');
  assert.equal(existsSync(join(f.base,'backup','active-transaction')),false);
  assert.equal(existsSync(join(f.state,'update-processing')),false);
  assert.equal(readFileSync(join(f.state,'panel-state.json'),'utf8'),
    '{"original":true}\n');
  assert.equal(exec('git',['-C',f.root,'rev-parse','HEAD']),f.old);
 }finally{f.cleanup();}
});

test('generated artifacts retain restricted world permissions and gain Web group read on update AND rollback',()=>{
 for(const rollback of [false,true]){
  const f=prepare();
  try{
   const out=f.run({health:rollback});
   assert.equal(out.result.status,rollback?'rolled_back':'success',
     JSON.stringify(out.process));
   for(const path of [
     join(f.root,'node_modules'),
     join(f.root,'node_modules','fastify'),
     join(f.root,'node_modules','fastify','package.json'),
     join(f.root,'apps','web','dist'),
     join(f.root,'apps','web','dist','index.html')
   ]){
     const mode=statSync(path).mode & 0o777;
     assert.ok(mode & 0o040, `Web group needs read: ${path} (${mode.toString(8)})`);
     assert.equal(mode & 0o007,0,`World must have no access: ${path}`);
     if(statSync(path).isDirectory())
       assert.ok(mode & 0o010,`Web group needs directory traverse: ${path}`);
   }
   const chmodLog=readFileSync(f.log,'utf8');
   const checks=chmodLog.match(/chgrp:/g)??[];
   assert.ok(checks.length>=(rollback?4:2),
     'Artifact normalization must run again after rollback rebuild');
  }finally{f.cleanup();}
 }
});

test('tracked source and root package manifest get Web group read/traverse on update and rollback',()=>{
 for(const rollback of [false,true]){
  const f=prepare();
  try{
   const initial=readFileSync(join(f.state,'panel-state.json'),'utf8');
   const out=f.run({health:rollback});
   assert.equal(out.result.status,rollback?'rolled_back':'success',
    JSON.stringify(out.process));
   assert.equal(readFileSync(join(f.state,'panel-state.json'),'utf8'),initial);
   for(const path of [
    join(f.root,'package.json'),
    join(f.root,'apps','api','src','server.js'),
    join(f.root,'apps','api','src','create-app.js'),
    join(f.root,'apps','api','src')
   ]){
    const mode=statSync(path).mode & 0o777;
    assert.ok(mode & 0o040,'Missing Web group read: '+path+' '+mode.toString(8));
    assert.equal(mode & 0o007,0,'World access must remain denied: '+path);
    if(statSync(path).isDirectory())
     assert.ok(mode & 0o010,'Web needs directory traverse: '+path);
   }
  }finally{f.cleanup();}
 }
});

test('versioned root package switches with pinned Git target and Web health',()=>{
 const f=prepare({withPrivileged:true});
 try{
  const out=f.run();
  assert.equal(out.result?.status,'success',JSON.stringify(out.process));
  assert.equal(readlinkSync(join(f.privRoot,'current')),'releases/'+f.target);
  assert.ok(existsSync(join(f.privRoot,'releases',f.target,'.ready')));
  assert.match(readFileSync(join(f.privRoot,'releases',f.target,'handlers.js'),'utf8'),/target/);
  assert.equal(out.head,f.target);
 }finally{f.cleanup();}
});
test('versioned root package rolls back together with Web after health failure',()=>{
 const f=prepare({withPrivileged:true});
 try{
  const out=f.run({health:true});
  assert.equal(out.result?.status,'rolled_back',JSON.stringify(out.process));
  assert.equal(readlinkSync(join(f.privRoot,'current')),'releases/'+f.old);
  assert.equal(out.head,f.old);
 }finally{f.cleanup();}
});
