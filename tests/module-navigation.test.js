import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModuleNavigation } from '../apps/web/src/module-navigation.js';

test('module navigation groups Actions by owning module, respecting module order', () => {
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
  assert.deepEqual(groups.map(group => group.id), ['system', 'services', 'storage']);
  assert.deepEqual(groups[0].actions.map(action => action.id), ['system.info', 'system.memory', 'system.cpu']);
  assert.deepEqual(groups[1].actions.map(action => action.id), ['services.list']);
  assert.deepEqual(groups[2].actions.map(action => action.id), ['storage.usage']);
  assert.equal(groups[0].name, '系统概览');
  assert.equal(actions[0].moduleId, 'services'); // input array is untouched
});

test('new or empty modules do not require hard-coded Vue navigation items', () => {
  const groups = buildModuleNavigation([{ id: 'backup', name: '备份', version: '0.1.0' }], []);
  assert.deepEqual(groups[0].actions, []);
  assert.equal(groups[0].name, '备份');
  assert.deepEqual(buildModuleNavigation([], []), []);
});
