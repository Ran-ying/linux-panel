import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionRegistry } from '../core/action-registry.js';
import { ModuleManager } from '../core/module-manager.js';
import { loadWebPresentations } from '../apps/api/src/web-presentations.js';

test('each module owns its Web render configuration separately from Action metadata', async () => {
  const registry = new ActionRegistry();
  const modulesPath = join(process.cwd(), 'modules');
  const modules = new ModuleManager(modulesPath, registry);
  await modules.loadAll();

  const presentations = await loadWebPresentations(modulesPath, modules.loaded, registry);
  assert.equal(presentations.length, 34);
  const configured = new Map(presentations.map(p => [p.actionId, p]));
  assert.equal(configured.get('system.info').renderer, 'metrics');
  assert.equal(configured.get('system.resources').layout,'grid');
  assert.deepEqual(configured.get('system.resources').sections.map(p=>[p.key,p.renderer]),
    [['cpu','gauge'],['memory','gauge'],['disk','gauge']]);
  assert.deepEqual(registry.list('web').filter(a=>a.moduleId==='system').map(a=>a.id),
    ['system.resources','system.info']);
  assert.equal(configured.get('services.list').renderer, 'table');
  assert.equal(configured.get('services.logs').renderer, 'logs');
  assert.equal(configured.get('services.logs').loadOnEnter, false);
  assert.deepEqual(configured.get('services.logs').inputs.map(f=>f.type),['text','number']);
  assert.deepEqual(configured.get('services.list').inputs.map(f=>f.type),['text','select','select']);
  const cpu=configured.get('system.resources').sections[0];
  assert.equal(cpu.totalKey,undefined);
  assert.ok(cpu.details.some(f=>f.key==='availableParallelism'));
  assert.equal(configured.get('system.resources').refreshIntervalMs, 5000);
  assert.equal(configured.get('services.list').refreshIntervalMs, 0);
  assert.ok(presentations.filter(p=>!p.embedded && !['terminal.execute','services.logs'].includes(p.actionId)).every(p=>p.loadOnEnter===true));
  assert.equal(configured.get('terminal.execute').loadOnEnter,false);
  assert.equal(configured.get('terminal.execute').inputs[0].key,'command');
  const actions = registry.list('web');
  for (const action of actions) {
    assert.equal(Object.hasOwn(action, 'presentation'), false);
    assert.equal(Object.hasOwn(action, 'refreshIntervalMs'), false);
    assert.ok(action.outputSchema);
  }
  const mcpActions = registry.list('mcp');
  assert.equal(mcpActions.length, actions.length-24);
  assert.equal(configured.get('system.info').refreshIntervalMs,0);
  assert.ok(configured.get('services.list').clientFilters);
  assert.equal(configured.get('v2ray.status').renderer,'v2ray-manager');
  assert.equal(configured.get('v2ray.status').chrome,'flat');
  assert.equal(configured.get('v2ray.status').operations.install,'v2ray.install');
  assert.equal(registry.get('v2ray.read').exposure.mcp,false);
  assert.equal(registry.get('v2ray.install').exposure.mcp,false);
  const nginxActions=registry.list('web').filter(a=>a.moduleId==='nginx').map(a=>a.id);
  assert.deepEqual(nginxActions.slice(1,4),['nginx.status','nginx.sites','nginx.certificates'],
    'Nginx visible Actions register in status → sites → SSL order after embedded repair');
  assert.deepEqual(presentations.filter(p=>p.actionId.startsWith('nginx.')&&!p.embedded)
    .map(p=>p.actionId),['nginx.status','nginx.sites'],
    'SSL helper must only appear inside the selected website, not as another Action card');
  assert.equal(configured.get('nginx.status').renderer,'nginx-service');
  assert.equal(configured.get('nginx.status').chrome,'flat');
  assert.equal(configured.get('nginx.status').operations.service,'nginx.service');
  assert.equal(configured.get('nginx.certificates').renderer,'metrics');
  assert.equal(configured.get('nginx.certificates').embedded,true);
  assert.equal(configured.get('nginx.sites').operations.certificates,'nginx.certificates');
  assert.equal(configured.get('nginx.sites').operations.renew,'nginx.renew');
  assert.equal(configured.get('nginx.service').embedded,true);
  assert.equal(configured.get('nginx.renew').embedded,true);
  assert.equal(registry.get('nginx.certificates').exposure.mcp,false);
  assert.equal(configured.get('nginx.sites').renderer,'managed-configs');
  assert.equal(configured.get('nginx.sites').operations.apply,'nginx.apply');
  assert.equal(registry.get('nginx.apply').exposure.mcp,false);
  assert.equal(configured.get('nginx.repairExecutor').embedded,true);
  assert.equal(registry.get('nginx.repairExecutor').exposure.mcp,false);
  assert.equal(configured.get('cron.list').renderer,'scheduled-tasks');
  assert.equal(configured.get('cron.list').chrome,'flat');
  assert.equal(configured.get('cron.list').operations.save,'cron.save');
  assert.equal(registry.get('cron.save').exposure.mcp,false);
  assert.equal(configured.get('files.list').renderer,'files');
  assert.equal(configured.get('files.list').chrome,'minimal');
  assert.equal(configured.get('files.list').operations.accounts,'files.accounts');
  assert.equal(configured.get('files.accounts').embedded,true);
  assert.equal(registry.get('files.accounts').exposure.mcp,false);
  assert.ok(mcpActions.every(a => !Object.hasOwn(a, 'presentation')));
});

