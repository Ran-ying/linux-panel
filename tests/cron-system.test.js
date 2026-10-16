import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSystemCronOperations} from '../platform/privileged/cron-system-operations.js';

async function fixture(t){
 const base=await fs.mkdtemp(join(tmpdir(),'lp-system-cron-'));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const etc=join(base,'etc'),spool=join(base,'spool');
 for(const path of [etc,spool,join(etc,'cron.d'),join(etc,'cron.daily')])
   await fs.mkdir(path,{recursive:true});
 const cron=join(etc,'cron.d','sysstat');
 await fs.writeFile(cron,
  '# Maintained by packages\nSHELL=/bin/sh\n*/5 * * * * root /usr/bin/true\n0 1 * * 1 daemon /bin/echo weekday\n');
 const user=join(spool,'alice');
 await fs.writeFile(user,'MAILTO=alice\n0 2 * * * /bin/echo hi\n');
 const daily=join(etc,'cron.daily','logrotate');
 await fs.writeFile(daily,'#!/bin/sh\nexit 0\n',{mode:0o755});
 let timerState='enabled';
 const calls=[];
 const execute=async(binary,args)=>{
   calls.push([binary,...args]);
   if(binary==='/usr/bin/systemctl'){
     if(args[0]==='list-timers')return JSON.stringify([{unit:'apt-daily.timer',activates:'apt-daily.service',next:1792200000000000}]);
     if(args[0]==='list-unit-files')return JSON.stringify([
       {unit_file:'apt-daily.timer',state:timerState},{unit_file:'static@.timer',state:'static'}]);
     if(['enable','disable'].includes(args[0])){timerState=args[0]==='enable'?'enabled':'disabled';return '';}
   }
   if(binary==='/usr/bin/crontab'){
     const content=await fs.readFile(args[2],'utf8');
     await fs.writeFile(user,content);
     return '';
   }
   throw Error('Unexpected executable: '+binary+' '+args);
 };
 return {etc,spool,cron,user,daily,calls,system:createSystemCronOperations({etc,spool,requireRoot:false,execute})};
}

test('inventory covers classic system Cron, user spool, run-parts and systemd timer units',async t=>{
 const f=await fixture(t);
 const result=await f.system.enumerate();
 assert.deepEqual(result.systemWarnings,[]);
 assert.equal(result.systemCount,6);
 assert.deepEqual([...new Set(result.systemTasks.map(x=>x.sourceType))].sort(),
   ['cron.d','periodic','systemd-timer','user-crontab']);
 const rootJob=result.systemTasks.find(x=>x.owner==='root');
 assert.equal(rootJob.control,'cron');
 assert.equal(rootJob.expression,'*/5 * * * *');
 assert.equal(result.systemTasks.find(x=>x.sourceType==='periodic').control,'none');
 assert.equal(result.systemTasks.find(x=>x.sourceType==='systemd-timer'&&x.enabled).nextRun.length>0,true);
 assert.equal(result.systemTasks.find(x=>x.sourceType==='systemd-timer'&&!x.enabled).control,'none');
});

test('system Cron edits preserve unrelated comments and reject stale revisions',async t=>{
 const f=await fixture(t),original=await fs.readFile(f.cron,'utf8');
 const get=async()=> (await f.system.enumerate()).systemTasks.find(x=>x.sourceType==='cron.d'&&x.owner==='root');
 let item=await get();
 await f.system.set({id:item.id,revision:item.revision,operation:'disable'});
 const disabled=await fs.readFile(f.cron,'utf8');
 assert.match(disabled,/# LP-OFF \*\/5 \* \* \* \* root \/usr\/bin\/true/);
 assert.match(disabled,/daemon \/bin\/echo weekday/);
 assert.match(disabled,/SHELL=\/bin\/sh/);
 await assert.rejects(f.system.set({id:item.id,revision:item.revision,operation:'enable'}),{statusCode:404});
 item=await get();
 await f.system.set({id:item.id,revision:item.revision,operation:'enable'});
 assert.equal(await fs.readFile(f.cron,'utf8'),original);
 item=await get();
 await f.system.set({id:item.id,revision:item.revision,operation:'edit',
   expression:'15 3 * * *',command:'/usr/bin/false'});
 assert.match(await fs.readFile(f.cron,'utf8'),/15 3 \* \* \* root \/usr\/bin\/false/);
 item=await get();
 await f.system.set({id:item.id,revision:item.revision,operation:'remove'});
 assert.doesNotMatch(await fs.readFile(f.cron,'utf8'),/\/usr\/bin\/false/);
 assert.match(await fs.readFile(f.cron,'utf8'),/daemon \/bin\/echo weekday/);
});

test('system Cron user jobs use crontab CLI rather than rewriting spool directly',async t=>{
 const f=await fixture(t);
 let item=(await f.system.enumerate()).systemTasks.find(x=>x.sourceType==='user-crontab');
 await f.system.set({id:item.id,revision:item.revision,operation:'disable'});
 assert.match(await fs.readFile(f.user,'utf8'),/# LP-OFF 0 2 \* \* \* \/bin\/echo hi/);
 assert.ok(f.calls.some(args=>args[0]==='/usr/bin/crontab'&&args[1]==='-u'&&args[2]==='alice'));
 item=(await f.system.enumerate()).systemTasks.find(x=>x.sourceType==='user-crontab');
 await f.system.set({id:item.id,revision:item.revision,operation:'enable'});
 assert.match(await fs.readFile(f.user,'utf8'),/^MAILTO=alice\n0 2 \* \* \* \/bin\/echo hi\n$/);
});

test('systemd timer enable/disable is unit-file-specific; static and scripts remain read-only',async t=>{
 const f=await fixture(t);
 const scan=async()=> (await f.system.enumerate()).systemTasks;
 let timer=(await scan()).find(x=>x.name==='apt-daily.timer');
 await f.system.set({id:timer.id,revision:timer.revision,operation:'disable'});
 assert.ok(f.calls.some(args=>args.join(' ')==='/usr/bin/systemctl disable --now apt-daily.timer'));
 timer=(await scan()).find(x=>x.name==='apt-daily.timer');
 assert.equal(timer.enabled,false);
 await assert.rejects(f.system.set({id:timer.id,revision:timer.revision,operation:'remove'}),{statusCode:400});
 await f.system.set({id:timer.id,revision:timer.revision,operation:'enable'});
 assert.equal((await scan()).find(x=>x.name==='apt-daily.timer').enabled,true);
 const staticTimer=(await scan()).find(x=>x.name==='static@.timer');
 assert.equal(staticTimer.control,'none');
 await assert.rejects(f.system.set({id:staticTimer.id,revision:staticTimer.revision,operation:'enable'}),{statusCode:403});
});

test('malformed or symlinked unmanaged Cron files are not edited',async t=>{
 const f=await fixture(t),link=join(f.etc,'cron.d','link');
 await fs.symlink(f.user,link);
 const list=await f.system.enumerate();
 assert.ok(list.systemTasks.every(x=>x.source!==link));
 const job=list.systemTasks.find(x=>x.owner==='root');
 await fs.writeFile(f.cron,'# external change\n');
 await assert.rejects(f.system.set({id:job.id,revision:job.revision,operation:'disable'}),{statusCode:404});
 assert.equal(await fs.readFile(f.cron,'utf8'),'# external change\n');
});
