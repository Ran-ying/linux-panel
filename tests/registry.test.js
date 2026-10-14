import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from '../core/action-registry.js';
import { ActionEngine } from '../core/action-engine.js';
import { ModuleManager } from '../core/module-manager.js';
import { resolve } from 'node:path';

const makeAction = (id, overrides = {}) => ({
  id, title: id, description: 'demo', kind: 'read', permission: 'demo:read',
  exposure: { web: true, mcp: false },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: async () => ({ count: 42 }),
  outputSchema: {
    type: 'object', properties: { count: { type: 'integer' } },
    required: ['count'], additionalProperties: false
  },
  presentation: { type: 'metrics', fields: [{ key: 'count', label: '总计' }] },
  ...overrides
});

test('module owns its actions and prevents duplicate registration', () => {
  const registry = new ActionRegistry();
  registry.register('demo', makeAction('demo.list'));
  assert.equal(registry.list('web').length, 1);
  assert.equal(registry.list('mcp').length, 0);
  assert.equal(registry.list('web')[0].presentation.type, 'metrics');
  assert.equal(registry.list('web')[0].outputSchema.type, 'object');
  assert.equal(Object.hasOwn(registry.list('web')[0], 'execute'), false);
  assert.throws(() => registry.register('other', makeAction('demo.restart')), /must start/);
  assert.throws(() => registry.register('demo', makeAction('demo.list')), /Duplicate/);
  assert.throws(() => registry.register('demo', makeAction('demo.bad', { presentation: { type: 'arbitrary-html' } })), /Unknown presentation/);
  registry.unregisterModule('demo');
  assert.equal(registry.list('web').length, 0);
});

test('bundled modules load after dependencies and expose expected actions', async () => {
  const registry = new ActionRegistry();
  const manager = new ModuleManager(resolve('modules'), registry);
  const loaded = await manager.loadAll();
  const ids = loaded.map(m => m.id);
  assert.equal(ids[0], 'system');
  assert.deepEqual([...ids].sort(), ['services', 'storage', 'system']);
  assert.deepEqual(registry.list('web').map(a => a.id).sort(),
    ['services.list', 'storage.usage', 'system.cpu', 'system.info', 'system.memory']);
});

test('engine validates inputs and returned data', async () => {
  const registry = new ActionRegistry();
  registry.register('demo', makeAction('demo.valid'));
  registry.register('demo', makeAction('demo.invalid', { execute: async () => ({ count: 'not a number' }) }));
  registry.register('demo', makeAction('demo.write', { kind: 'write' }));
  const engine = new ActionEngine(registry);
  assert.deepEqual((await engine.run('demo.valid', {})).result, { count: 42 });
  await assert.rejects(engine.run('demo.valid', { extra: true }), { statusCode: 400 });
  await assert.rejects(engine.run('demo.valid', {}, 'mcp'), { statusCode: 404 });
  await assert.rejects(engine.run('demo.write', {}), { statusCode: 403 });
  await assert.rejects(engine.run('demo.invalid', {}), /failed output validation/);
});

test('preview and execution stay separate in the read-only prototype', async () => {
  let executed = 0;
  const registry = new ActionRegistry();
  registry.register('demo', makeAction('demo.plan', {
    createPlan: async () => [{ type: 'node-api', description: 'read only' }],
    execute: async () => { executed++; return { count: 1 }; }
  }));
  const engine = new ActionEngine(registry);
  const preview = await engine.preview('demo.plan');
  assert.equal(preview.steps[0].type, 'node-api');
  assert.equal(executed, 0);
  await engine.run('demo.plan');
  assert.equal(executed, 1);
});
