// Disposable, rootless behavioral integration test for the fixed broker worker.
// Production absolute paths/privileged calls are changed only in a throwaway copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
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
function prepare(){
 const base=mkdtempSync(join(tmpdir(),'lp-updater-stage-'));
 const root=join(base,'code'),bare=join(base,'remote.git'),state=join(base,'state');
 const backup=join(base,'backup'),status=join(base,'status'),bin=join(base,'bin');
 for(const d of [root,state,backup,status,bin])mkdirSync(d,{recursive:true});
 exec('git',['init','-q','--bare',bare]);
 exec('git',['init','-q','-b','main',root]);
 exec('git',['-C',root,'config','user.name','Test']);
 exec('git',['-C',root,'config','user.email','test@example.invalid']);
 writeFileSync(join(root,'version'),'1\n');
 exec('git',['-C',root,'add','.']);
 exec('git',['-C',root,'commit','-qm','first']);
 const old=exec('git',['-C',root,'rev-parse','HEAD']);
 const remote='file://'+bare;
 exec('git',['-C',root,'remote','add','origin',remote]);
 exec('git',['-C',root,'push','-q','-u','origin','main']);
 writeFileSync(join(root,'version'),'2\n');
 exec('git',['-C',root,'commit','-qam','second']);
 const target=exec('git',['-C',root,'rev-parse','HEAD']);
 exec('git',['-C',root,'push','-q','origin','main']);
 exec('git',['-C',root,'reset','--hard',old]);
 writeFileSync(join(state,'panel-state.json'),'{"original":true}\n');
 const env=join(base,'panel.env'),pin=join(base,'pin');
 writeFileSync(env,'PANEL_LISTEN_PORT=4188\nPANEL_PUBLIC_ORIGIN=http://127.0.0.1:4188\n');
 writeFileSync(pin,remote+'\n');
 const fake=(name,text)=>writeFileSync(join(bin,name),'#!/bin/sh\n'+text+'\n',{mode:0o755});
 fake('systemctl','printf "systemctl:%s\n" "$1" >> "$TEST_LOG"\nexit 0');
 fake('curl','[ "$FAIL_HEALTH" != 1 ]');
 fake('sleep','exit 0');
 fake('chown','exit 0');
 fake('npm','if [ "$FAIL_BUILD" = 1 ] && [ "$1" = test ]; then exit 19; fi\nif [ "$FAIL_ROLLBACK" = 1 ] && [ "$1" = run ] && [ "$2" = build:web ]; then exit 37; fi\nexit 0');
 let worker=original;
 for(const [a,b] of [
  ['ROOT=/opt/linux-panel','ROOT='+JSON.stringify(root)],
  ['STATE=/var/lib/linux-panel','STATE='+JSON.stringify(state)],
  ['ROOT_BACKUP=/var/lib/linux-panel-update-root','ROOT_BACKUP='+JSON.stringify(backup)],
  ['RESULT=/var/lib/linux-panel-update-status/result.json','RESULT='+JSON.stringify(join(status,'result.json'))],
  ['EXPECTED_REMOTE=/etc/linux-panel/update-source','EXPECTED_REMOTE='+JSON.stringify(pin)],
  ['PANEL_ENV=/etc/linux-panel/panel.env','PANEL_ENV='+JSON.stringify(env)],
  ['exec 9> /run/linux-panel-root-updater/update.lock','exec 9> '+JSON.stringify(join(base,'update.lock'))],
  ['[[ "$#" -eq 0 && "$EUID" -eq 0 ]] || exit 2','[[ "$#" -eq 0 ]] || exit 2'],
  ['export PATH=/usr/sbin:/usr/bin:/sbin:/bin','export PATH='+JSON.stringify(bin)+':/usr/sbin:/usr/bin:/sbin:/bin'],
  ['as_updater(){ /usr/bin/setpriv --reuid="$USER" --regid="$USER" --init-groups --inh-caps=-all --no-new-privs -- /usr/bin/env -i HOME=/var/lib/linux-panel-updater USER="$USER" LOGNAME="$USER" GIT_TERMINAL_PROMPT=0 PATH=/opt/node24/bin:/opt/linux-panel/runtime:/usr/local/bin:/usr/bin:/bin "$@"; }','as_updater(){ "$@"; }'],
  ['[[ -d "$ROOT_BACKUP" && ! -L "$ROOT_BACKUP" && "$(stat -c %u "$ROOT_BACKUP")" -eq 0 ]] || { record failed;exit 2; }','[[ -d "$ROOT_BACKUP" && ! -L "$ROOT_BACKUP" ]] || { record failed; exit 2; }']
 ])worker=swap(worker,a,b);
 const securityLine=worker.split('\n').find(x=>x.includes('[[ "$EXPECTED" =~ ^('));
 assert.ok(securityLine,'production must validate pinned remote');
 worker=swap(worker,securityLine,'[[ "$EXPECTED" == '+JSON.stringify(remote)+' ]] || { record failed; exit 2; }');
 const script=join(base,'worker.sh'),log=join(base,'events.log');
 let sequence=0;
 writeFileSync(script,worker,{mode:0o700});
 exec('bash',['-n',script]);
 return {base,root,state,status,script,log,old,target,
  cleanup(){rmSync(base,{recursive:true,force:true})},
  run({sha=target,build=false,health=false,rollback=false}={}){
   const id=(++sequence).toString(16).padStart(32,'0');
   writeFileSync(join(state,'update-trigger'),'id='+id+'\nsha='+sha+'\n');
   const process=spawnSync('bash',[script],{encoding:'utf8',timeout:20000,env:{
    ...globalThis.process.env,TEST_LOG:log,FAIL_BUILD:build?'1':'0',
    FAIL_HEALTH:health?'1':'0',FAIL_ROLLBACK:rollback?'1':'0'
   }});
   const result=JSON.parse(readFileSync(join(status,'result.json'),'utf8'));
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
 {name:'rollback build failure reports failure',options:{build:true,rollback:true},expected:'failed',updated:false}
]){
 test('isolated updater worker: '+scenario.name,()=>{
  const f=prepare();
  try{
   const out=f.run(scenario.options);
   assert.equal(out.result.status,scenario.expected,JSON.stringify(out.process));
   assert.equal(out.head,scenario.updated?f.target:f.old);
   assert.equal(out.state,'{"original":true}\n');
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
