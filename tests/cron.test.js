import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCronOperations,validateCronTask} from '../platform/privileged/cron-operations.js';
import {createApp} from '../apps/api/src/create-app.js';
import {AuthService} from '../platform/auth/service.js';
import {StateStore} from '../platform/state-store.js';

const task=(overrides={})=>({name:'备份',expression:'*/5 * * * *',command:'/usr/bin/true',enabled:true,...overrides});
const blankHash=createHash('sha256').update('').digest('hex');

test('validate five-field Cron syntax and reject newline injection',()=>{
  for(const expression of ['*/5 * * * *','0,15 1-23/2 1 1-12 0-7','0 0 * * 1-5'])
    assert.equal(validateCronTask(task({expression})).expression,expression);
  for(const expression of ['* * * *','@reboot','60 * * * *','0 24 * * *','0 0 0 * *','0 0 * 13 *',
    '0 0 * * 8','5-1 * * * *','*/0 * * * *','* * * * *\nroot /bin/sh'])
    assert.throws(()=>validateCronTask(task({expression})),{statusCode:400});
  assert.throws(()=>validateCronTask(task({command:'echo safe\n* * * * * root evil'})),{statusCode:400});
  assert.throws(()=>validateCronTask(task({name:'bad\rname'})),{statusCode:400});
});

test('dedicated Cron file: create, edit, disable, delete, revision checks and safe run-as account',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'panel-cron-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'linux-panel'),operations=createCronOperations({path,requireRoot:false});
  const empty=await operations.list();
  assert.equal(empty.revision,blankHash);assert.deepEqual(empty.tasks,[]);
  const created=await operations.save({revision:empty.revision,task:task()});
  assert.match(created.id,/^[a-f0-9-]{36}$/);
  const content=await readFile(path,'utf8');
  assert.ok(content.includes('*/5 * * * * linuxpanel /usr/bin/true'));
  assert.ok(!content.includes('* * * * * root'));
  assert.equal(content.includes('\n# LP-TASK:'),true);
  const listing=await operations.list();
  assert.equal(listing.count,1);assert.equal(listing.tasks[0].name,'备份');
  await assert.rejects(operations.save({revision:empty.revision,task:task()}),{statusCode:409});
  const edited=await operations.save({revision:listing.revision,
    task:task({id:created.id,enabled:false,expression:'0 2 * * *',name:'Nightly'})});
  const disabled=await operations.list();
  assert.equal(disabled.tasks[0].enabled,false);
  assert.ok((await readFile(path,'utf8')).includes('# DISABLED 0 2 * * * linuxpanel /usr/bin/true'));
  await assert.rejects(operations.remove({id:created.id,revision:listing.revision}),{statusCode:409});
  await assert.rejects(operations.save({revision:edited.revision,task:task({id:'00000000-0000-0000-0000-000000000001'})}),{statusCode:404});
  const removed=await operations.remove({id:created.id,revision:edited.revision});
  assert.equal((await operations.list()).count,0);
  assert.equal((await readFile(path,'utf8')).startsWith('# Linux Panel managed cron v1'),true);
  assert.notEqual(removed.revision,blankHash);
});

test('unowned or modified Cron file is never overwritten; concurrent stale writes fail',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'panel-cron-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'linux-panel'),operations=createCronOperations({path,requireRoot:false});
  await writeFile(path,'* * * * * root /bin/true\n');
  await assert.rejects(operations.list(),{statusCode:409});
  await assert.rejects(operations.save({revision:blankHash,task:task()}),{statusCode:409});
  assert.equal(await readFile(path,'utf8'),'* * * * * root /bin/true\n');
  await rm(path);
  const [a,b]=await Promise.allSettled([
    operations.save({revision:blankHash,task:task({name:'one'})}),
    operations.save({revision:blankHash,task:task({name:'two'})})
  ]);
  assert.equal([a,b].filter(x=>x.status==='fulfilled').length,1);
  assert.equal([a,b].filter(x=>x.status==='rejected').length,1);
  const current=await operations.list();
  assert.equal(current.count,1);
  await writeFile(path,(await readFile(path,'utf8')).replace('linuxpanel /usr/bin/true','root /usr/bin/true'));
  await assert.rejects(operations.list(),{statusCode:409});
});

test('Cron Web Actions use existing login/CSRF policy and a separate privileged executor',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'panel-cron-api-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const ops=createCronOperations({path:join(dir,'cron'),requireRoot:false});
  const statePath=join(dir,'state.json');
  const store=new StateStore(statePath);
  await new AuthService(store).bootstrap('admin','cron-fixture-long-password');
  const privilegedClient={enabled:true,execute:async(action,input)=>ops[action.id.slice(5)](input)};
  const app=await createApp({root:process.cwd(),statePath,modulesPath:join(process.cwd(),'modules'),
    production:false,privilegedClient});
  t.after(()=>app.close());
  const url=id=>'/api/actions/cron.'+id+'/execute';
  const post=(id,headers,input)=>app.inject({method:'POST',url:url(id),headers,payload:{input}});
  assert.equal((await post('list',{},{})).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/login',
    headers:{'x-panel-client':'web'},payload:{username:'admin',password:'cron-fixture-long-password'}});
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-panel-csrf':login.json().csrf};
  assert.equal((await post('save',{cookie},{})).statusCode,403);
  assert.equal((await post('save',{...headers,origin:'https://evil.example'},{revision:blankHash,task:task()})).statusCode,403);
  assert.equal((await post('save',headers,{revision:blankHash,task:task({expression:'70 * * * *'})})).statusCode,400);
  const saved=await post('save',headers,{revision:blankHash,task:task()});
  assert.equal(saved.statusCode,200,saved.body);
  const listing=await post('list',headers,{});
  assert.equal(listing.statusCode,200,listing.body);
  assert.equal(listing.json().result.tasks.length,1);
  assert.equal((await post('save',headers,{revision:blankHash,task:task()})).statusCode,409);
  const removed=await post('remove',headers,{revision:listing.json().result.revision,id:saved.json().result.id});
  assert.equal(removed.statusCode,200,removed.body);
  assert.ok(!(JSON.stringify((await store.snapshot()).audit)).includes('/usr/bin/true'));
  const exposed=app.printRoutes();
  assert.ok(exposed.includes('/api/actions'));
});

test('root-disabled Cron module fails closed instead of writing user crontab',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'panel-cron-fail-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const statePath=join(dir,'state.json');await new AuthService(new StateStore(statePath)).bootstrap('admin','cron-fixture-long-password');
  const app=await createApp({root:process.cwd(),statePath,modulesPath:join(process.cwd(),'modules'),
    privilegedClient:{enabled:false},production:false});
  t.after(()=>app.close());
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-panel-client':'web'},
    payload:{username:'admin',password:'cron-fixture-long-password'}});
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-panel-csrf':login.json().csrf};
  const response=await app.inject({method:'POST',url:'/api/actions/cron.list/execute',headers,payload:{input:{}}});
  assert.equal(response.statusCode,503);
});
