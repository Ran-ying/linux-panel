import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../platform/state-store.js';
import { ActionRegistry } from '../core/action-registry.js';
import { setMcpPolicy, mcpPolicy, actionAllowed, exposedReadActions } from '../platform/mcp-policy.js';

test('MCP default policy is disabled and denies every Action', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'mcp-policy-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = new StateStore(join(folder, 'state.json'));
  assert.deepEqual(mcpPolicy(await store.snapshot()), { enabled: false, registrationEnabled: false, tools: {} });
  assert.equal(actionAllowed(await store.snapshot(), { kind:'read', exposure:{mcp:true}, id:'system.info' }), false);
});

test('policy rejects unknown and write Actions and persists an explicit allowlist', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'mcp-policy-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = new StateStore(join(folder, 'state.json'));
  const registry = new ActionRegistry();
  const action = (id,kind) => ({ id, kind, permission:'system:read', exposure:{mcp:true,web:true},
    title:id, description:id, inputSchema:{type:'object',properties:{},additionalProperties:false},
    execute:async()=>({}) });
  registry.register('system',action('system.info','read'));
  registry.register('system',action('system.restart','write'));
  await assert.rejects(setMcpPolicy(store,registry,{enabled:true,registrationEnabled:true,tools:{'system.restart':true}},'1'),{statusCode:400});
  await assert.rejects(setMcpPolicy(store,registry,{enabled:true,registrationEnabled:true,tools:{'other.action':true}},'1'),{statusCode:400});
  const updated = await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:true,tools:{'system.info':true}},'1');
  assert.deepEqual(updated,{enabled:true,registrationEnabled:true,tools:{'system.info':true}});
  assert.equal(actionAllowed(await store.snapshot(),registry.get('system.info')),true);
  assert.equal(actionAllowed(await store.snapshot(),registry.get('system.restart')),false);
  assert.deepEqual(exposedReadActions(registry).map(a=>a.id),['system.info']);
  await setMcpPolicy(store,registry,{enabled:false,registrationEnabled:false,tools:{'system.info':true}},'1');
  assert.equal(actionAllowed(await store.snapshot(),registry.get('system.info')),false);
  assert.equal((await store.snapshot()).audit.at(-1).event,'mcp.policy.updated');
});
