import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeItems } from '../lib/change-items.cjs';

test('整页增删及最外层节点按页面顺序返回，略过根节点和已认领节点的子项', () => {
  const spec = { pages: [
    { id: 'added-page', change: 'added', root: { children: [{ id: 'hidden', change: 'added' }] } },
    { id: 'edited-page', change: 'modified', root: { id: 'root', change: 'modified', children: [
      { id: 'panel', change: 'unchanged', children: [
        { id: 'field', change: 'modified', children: [{ id: 'label', change: 'modified' }] },
        { id: 'button', change: 'removed' },
      ] },
    ] }, overlays: [
      { id: 'dialog', children: [{ id: 'close-dialog', change: 'added' }] },
      { id: 'popover', change: 'removed', children: [{ id: 'hidden-link', change: 'removed' }] },
    ] },
    { id: 'removed-page', change: 'removed' },
  ] };
  assert.deepEqual(changeItems(spec), [
    { id: 'added-page', kind: 'page', change: 'added' },
    { id: 'field', kind: 'node', change: 'modified' },
    { id: 'button', kind: 'node', change: 'removed' },
    { id: 'close-dialog', kind: 'node', change: 'added' },
    { id: 'popover', kind: 'node', change: 'removed' },
    { id: 'removed-page', kind: 'page', change: 'removed' },
  ]);
});

test('整条流程增删和后端模块改动各算一项，其余流程和模块按子项返回', () => {
  const spec = {
    flows: [
      { id: 'new-flow', change: 'added', steps: [{ id: 'hidden-step', change: 'added' }] },
      { id: 'edited-flow', change: 'modified', steps: [{ id: 'edit-step', change: 'modified' }, { id: 'keep-step', change: 'unchanged' }] },
      { id: 'removed-flow', change: 'removed', steps: [{ id: 'hidden-removed-step', change: 'removed' }] },
      { id: 'flow', steps: [{ id: 'append-step', change: 'added' }] },
    ],
    backend: [
      { id: 'module', change: 'modified', items: [{ id: 'hidden-field', change: 'added' }] },
      { id: 'other-module', change: 'unchanged', items: [{ id: 'endpoint', change: 'removed' }, { id: 'keep-item', change: 'unchanged' }] },
      { id: 'last-module', items: [{ id: 'append-field', change: 'added' }] },
    ],
  };
  assert.deepEqual(changeItems(spec), [
    { id: 'new-flow', kind: 'step', change: 'added' },
    { id: 'edit-step', kind: 'step', change: 'modified' },
    { id: 'removed-flow', kind: 'step', change: 'removed' },
    { id: 'append-step', kind: 'step', change: 'added' },
    { id: 'module', kind: 'backend', change: 'modified' },
    { id: 'endpoint', kind: 'backend', change: 'removed' },
    { id: 'append-field', kind: 'backend', change: 'added' },
  ]);
});

test('没有改动时返回空数组', () => {
  assert.deepEqual(changeItems({}), []);
  assert.deepEqual(changeItems({
    pages: [{ id: 'page', change: 'unchanged', root: { children: [{ id: 'node' }] } }],
    flows: [{ id: 'flow', change: 'modified', steps: [{ id: 'step', change: 'unchanged' }] }],
    backend: [{ id: 'module', items: [{ id: 'field' }] }],
  }), []);
});
