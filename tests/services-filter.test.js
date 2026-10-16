import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import action,{parseSystemctlLines,serviceResult} from '../modules/services/actions/list.js';
import {ActionRegistry} from '../core/action-registry.js';
import {ActionEngine} from '../core/action-engine.js';
import {ActionCommands} from '../platform/action-commands.js';
import {StateStore} from '../platform/state-store.js';

const stdout='nginx.service loaded active running Web server\nnginx-worker.service loaded inactive dead Worker\nredis.service loaded failed failed Cache\n';
test('service filters combine literal name substring with exact active and sub states',()=>{
  const parsed=parseSystemctlLines(stdout);
  const result=serviceResult('systemd',parsed,{nameKeyword:' NGINX ',active:'active',sub:'running'});
  assert.deepEqual(result.services.map(s=>s.name),['nginx.service']);
  assert.equal(result.count,1);
  assert.deepEqual(result.activeStates,['active','failed','inactive']);
  assert.deepEqual(result.subStates,['dead','failed','running']);
  assert.equal(serviceResult('systemd',parsed,{}).count,3);
  assert.equal(serviceResult('systemd',parsed,{nameKeyword:'.*'}).count,0);
  assert.equal(serviceResult('systemd',parsed,{active:'active',sub:'dead'}).count,0);
  assert.equal(serviceResult('systemd',parsed,{sub:'failed'}).services[0].name,'redis.service');
});
test('editable command execution receives Action input and preserves unfiltered original output',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-service-filter-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new StateStore(join(folder,'state.json')),executed=[];
  const commands=new ActionCommands(store,{run:async command=>{
    executed.push(command);return {stdout,stderr:'',exitCode:0};
  }});
  const registry=new ActionRegistry();registry.register('services',action);
  const engine=new ActionEngine(registry,{commands});
  const filtered=await engine.run(action.id,{nameKeyword:'nginx',active:'inactive',sub:'dead'});
  assert.deepEqual(filtered.result.services.map(s=>s.name),['nginx-worker.service']);
  assert.equal(filtered.raw.units.stdout,stdout);
  const literal=await engine.run(action.id,{nameKeyword:'; ignored shell syntax'});
  assert.equal(literal.result.count,0);
  assert.deepEqual(executed,[action.terminal.fields.units,action.terminal.fields.units]);
  for(const input of [{unknown:'x'},{nameKeyword:3},{nameKeyword:'x'.repeat(121)},{active:[]},{sub:'x'.repeat(65)}]){
    await assert.rejects(engine.run(action.id,input),{statusCode:400});
  }
  assert.equal(executed.length,2,'invalid inputs must fail before running the collector');
});
