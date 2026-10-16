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
import resources from '../modules/system/actions/resources.js';
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

test('Linux terminal defaults satisfy the three consolidated Action contracts',async t=>{
  if(process.platform!=='linux' || process.getuid?.()===0){t.skip('requires ordinary Linux user');return;}
  const folder=await mkdtemp(join(tmpdir(),'panel-terminal-defaults-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const commands=new ActionCommands(new StateStore(join(folder,'state.json')));
  const registry=new ActionRegistry();
  for(const action of [info,resources,services])registry.register(action.id.split('.')[0],action);
  const engine=new ActionEngine(registry,{commands});
  for(const action of [info,resources,services]){
    const {result}=await engine.run(action.id);
    assert.ok(result && typeof result==='object',action.id);
  }
});

test('legacy field overrides migrate by module descriptor and new values take precedence',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-command-migration-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new StateStore(join(folder,'state.json'));
  await store.mutate(state=>{state.actionCommands={
    'system.info':{hostname:'printf old-host'},
    'storage.usage':{filesystem:'printf disk-fixture'},
    'system.cpu':{sample:'printf cpu-fixture',model:'printf model-fixture'},
    'system.memory':{meminfo:'printf memory-fixture'}
  };});
  const commands=new ActionCommands(store);
  const configured=async action=>Object.fromEntries((await commands.config(action)).fields.map(f=>[f.key,f.value]));
  assert.ok(!Object.hasOwn(await configured(info),'filesystem'));
  assert.equal((await configured(resources)).filesystem,'printf disk-fixture');
  assert.equal((await configured(info)).hostname,'printf old-host');
  const migrated=await configured(resources);
  assert.equal(migrated.sample,'printf cpu-fixture');
  assert.equal(migrated.meminfo,'printf memory-fixture');
  assert.equal(Object.keys(migrated).length,5);
  await commands.save(resources,{...migrated,sample:'printf new-fixture'},'fixture-admin');
  assert.equal((await configured(resources)).sample,'printf new-fixture');
});


test('disk command moves to resources and preserves ordered migration and original output',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-disk-resource-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new StateStore(join(folder,'state.json'));
  await store.mutate(state=>{state.actionCommands={
    'storage.usage':{filesystem:'legacy-disk'},
    'system.info':{filesystem:'info-disk'}
  };});
  const values={sample:'cpu 10 0 0 90 0 0 0 0\ncpu 20 0 0 180 0 0 0 0',
    logicalCpus:'2',model:'Fixture CPU',
    meminfo:'MemTotal: 1000 kB\nMemAvailable: 400 kB\nMemFree: 100 kB',
    filesystem:'1024 100 40 30\n'};
  const commands=new ActionCommands(store,{run:async command=>{
    const key=command==='info-disk'?'filesystem':Object.keys(resources.terminal.fields)
      .find(key=>resources.terminal.fields[key]===command);
    return {stdout:values[key],stderr:'',exitCode:0};
  }});
  const config=()=>commands.config(resources);
  assert.equal((await config()).fields.find(f=>f.key==='filesystem').value,'info-disk');
  const registry=new ActionRegistry();registry.register('system',resources);
  const {result,raw}=await new ActionEngine(registry,{commands}).run('system.resources');
  assert.equal(result.disk.usedBytes,61440);
  assert.equal(result.cpu.usagePercent,10);
  assert.equal(result.memory.usedBytes,614400);
  assert.equal(raw.filesystem.stdout,values.filesystem);
  assert.ok(!Object.hasOwn(info.outputSchema.properties,'disk'));
  assert.ok(!Object.hasOwn(info.terminal.fields,'filesystem'));
  await commands.save(resources,Object.fromEntries((await config()).fields.map(f=>[f.key,
    f.key==='filesystem'?'current-disk':f.value])),'fixture-admin');
  assert.equal((await config()).fields.find(f=>f.key==='filesystem').value,'current-disk');
  await store.mutate(state=>{delete state.actionCommands['system.resources'];delete state.actionCommands['system.info'];});
  assert.equal((await config()).fields.find(f=>f.key==='filesystem').value,'legacy-disk');
});
