import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModuleNavigation} from '../apps/web/src/module-navigation.js';

test('navigation maps loaded modules and their Actions without business-specific folding',()=>{
  const modules=[{id:'system',name:'系统概览'},{id:'services',name:'服务浏览'}];
  const actions=[{id:'system.info',moduleId:'system'},{id:'system.resources',moduleId:'system'},
    {id:'services.list',moduleId:'services'},{id:'other.read',moduleId:'other'}];
  const groups=buildModuleNavigation(modules,actions);
  assert.deepEqual(groups.map(g=>g.actions.map(a=>a.id)),[['system.info','system.resources'],['services.list']]);
  assert.equal(groups[0].actions[0],actions[0]);
  assert.equal(Object.hasOwn(modules[0],'actions'),false);
});
test('new and empty modules need no Vue edits or special module names',()=>{
  assert.deepEqual(buildModuleNavigation([{id:'backup',name:'备份'}],[]),[{id:'backup',name:'备份',actions:[]}]);
  assert.deepEqual(buildModuleNavigation([],[]),[]);
  assert.deepEqual(buildModuleNavigation([{id:'storage',name:'Custom storage'}],[{id:'storage.read',moduleId:'storage'}])[0].actions,
    [{id:'storage.read',moduleId:'storage'}]);
});
