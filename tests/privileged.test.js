import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PrivilegedActionClient} from '../platform/privileged/client.js';
import {startPrivilegedServer,dispatchPrivileged} from '../platform/privileged/server.js';
import {createPrivilegedHandlers} from '../platform/privileged/handlers.js';
import {ActionEngine} from '../core/action-engine.js';
import {ActionRegistry} from '../core/action-registry.js';
import {setup} from '../modules/files/index.js';
import {createApp} from '../apps/api/src/create-app.js';
import {StateStore} from '../platform/state-store.js';
import {AuthService} from '../platform/auth/service.js';
const context={authenticated:true,userId:'fixture-admin',channel:'web'};
const action=id=>({id,privileged:{channels:['web']}});

test('root dispatch rejects unknown operations, invalid schemas and MCP transport claims',async()=>{
  const handlers=createPrivilegedHandlers();
  const call=(id,input={},channel='web')=>dispatchPrivileged({version:1,action:id,input,channel},handlers);
  await assert.rejects(call('terminal.execute',{command:'true'}),{statusCode:404});
  await assert.rejects(call('files.delete',{path:'/',command:'true'}),{statusCode:400});
  await assert.rejects(call('files.chmod',{path:'/tmp/fixture',mode:'888'}),{statusCode:400});
  await assert.rejects(call('files.chown',{path:'/tmp/fixture'}),{statusCode:400});
  await assert.rejects(call('files.list',{},'mcp'),{statusCode:403});
});

test('client authorization, actual socket file operations and channel unavailability',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-privileged-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const socketPath=join(folder,'executor.sock'),audit=[];
  const handlers=createPrivilegedHandlers({privileged:process.getuid?.()===0});
  const server=await startPrivilegedServer({socketPath,handlers,audit:entry=>audit.push(entry)});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const client=new PrivilegedActionClient({socketPath});
  await assert.rejects(client.execute(action('files.list'),{path:folder},{}),{statusCode:403});
  await assert.rejects(client.execute(action('files.list'),{path:folder},{...context,channel:'mcp'}),{statusCode:403});
  const call=(id,input)=>client.execute(action(id),input,context);
  const path=join(folder,'note.txt');await call('files.create',{path,type:'file'});
  const first=await call('files.read',{path});await call('files.write',{path,content:'privileged-fixture',revision:first.revision});
  await assert.rejects(call('files.write',{path,content:'stale',revision:first.revision}),{statusCode:409});
  await call('files.chown',{path,owner:String(process.getuid()),group:String(process.getgid())});
  await call('files.chmod',{path,mode:'0640'});
  assert.equal((await stat(path)).mode & 0o777,0o640);
  assert.equal(await readFile(path,'utf8'),'privileged-fixture');
  const listing=await call('files.list',{path:folder});assert.equal(listing.writeAccess,'allowed');
  assert.equal(listing.accessMode,process.getuid?.()===0?'root':'user');
  await assert.rejects(call('files.chown',{path,owner:'4294967295'}),{statusCode:400});
  await assert.rejects(call('files.delete',{path:'/'}),{statusCode:403});
  await call('files.delete',{path});
  assert.ok(!JSON.stringify(audit).includes('privileged-fixture'));
  assert.ok(!JSON.stringify(audit).includes(folder));
  await assert.rejects(new PrivilegedActionClient({socketPath:join(folder,'missing')}).execute(action('files.list'),{},context),{statusCode:503});
  await assert.rejects(new PrivilegedActionClient({socketPath:''}).execute(action('files.list'),{},context),{statusCode:503});
});

test('shared Engine grants root only through explicit Action metadata and trusted context',async()=>{
  const registry=new ActionRegistry();await setup({actions:registry,moduleId:'files'});
  let calls=0;
  const client={enabled:true,execute:async(action,input,caller)=>{
    calls++;assert.deepEqual(caller,context);return {path:input.path};
  }};
  const engine=new ActionEngine(registry,{privilegedClient:client});
  // Use the real client's guard too: even read Actions must be authenticated before elevation.
  const untrusted=new ActionEngine(registry,{privilegedClient:new PrivilegedActionClient({socketPath:'/unused'})});
  await assert.rejects(untrusted.run('files.list',{},'web'),{statusCode:403});
  await engine.run('files.create',{path:'/tmp/fixture',type:'file'},'web',context);assert.equal(calls,1);
  await assert.rejects(engine.run('files.create',{path:'/tmp/fixture',type:'file'},'mcp',{...context,channel:'mcp'}),{statusCode:404});
  const plain={id:'example.write',kind:'write',permission:'example:write',executionPolicy:'privileged',exposure:{web:true},
    inputSchema:{type:'object',properties:{},additionalProperties:false},execute:()=>({}),outputSchema:{type:'object'}};
  registry.register('example',plain);
  await assert.rejects(engine.run('example.write',{},'web',context),{statusCode:403});
  registry.register('example',{...plain,id:'example.read',kind:'read',exposure:{web:true,mcp:true},privileged:{channels:['web']},execute:()=>({ordinary:true})});
  assert.deepEqual((await engine.run('example.read',{},'mcp',{...context,channel:'mcp'})).result,{ordinary:true});
  assert.equal(calls,1,'permission strings and executionPolicy alone cannot grant root');
});

test('HTTP auth/CSRF and socket execution remain one shared Action pipeline',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-privileged-api-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const statePath=join(folder,'state.json'),store=new StateStore(statePath),auth=new AuthService(store);
  await auth.bootstrap('admin','fixture-privileged-password');
  const socketPath=join(folder,'executor.sock');
  const server=await startPrivilegedServer({socketPath,handlers:createPrivilegedHandlers({privileged:process.getuid?.()===0})});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const privilegedClient=new PrivilegedActionClient({socketPath});
  const app=await createApp({statePath,privilegedClient});t.after(()=>app.close());
  const url='/api/actions/files.create/execute',path=join(folder,'api.txt'),payload={input:{path,type:'file'}};
  assert.equal((await app.inject({method:'POST',url,payload})).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-panel-client':'web'},payload:{username:'admin',password:'fixture-privileged-password'}});
  const cookie=login.headers['set-cookie'].split(';')[0],headers={cookie,'x-panel-csrf':login.json().csrf};
  assert.equal((await app.inject({method:'POST',url,headers:{cookie},payload})).statusCode,403);
  const result=await app.inject({method:'POST',url,headers,payload});assert.equal(result.statusCode,200,result.body);
  assert.equal(await readFile(path,'utf8'),'');
  privilegedClient.socketPath=join(folder,'offline.sock');
  const offlinePath=join(folder,'must-not-fall-back');
  const offline=await app.inject({method:'POST',url,headers,payload:{input:{path:offlinePath,type:'file'}}});
  assert.equal(offline.statusCode,503);await assert.rejects(stat(offlinePath),{code:'ENOENT'});
  const audit=JSON.stringify((await store.snapshot()).audit);assert.ok(!audit.includes(path));
});
