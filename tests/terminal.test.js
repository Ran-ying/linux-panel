import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {executeShell,TerminalSessions} from '../platform/terminal.js';
import action from '../modules/terminal/actions/execute.js';
import {ActionEngine} from '../core/action-engine.js';
import {ActionRegistry} from '../core/action-registry.js';

const ordinary=process.platform==='linux' && process.getuid?.()!==0;
test('terminal is one explicit write capability, validates input and refuses root',async()=>{
  const registry=new ActionRegistry();registry.register('terminal',action);
  const engine=new ActionEngine(registry);
  await assert.rejects(engine.run(action.id,{command:'printf x'}),{statusCode:403});
  const context={authenticated:true,channel:'web',userId:'fixture'};
  await assert.rejects(engine.run(action.id,{command:'x',timeoutSeconds:61},'web',context),{statusCode:400});
  await assert.rejects(engine.run(action.id,{},'web',context),{statusCode:400});
  if(!ordinary)await assert.rejects(engine.run(action.id,{command:'printf x'},'web',context),{statusCode:503});
  const unrelated={...action,id:'other.execute'};
  registry.register('other',unrelated);
  await assert.rejects(engine.run(unrelated.id,{command:'printf x'},'web',context),{statusCode:403});
});
test('commands preserve output, nonzero exit, timeout and bounded output',async t=>{
  if(!ordinary){t.skip('requires ordinary Linux user');return;}
  const result=await executeShell({command:"printf 'output\\n'; printf 'error\\n' >&2; exit 7"});
  assert.equal(result.stdout,'output\n');assert.equal(result.stderr,'error\n');
  assert.equal(result.exitCode,7);assert.equal(result.timedOut,false);
  assert.equal((await executeShell({command:'exit 124'})).timedOut,false,'an explicit exit code is not a timeout');
  assert.equal((await executeShell({command:'sleep 2',timeoutSeconds:0.05})).timedOut,true);
  const big=await executeShell({command:"python3 -c 'print(" + '"x"*1000000' + ")'"});
  assert.equal(big.truncated,true);assert.ok(Buffer.byteLength(big.stdout)+Buffer.byteLength(big.stderr)<=256*1024);
});
test('PTY is persistent, owns sessions, supports Ctrl+C and closes on revocation',async t=>{
  if(!ordinary){t.skip('requires ordinary Linux user');return;}
  let valid=true;
  const identity={user:{id:'fixture'},session:{id:'fixture-session'}};
  const manager=new TerminalSessions({
    registry:{get:id=>id===action.id?action:null},
    auth:{requirePermission(){},async authenticate(){if(!valid)throw new Error('revoked');return identity;}},
    presentations:[{actionId:action.id,console:'terminal'}]
  });
  t.after(()=>manager.shutdown());
  const {id}=await manager.open(identity,'private-token',{actionId:action.id});
  assert.throws(()=>manager.output({...identity,session:{id:'other'}},id),{statusCode:404});
  let cursor=0,output='';
  const waitFor=async pattern=>{
    for(let i=0;i<100;i++){
      const read=manager.output(identity,id,cursor);cursor=read.cursor;
      output+=read.chunks.map(c=>Buffer.from(c.data,'base64').toString()).join('');
      if(pattern.test(output))return;
      await delay(20);
    }
    assert.fail('expected PTY output was not received');
  };
  manager.input(identity,id,"cd /tmp\rprintf '\\160\\164\\171\\055\\157\\153\\012'; pwd\r");
  await waitFor(/pty-ok/);await waitFor(/\r\n\/tmp\r\n/);
  output='';manager.input(identity,id,'sleep 30\r');await delay(100);
  manager.input(identity,id,'\u0003');await delay(100);
  manager.input(identity,id,"printf '\\143\\164\\162\\154\\055\\157\\153\\012'\r");
  await waitFor(/ctrl-ok/);
  manager.resize(identity,id,90,25);
  valid=false;await manager.sweep();assert.equal(manager.sessions.size,0);
  assert.throws(()=>manager.output(identity,id,cursor),{statusCode:404});
});
