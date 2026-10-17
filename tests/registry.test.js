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
  ...overrides
});

test('module owns its actions and prevents duplicate registration', () => {
  const registry = new ActionRegistry();
  registry.register('demo', makeAction('demo.list'));
  assert.equal(registry.list('web').length, 1);
  assert.equal(registry.list('mcp').length, 0);
  assert.equal(Object.hasOwn(registry.list('web')[0], 'presentation'), false);
  assert.equal(registry.list('web')[0].outputSchema.type, 'object');
  assert.equal(Object.hasOwn(registry.list('web')[0], 'execute'), false);
  assert.throws(() => registry.register('other', makeAction('demo.restart')), /must start/);
  assert.throws(() => registry.register('demo', makeAction('demo.list')), /Duplicate/);
  registry.unregisterModule('demo');
  assert.equal(registry.list('web').length, 0);
});

test('generic module reordering preserves absent IDs without hardcoded module names',async()=>{
  const manager=new ModuleManager(resolve('modules'),new ActionRegistry());
  await manager.loadAll(['files','missing-future-module','system','terminal','services']);
  manager.loaded.push({id:'panel',name:'Panel'});
  const before=manager.loaded.filter(module=>module.id!=='panel').map(module=>module.id);
  assert.deepEqual(before,['files','system','terminal','services','cron','nginx','telegram','v2ray','certbot']);
  const planned=manager.planOrder(['system','files','terminal','services','cron','nginx','telegram','v2ray','certbot']);
  assert.deepEqual(planned,['system','missing-future-module','files','terminal','services','cron','nginx','telegram','v2ray','certbot']);
  manager.applyOrder(planned);
  assert.deepEqual(manager.loaded.map(module=>module.id),['system','files','terminal','services','cron','nginx','telegram','v2ray','certbot','panel']);
  for(const bad of [['system','files','services'],['files','files','terminal','services','cron'],
    ['system','files','terminal','other','cron'],null,{}])
    assert.throws(()=>manager.planOrder(bad),{statusCode:400});
});

test('bundled modules load after dependencies and expose expected actions', async () => {
  const registry = new ActionRegistry();
  const manager = new ModuleManager(resolve('modules'), registry);
  const loaded = await manager.loadAll();
  const ids = loaded.map(m => m.id);
  assert.deepEqual([...ids].sort(), ['certbot','cron','files', 'nginx', 'services', 'system', 'telegram','terminal','v2ray']);
  assert.deepEqual(ids,['system','services','terminal','files','cron','nginx','telegram','v2ray','certbot']);
  assert.deepEqual(registry.list('web').map(a => a.id).sort(),
    ['certbot.list','certbot.renew','cron.list','cron.remove','cron.save','cron.systemSet','files.accounts','files.chmod','files.chown','files.create','files.delete','files.list','files.read','files.rename','files.upload','files.write','nginx.apply','nginx.certificates','nginx.check','nginx.read','nginx.renew','nginx.repairExecutor','nginx.siteTls','nginx.siteTlsKey','nginx.service','nginx.sites','nginx.status','services.list','services.logs','system.info','system.resources','telegram.botInfo','telegram.buttons','telegram.messages','telegram.press','telegram.send','telegram.status','terminal.execute','v2ray.install','v2ray.read','v2ray.save','v2ray.service','v2ray.status','v2ray.test']);
  for(const id of ['storage.usage','system.cpu','system.memory'])assert.equal(registry.get(id),undefined);
});

test('saved module order survives reload and new modules append despite earlier manifest ranks',async()=>{
  const manager=new ModuleManager(resolve('modules'),new ActionRegistry());
  await manager.loadAll(['terminal','files','temporarily-disabled']);
  assert.deepEqual(manager.loaded.map(m=>m.id),['terminal','files','system','services','cron','nginx','telegram','v2ray','certbot']);
  assert.deepEqual(manager.order,['terminal','files','temporarily-disabled','system','services','cron','nginx','telegram','v2ray','certbot']);
  const again=new ModuleManager(resolve('modules'),new ActionRegistry());
  await again.loadAll(manager.order);
  assert.deepEqual(again.loaded,manager.loaded);
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
