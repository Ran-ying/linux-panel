import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../platform/state-store.js';
import { ActionRegistry } from '../core/action-registry.js';
import { setMcpPolicy, mcpPolicy, actionAllowed, exposedReadActions, exposedMcpActions } from '../platform/mcp-policy.js';

test('MCP default policy is disabled and denies every Action', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'mcp-policy-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const store = new StateStore(join(folder, 'state.json'));
  assert.deepEqual(mcpPolicy(await store.snapshot()), { enabled: false, registrationEnabled: false, allowUpdates:false, allowDirectUpdates:false, tools: {} });
  assert.equal(actionAllowed(await store.snapshot(), { kind:'read', exposure:{mcp:true}, id:'system.info' }), false);
});

test('MCP enabled exposes declared read actions globally, not per-action settings', async t => {
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
  assert.deepEqual(updated,{enabled:true,registrationEnabled:true,allowUpdates:false,allowDirectUpdates:false,tools:{}});
  assert.equal(actionAllowed(await store.snapshot(),registry.get('system.info')),true);
  assert.equal(actionAllowed(await store.snapshot(),registry.get('system.restart')),false);
  // Clearing an old checkbox or adding a newly registered read action
  // cannot hide it from an authenticated trusted MCP client.
  const withoutSelection=await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:true},'1');
  assert.deepEqual(withoutSelection.tools,{});
  assert.equal(actionAllowed(await store.snapshot(),registry.get('system.info')),true);
  assert.deepEqual(exposedReadActions(registry).map(a=>a.id),['system.info']);
  await setMcpPolicy(store,registry,{enabled:false,registrationEnabled:false,tools:{'system.info':true}},'1');
  assert.equal(actionAllowed(await store.snapshot(),registry.get('system.info')),false);
  assert.equal((await store.snapshot()).audit.at(-1).event,'mcp.policy.updated');
  const withUpdates=await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:false,allowUpdates:true,tools:{'system.info':false}},'1');
  assert.equal(withUpdates.allowUpdates,true);
  assert.equal(withUpdates.allowDirectUpdates,false);
  const direct=await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:false,allowDirectUpdates:true,tools:{}},'1');
  assert.equal(direct.allowDirectUpdates,true);
  const disabledDirect=await setMcpPolicy(store,registry,{enabled:false,registrationEnabled:false,allowDirectUpdates:true,tools:{}},'1');
  assert.equal(disabledDirect.allowDirectUpdates,false);
  await assert.rejects(setMcpPolicy(store,registry,{enabled:true,registrationEnabled:false,allowDirectUpdates:'yes',tools:{}},'1'),{statusCode:400});
  assert.equal(actionAllowed(await store.snapshot(),registry.get('system.info')),false);
  await assert.rejects(setMcpPolicy(store,registry,{enabled:true,registrationEnabled:false,allowUpdates:'yes',tools:{}},'1'),{statusCode:400});
});

test('only the approved terminal write Action joins globally callable tools',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'panel-terminal-policy-'));
  t.after(()=>rm(folder,{recursive:true,force:true}));
  const store=new StateStore(join(folder,'state.json')),registry=new ActionRegistry();
  const make=id=>({id,kind:'write',permission:'terminal:execute',executionPolicy:'user-shell',
    exposure:{mcp:true,web:true},inputSchema:{type:'object',properties:{}},execute:async()=>({})});
  registry.register('terminal',make('terminal.execute'));
  registry.register('other',make('other.execute'));
  await setMcpPolicy(store,registry,{enabled:true,registrationEnabled:false},'fixture');
  const state=await store.snapshot();
  assert.deepEqual(exposedMcpActions(registry).map(action=>action.id),['terminal.execute']);
  assert.equal(actionAllowed(state,registry.get('terminal.execute')),true);
  assert.equal(actionAllowed(state,registry.get('other.execute')),false);
});
