import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModuleNavigation } from '../apps/web/src/module-navigation.js';

test('navigation includes disk usage in System Overview while preserving Action ownership', () => {
  const modules = [
    { id: 'system', name: '系统概览', version: '0.2.0' },
    { id: 'services', name: '服务浏览', version: '0.2.0' },
    { id: 'storage', name: '磁盘使用情况', version: '0.2.0' }
  ];
  const actions = [
    { id: 'services.list', moduleId: 'services', title: '服务' },
    { id: 'system.info', moduleId: 'system', title: '系统信息' },
    { id: 'storage.usage', moduleId: 'storage', title: '磁盘' },
    { id: 'system.memory', moduleId: 'system', title: '内存' },
    { id: 'system.cpu', moduleId: 'system', title: 'CPU' }
  ];
  const groups = buildModuleNavigation(modules, actions);
  assert.deepEqual(groups.map(group => group.id), ['system', 'services']);
  assert.deepEqual(groups[0].actions.map(action => action.id), ['system.info', 'system.memory', 'system.cpu', 'storage.usage']);
  assert.deepEqual(groups[1].actions.map(action => action.id), ['services.list']);
  assert.equal(groups[0].actions[3], actions[2]);
  assert.equal(actions[2].moduleId, 'storage');
  assert.equal(modules.length, 3);
  assert.equal(groups[0].name, '系统概览');
  assert.equal(actions[0].moduleId, 'services'); // input array is untouched
});

test('new or empty modules do not require hard-coded Vue navigation items', () => {
  const groups = buildModuleNavigation([{ id: 'backup', name: '备份', version: '0.1.0' }], []);
  assert.deepEqual(groups[0].actions, []);
  assert.equal(groups[0].name, '备份');
  assert.deepEqual(buildModuleNavigation([], []), []);
});

test('storage stays accessible without System Overview and folds in regardless of module order', () => {
  const storage = { id:'storage', name:'磁盘使用情况' };
  const system = { id:'system', name:'系统概览' };
  const action = { id:'storage.usage', moduleId:'storage' };
  assert.deepEqual(buildModuleNavigation([storage],[action]), [{...storage,version:undefined,actions:[action]}]);
  const grouped = buildModuleNavigation([storage,system],[action]);
  assert.deepEqual(grouped.map(group=>group.id),['system']);
  assert.deepEqual(grouped[0].actions,[action]);
  assert.deepEqual(buildModuleNavigation([system],[action])[0].actions,[],
    'do not surface Actions from a module that is not loaded');
});
