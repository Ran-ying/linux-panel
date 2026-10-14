import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from '../core/action-registry.js';
import { ModuleManager } from '../core/module-manager.js';
import { resolve } from 'node:path';

const makeAction = (id) => ({
  id, title: id, description: 'demo', kind: 'read', permission: 'demo:read',
  exposure: { web: true, mcp: false },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: async () => 42
});

test('module owns its actions and prevents duplicate registration', () => {
  const registry = new ActionRegistry();
  registry.register('demo', makeAction('demo.list'));
  assert.equal(registry.list('web').length, 1);
  assert.equal(registry.list('mcp').length, 0);
  assert.throws(() => registry.register('other', makeAction('demo.restart')), /must start/);
  assert.throws(() => registry.register('demo', makeAction('demo.list')), /Duplicate/);
  registry.unregisterModule('demo');
  assert.equal(registry.list('web').length, 0);
});

test('bundled modules load in dependency order', async () => {
  const registry = new ActionRegistry();
  const manager = new ModuleManager(resolve('modules'), registry);
  const loaded = await manager.loadAll();
  assert.deepEqual(loaded.map(m => m.id), ['system', 'services']);
  assert.deepEqual(registry.list('web').map(a => a.id).sort(), ['services.list', 'system.info']);
});