test('Web adapter rejects unknown output keys in presentation configuration', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'linux-panel-views-'));
  try {
    await mkdir(join(folder, 'demo', 'ui'), { recursive: true });
    await writeFile(join(folder, 'demo', 'ui', 'presentations.js'),
      "export default [{actionId:'demo.read',renderer:'metrics',fields:[{key:'missing',label:'Missing'}]}];\n");
    await writeFile(join(folder, 'package.json'), '{"type":"module"}\n');
    const registry = new ActionRegistry();
    registry.register('demo', {
      id: 'demo.read', kind: 'read', exposure: { web: true, mcp: true },
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      execute: async () => ({ value: 1 })
    });
    await assert.rejects(loadWebPresentations(folder, [{ id: 'demo' }], registry), /unknown result field/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('Web adapter never turns a hidden Action into a visible UI control', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'linux-panel-hidden-ui-'));
  try {
    await mkdir(join(folder, 'demo', 'ui'), { recursive: true });
    await writeFile(join(folder, 'package.json'), '{"type":"module"}\n');
    await writeFile(join(folder, 'demo', 'ui', 'presentations.js'),
      "export default [{actionId:'demo.secret',renderer:'metrics',fields:[{key:'value',label:'Value'}]}];\n");
    const registry = new ActionRegistry();
    registry.register('demo', {
      id: 'demo.secret', kind: 'read', exposure: { web: false, mcp: true },
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      execute: async () => ({ value: 1 })
    });
    await assert.rejects(loadWebPresentations(folder, [{ id: 'demo' }], registry), /unavailable Web Action/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('Web adapter rejects non-boolean auto-load flags and write Action auto-load', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'linux-panel-autoload-'));
  try {
    await mkdir(join(folder, 'demo', 'ui'), { recursive: true });
    await writeFile(join(folder, 'package.json'), '{"type":"module"}\n');
    const configPath = join(folder, 'demo', 'ui', 'presentations.js');
    const registry = new ActionRegistry();
    registry.register('demo', {
      id: 'demo.write', kind: 'write', exposure: { web: true, mcp: false },
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      execute: async () => ({ value: 1 })
    });
    await writeFile(configPath,
      "export default [{actionId:'demo.write',renderer:'metrics',fields:[{key:'value',label:'Value'}],loadOnEnter:true}];\n");
    await assert.rejects(loadWebPresentations(folder, [{ id: 'demo' }], registry), /Unsafe automatic initial read/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('sections reject nested fields outside the declared output contract',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-invalid-sections-'));
  try {
    await mkdir(join(folder,'demo','ui'),{recursive:true});
    await writeFile(join(folder,'package.json'),'{"type":"module"}');
    await writeFile(join(folder,'demo','ui','presentations.js'),
      "export default [{actionId:'demo.read',renderer:'sections',sections:[{key:'nested',renderer:'metrics',fields:[{key:'secret',label:'Hidden'}]}]}];");
    const registry=new ActionRegistry();
    registry.register('demo',{id:'demo.read',kind:'read',exposure:{web:true},
      inputSchema:{type:'object',properties:{}},
      outputSchema:{type:'object',properties:{nested:{type:'object',properties:{count:{type:'number'}}}}},
      execute:async()=>({nested:{count:1}})});
    await assert.rejects(loadWebPresentations(folder,[{id:'demo'}],registry),/unknown result field/);
  } finally {await rm(folder,{recursive:true,force:true});}
});


test('gauge and grid declarations reject unsupported quantities and layouts',async t=>{
  for(const view of [
    {renderer:'gauge',valueKey:'percent'},
    {renderer:'gauge',valueKey:'percent',totalKey:'total',quantityFormat:'html'},
    {renderer:'sections',layout:'absolute',sections:[{renderer:'metrics',fields:[{key:'total',label:'Total'}]}]}
  ]){
    const folder=await mkdtemp(join(tmpdir(),'panel-gauge-contract-'));
    t.after(()=>rm(folder,{recursive:true,force:true}));
    await mkdir(join(folder,'demo','ui'),{recursive:true});
    await writeFile(join(folder,'package.json'),'{"type":"module"}');
    await writeFile(join(folder,'demo','ui','presentations.js'),
      'export default '+JSON.stringify([{actionId:'demo.read',...view}])+';');
    const registry=new ActionRegistry();
    registry.register('demo',{id:'demo.read',kind:'read',exposure:{web:true},
      inputSchema:{type:'object',properties:{}},
      outputSchema:{type:'object',properties:{percent:{type:'number'},total:{type:'integer'}}},
      execute:async()=>({percent:50,total:2})});
    await assert.rejects(loadWebPresentations(folder,[{id:'demo'}],registry),
      /Gauge requires|Invalid gauge|Invalid sections layout/);
  }
});


test('select inputs cannot reference result fields outside their string-array contract',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-invalid-options-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  await mkdir(join(folder,'demo','ui'),{recursive:true});
  await writeFile(join(folder,'package.json'),'{"type":"module"}');
  await writeFile(join(folder,'demo','ui','presentations.js'),
    "export default [{actionId:'demo.read',renderer:'metrics',fields:[{key:'count',label:'Count'}],inputs:[{key:'state',label:'State',type:'select',optionsKey:'count'}]}];");
  const registry=new ActionRegistry();
  registry.register('demo',{id:'demo.read',kind:'read',exposure:{web:true},
    inputSchema:{type:'object',properties:{state:{type:'string'}}},
    outputSchema:{type:'object',properties:{count:{type:'integer'}}},
    execute:async()=>({count:0})});
  await assert.rejects(loadWebPresentations(folder,[{id:'demo'}],registry),/Select options must reference/);
});
