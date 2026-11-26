// ==========================================================================
// L3: spec-preview 拥有改动项提取，changes 与 check-tickets 共用 changeItems。
// L4: 纯读取 smyw Spec，返回最外层的 { id, kind, change } 改动项。
// L5: added、removed、modified 是改动标记。缺省或 unchanged 表示未改。
// L6: 按页面、流程、后端的文档顺序收集。命中整项后跳过其子项。
// TEST: node --test skills/spec-preview/tests/change-items.test.mjs
// ==========================================================================
const changed = new Set(['added', 'removed', 'modified']);
const addedOrRemoved = ({ change }) => change === 'added' || change === 'removed';
const item = ({ id, change }, kind) => ({ id, kind, change });
const changedItems = (entries = [], kind) => entries.filter(entry => changed.has(entry.change)).map(entry => item(entry, kind));

function nodeItems(node) {
  if (changed.has(node.change)) return [item(node, 'node')];
  return (node.children ?? []).flatMap(nodeItems);
}

function pageItems(page) {
  if (addedOrRemoved(page)) return [item(page, 'page')];
  return [...(page.root?.children ?? []), ...(page.overlays ?? [])].flatMap(nodeItems);
}

function changeItems({ pages = [], flows = [], backend = [] }) {
  return [
    ...pages.flatMap(pageItems),
    ...flows.flatMap(flow => addedOrRemoved(flow) ? [item(flow, 'step')] : changedItems(flow.steps, 'step')),
    ...backend.flatMap(group => changed.has(group.change) ? [item(group, 'backend')] : changedItems(group.items, 'backend')),
  ];
}

module.exports = { changeItems };
