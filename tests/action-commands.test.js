import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StateStore} from '../platform/state-store.js';
import {ActionCommands,runTerminalCommand} from '../platform/action-commands.js';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import info from '../modules/system/actions/info.js';
import memory from '../modules/system/actions/memory.js';
import cpu from '../modules/system/actions/cpu.js';
import disk from '../modules/storage/actions/usage.js';
import services from '../modules/services/actions/list.js';

test('saved command configuration persists and is shared by preview and actual Action execution',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-commands-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new StateStore(join(folder,'state.json'));
  const values={hostname:'fixture',platform:'linux',release:'test',arch:'x86_64',cpuCount:'2',
    totalMemoryBytes:'1024',freeMemoryBytes:'512',uptimeSeconds:'60',nodeVersion:'v24.0.0'};
  const output=new Map(Object.entries(info.terminal.fields).map(([key,command])=>[command,values[key]]));
  output.set('printf changed',{stdout:'changed\n\n',stderr:'fixture warning\n',exitCode:0});
  let runs=0;
  const commands=new ActionCommands(store,{run:async command=>{runs++;return output.get(command);}});
  const registry=new ActionRegistry();registry.register('system',info);
  const engine=new ActionEngine(registry,{commands});
  await commands.save(info,{...info.terminal.fields,hostname:'printf changed'},'fixture-admin');
  assert.equal(runs,0,'saving must not execute a command');
  const plan=await engine.preview('system.info');
  assert.equal(runs,0,'preview must not execute commands');
  assert.equal(plan.steps[0].command,'printf changed');
  const result=await engine.run('system.info');
  assert.equal(result.result.hostname,'changed');
  assert.equal(result.result.cpuCount,2);
  assert.deepEqual(result.raw.hostname,{stdout:'changed\n\n',stderr:'fixture warning\n',exitCode:0});
  assert.equal(result.raw.cpuCount.stdout,'2','raw values must stay strings, before numeric decoding');
  const reopened=new ActionCommands(new StateStore(store.filePath));
  assert.equal((await reopened.config(info)).fields[0].value,'printf changed');
  const audit=(await store.snapshot()).audit.at(-1);
  assert.equal(audit.event,'action.commands.updated');
  assert.equal(audit.detail,'system.info');
  assert.ok(!JSON.stringify(audit).includes('printf changed'));
  for(const bad of [{}, {...info.terminal.fields,extra:'id'}, {...info.terminal.fields,hostname:''},
    {...info.terminal.fields,hostname:'x'.repeat(2049)}])
    await assert.rejects(commands.save(info,bad,'fixture-admin'),{statusCode:400});
  commands.runCommand=async ()=>'not-a-number';
  await assert.rejects(commands.execute(info),{statusCode:502});
});

test('terminal commands run without root and have a process timeout',async t=>{
  if(process.getuid?.()===0){
    await assert.rejects(runTerminalCommand('id'),{statusCode:503});
    return;
  }
  assert.deepEqual(await runTerminalCommand("printf 'terminal-ok\\n'; printf 'warning\\n' >&2"),{stdout:'terminal-ok\n',stderr:'warning\n',exitCode:0});
  await assert.rejects(runTerminalCommand('sleep 2',{timeoutSeconds:0.05}));
});

test('Linux terminal defaults keep all five read Action output contracts',async t=>{
  if(process.platform!=='linux' || process.getuid?.()===0){t.skip('requires ordinary Linux user');return;}
  const folder=await mkdtemp(join(tmpdir(),'panel-terminal-defaults-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const commands=new ActionCommands(new StateStore(join(folder,'state.json')));
  const registry=new ActionRegistry();
  for(const action of [info,memory,cpu,disk,services])registry.register(action.id.split('.')[0],action);
  const engine=new ActionEngine(registry,{commands});
  for(const action of [info,memory,cpu,disk,services]){
    const {result}=await engine.run(action.id);
    assert.ok(result && typeof result==='object',action.id);
  }
});
