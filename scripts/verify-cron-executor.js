// Disposable Ubuntu acceptance only. Run as linuxpanel after an explicitly
// installed reviewed root executor. Never run on a host with real tasks.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PrivilegedActionClient} from '../platform/privileged/client.js';
if(process.getuid?.()===0 || process.env.PANEL_CRON_ACCEPTANCE!=='1')
  throw Error('Run only as ordinary linuxpanel with PANEL_CRON_ACCEPTANCE=1 on disposable CI');
const client=new PrivilegedActionClient({socketPath:'/run/linux-panel-privileged/executor.sock'});
const call=(name,input)=>client.execute({id:'cron.'+name,privileged:{channels:['web']}},input,
  {authenticated:true,userId:'disposable-cron-acceptance',channel:'web'});
const blank=createHash('sha256').update('').digest('hex');
const system=await client.execute({id:'schedules.list',privileged:{channels:['web']}},{},
  {authenticated:true,userId:'disposable-cron-acceptance',channel:'web'});
assert.ok(Array.isArray(system.systemTasks));
assert.equal(system.systemCount,system.systemTasks.length);
assert.ok(Array.isArray(system.systemWarnings));
await assert.rejects(client.execute({id:'schedules.set',privileged:{channels:['web']}},
  {id:'0'.repeat(64),revision:'0'.repeat(64),operation:'disable'},
  {authenticated:true,userId:'disposable-cron-acceptance',channel:'web'}),{statusCode:404});
const initial=await call('list',{});
assert.ok(Array.isArray(initial.systemTasks),'reviewed root handler must expose system-wide inventory');
assert.ok(Array.isArray(initial.systemWarnings));
await assert.rejects(call('systemSet',{id:'0'.repeat(64),revision:'0'.repeat(64),operation:'disable'}),{statusCode:404});
assert.equal(initial.revision,blank,'Dedicated cron file must be absent before disposable acceptance');
const create=await call('save',{revision:initial.revision,
  task:{name:'fixture never-run',expression:'0 0 31 2 *',command:'/usr/bin/true',enabled:true}});
try {
  const data=await call('list',{});
  assert.equal(data.count,1);assert.equal(data.tasks[0].id,create.id);
  assert.equal(data.tasks[0].command,'/usr/bin/true');
  await assert.rejects(call('save',{revision:initial.revision,
    task:{name:'stale',expression:'0 * * * *',command:'true',enabled:true}}),{statusCode:409});
  const disabled=await call('save',{revision:data.revision,task:{...data.tasks[0],enabled:false}});
  assert.equal((await call('list',{})).tasks[0].enabled,false);
  const raw=await readFile('/etc/cron.d/linux-panel','utf8');
  assert.match(raw,/# DISABLED 0 0 31 2 \* linuxpanel \/usr\/bin\/true/);
  assert.doesNotMatch(raw,/\sroot\s+\/usr\/bin\/true/);
  await call('remove',{revision:disabled.revision,id:create.id});
  assert.equal((await call('list',{})).count,0);
  console.log('PASS reviewed root Cron handler: exact path, linuxpanel run-as, CRUD and revision conflict');
}finally {
  // The disposable CI workflow removes only its known exclusively-created file.
}
