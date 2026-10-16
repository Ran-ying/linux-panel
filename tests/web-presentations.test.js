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
  assert.equal(presentations.length, 3);
  const configured = new Map(presentations.map(p => [p.actionId, p]));
  assert.equal(configured.get('system.info').sections[1].key, 'disk');
  assert.equal(configured.get('system.info').renderer, 'sections');
  assert.equal(configured.get('services.list').renderer, 'table');
  assert.equal(configured.get('system.resources').refreshIntervalMs, 5000);
  assert.equal(configured.get('services.list').refreshIntervalMs, 0);
  assert.ok(presentations.every(p => p.loadOnEnter === true));
  const actions = registry.list('web');
  for (const action of actions) {
    assert.equal(Object.hasOwn(action, 'presentation'), false);
    assert.equal(Object.hasOwn(action, 'refreshIntervalMs'), false);
    assert.ok(action.outputSchema);
  }
  const mcpActions = registry.list('mcp');
  assert.equal(mcpActions.length, actions.length);
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
