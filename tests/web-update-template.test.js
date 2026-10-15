import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A bare <template> nested inside a Vue component is compiled to an inert
// HTMLTemplateElement; all nested controls disappear despite a successful build.
const component = readFileSync(fileURLToPath(
  new URL('../apps/web/src/components/UpdateManager.vue',import.meta.url)), 'utf8');

test('UpdateManager renders update controls outside inert nested templates', () => {
  const bareTags=[...component.matchAll(/^\s*<template>\s*$/gm)];
  assert.equal(bareTags.length,1,'only the outer Vue SFC <template> is allowed');
  const controls=['panel-target-sha','@click="check"','@click="request"',
    '@click="updateNow"','@click="approve"'];
  for(const control of controls) {
    assert.ok(component.includes(control),'expected user-visible updater control '+control);
  }
  assert.match(component,/aria-label="面板更新管理"/);
});
