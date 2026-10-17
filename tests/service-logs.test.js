import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import {setup} from '../modules/services/index.js';
import {createPrivilegedHandlers} from '../platform/privileged/handlers.js';
import {dispatchPrivileged,startPrivilegedServer} from '../platform/privileged/server.js';
import {PrivilegedActionClient} from '../platform/privileged/client.js';
import {SERVICE_LOGS_CONTRACT} from '../platform/privileged/service-log-contracts.js';
import {createServiceLogOperations} from '../platform/privileged/service-log-operations.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const valid=new Ajv({strict:false}).compile(SERVICE_LOGS_CONTRACT.inputSchema);
test('service-log inputs cannot inject options, traversal or other unit types',()=>{
  for(const unit of ['certbot.service','nginx.service','user@1000.service']){
    assert.equal(valid({unit,lines:80}),true,unit);
  }
  for(const unit of ['-f.service','../etc/passwd','certbot.timer','x.service;id','foo\n.service','a/..service']){
    assert.equal(valid({unit,lines:80}),false,unit);
  }
  for(const lines of [-1,0,201,2.5,'80'])assert.equal(valid({unit:'certbot.service',lines}),false);
  assert.equal(valid({unit:'certbot.service',command:'sudo id'}),false);
});
test('fixed command, bounded output and sanitized errors (no live journal)',async()=>{
  let invoked;
  const stub=async(binary,args,options)=>{
    invoked={binary,args,options};return {stdout:'2026-10-17 journal entry\n'};
  };
  const {logs}=createServiceLogOperations({run:stub,requireLinux:false});
  const result=await logs({unit:'certbot.service',lines:20});
  assert.equal(invoked.binary,'/usr/bin/journalctl');
  assert.deepEqual(invoked.args,[
    '--no-pager','--quiet','--no-hostname','--output=short-iso','--unit','certbot.service','--lines','20']);
  assert.deepEqual(result,{unit:'certbot.service',source:'journalctl',lines:1,
    output:'2026-10-17 journal entry\n',truncated:false});
  assert.equal((await logs({unit:'nginx.service'})).unit,'nginx.service');
  await assert.rejects(logs({unit:'bad.service;sudo'}),{statusCode:400});
  const truncated=await createServiceLogOperations({run:async()=>({stdout:'q'.repeat(90000)}),requireLinux:false})
    .logs({unit:'certbot.service'});
  assert.equal(truncated.truncated,true);
  assert.ok(Buffer.byteLength(truncated.output)<=48000);
  await assert.rejects(createServiceLogOperations({run:async()=>{throw Error('private journal detail')},requireLinux:false})
    .logs({unit:'certbot.service'}),error=>error.statusCode===503&&!error.message.includes('private'));
});
test('MCP admitted only for the fixed read-only handler, not root write operations',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-journal-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const handlers=createPrivilegedHandlers();
  handlers.set('services.logs',{channels:['web','mcp'],validate:valid,
    execute:async input=>({unit:input.unit,source:'journalctl',lines:1,output:'fixture\n',truncated:false})});
  const raw=(action,channel,input={})=>dispatchPrivileged({version:1,action,input,channel},handlers);
  await assert.rejects(raw('files.list','mcp',{path:'/tmp'}),{statusCode:403});
  await assert.rejects(raw('nginx.renew','mcp',{name:'fixture'}),{statusCode:403});
  await assert.rejects(raw('services.logs','mcp',{unit:'../root'}),{statusCode:400});
  assert.equal((await raw('services.logs','mcp',{unit:'certbot.service'})).output,'fixture\n');
  const socket=join(folder,'test.sock');
  const server=await startPrivilegedServer({socketPath:socket,handlers});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const client=new PrivilegedActionClient({socketPath:socket});
  const registry=new ActionRegistry();await setup({actions:registry,moduleId:'services'});
  const engine=new ActionEngine(registry,{privilegedClient:client});
  const identity={authenticated:true,userId:'owner',channel:'mcp'};
  const result=await engine.run('services.logs',{unit:'certbot.service'},'mcp',identity);
  assert.equal(result.result.output,'fixture\n');
  await assert.rejects(engine.run('services.logs',{unit:'certbot.service'},'mcp',
    {authenticated:false,userId:'owner',channel:'mcp'}),{statusCode:403});
  const offline=new ActionEngine(registry,{privilegedClient:new PrivilegedActionClient({socketPath:''})});
  await assert.rejects(offline.run('services.logs',{unit:'certbot.service'},'mcp',identity),{statusCode:503});
  const web=await engine.run('services.logs',{unit:'nginx.service'},'web',{...identity,channel:'web'});
  assert.equal(web.result.unit,'nginx.service');
});
