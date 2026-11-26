import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const previewGate = '../git-rebase-main/references/closeout.md#预览门';

test('R10 PR 在推送和合并前都必须走共享预览门', () => {
  const push = read('../../git-push-pr/SKILL.md');
  const merge = read('../../gh-merge-pr/SKILL.md');
  const gate = read('../references/closeout.md').split('## 预览门\n')[1].split('\n## 1.')[0];
  assert.match(gate, /有 `Preview:` 锁定行[\s\S]*?`compare [^\n]+/);
  assert.match(gate, /无 `Preview:` 锁定行[\s\S]*?`delta [^\n]+[\s\S]*?明确确认当前预览后再合入/);
  assert.doesNotMatch(push, /If the linked Spec has a `Preview:` lock/i);
  const pushGate = push.indexOf(previewGate);
  const mergeGate = merge.indexOf(previewGate);
  assert.ok(pushGate > 0 && pushGate < push.indexOf('`git push -u'));
  assert.ok(mergeGate > merge.indexOf('## 5. 落地') && mergeGate < merge.indexOf('`gh pr merge <n>'));
});
