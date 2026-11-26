import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

function read(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.indexOf(heading);
  return start < 0 ? '' : lines.slice(start + 1).join('\n').split(/^#{1,3} /m)[0];
}

const dimon = read('../SKILL.md');
const triage = section(dimon, '### 判定规模');
const ruleLine = /^- ([①②③]) (.+?)。写入 `(scope:[\w-]+)`，走 \[[^\]]+\]\(([^)]+)\)。/gm;
const conditions = [
  [/^已有行为偏离已承诺的预期（[^）]+），且能写出复现步骤$/, task => task.regression && task.reproducible],
  [/^新需求只有一个可检查结果（谁 · 入口 · 做什么 · 看到什么），不新增跨 Module Interface 或共享状态，也不需要业务决定$/,
    task => task.newRequest && task.results === 1 && !task.crossModule && !task.sharedState && !task.businessDecision],
  [/^其余任务$/, () => true],
];

function classify(markdown, task) {
  for (const [, hit, condition, scope, route] of markdown.matchAll(ruleLine)) {
    const [, matches] = conditions.find(([pattern]) => pattern.test(condition)) ?? [];
    assert.ok(matches, `无法识别 ${hit} 的判定条件 ${condition}`);
    if (matches(task)) return { hit, scope, route };
  }
}

const scenarios = [
  ['S14-A 提交后列表不刷新，Spec 写了应刷新',
    { regression: true, reproducible: true },
    { hit: '①', scope: 'scope:bug', route: 'playbooks/bug-fix.md' }],
  ['S14-B 把按钮文案改成保存',
    { newRequest: true, results: 1 },
    { hit: '②', scope: 'scope:small', route: 'playbooks/small-change.md' }],
  ['S14-C 新增导出功能，含新接口和权限',
    { newRequest: true, results: 1, crossModule: true, businessDecision: true },
    { hit: '③', scope: 'scope:mmf', route: '../to-spec/SKILL.md' }],
];

for (const [name, task, expected] of scenarios) {
  test(name, () => assert.deepEqual(classify(triage, task), expected));
}

test('S14 判定顺序、标签读回和改线', () => {
  assert.deepEqual([...triage.matchAll(ruleLine)].map(([, hit]) => hit), ['①', '②', '③']);
  assert.match(dimon, /任务进来判规模[^\n]+\]\(#判定规模\)/);
  assert.match(triage, /先中先停/);
  assert.match(triage, /写入 Issue[^\n]+读回[^\n]+回复写出命中的条目/);
  assert.match(triage, /判不准[^\n]+推荐[^\n]+问用户/);
  assert.match(triage, /用户改标签[^\n]+改线/);
  assert.match(triage, /多个可单独上线的部分[^\n]+to-epic/);
});

test('S15 实现越界时停止并升级到 MMF', () => {
  const upgrade = triage.split('\n').find(line => line.startsWith('实现中，')) ?? '';
  assert.match(upgrade, /`scope:small` 或 `scope:bug`/);
  assert.match(upgrade, /第二个可检查结果、新的跨 Module Interface 或需要业务决定/);
  assert.match(upgrade, /改变已承诺的预期[^\n]+停止实现[^\n]+改为 `scope:mmf` 并读回/);
  assert.match(upgrade, /下一步给出 `\/to-spec <Issue>`[^\n]+该分支不走变更预览/);
});

test('小需求剧本按 Issue 从实现走到合入前预览', () => {
  const playbook = '../playbooks/small-change.md';
  assert.ok(existsSync(new URL(playbook, import.meta.url)), '缺少 small-change 剧本');
  const markdown = read(playbook);
  assert.match(markdown, /Issue 即票[^\n]+不写 Spec[^\n]+不做事前预览/);
  assert.match(markdown, /^1\. .*bdd.*公开入口.*先红后绿/m);
  assert.match(markdown, /^2\. .*逐项自检.*#判定规模/m);
  assert.match(markdown, /^3\. 合入前.*spec-preview.*`delta`.*生成变更预览.*closeout\.md#预览门.*等用户确认/m);
});

test('Herdr 的 small 入队复用 bugfix 并引用 dimon-mode', () => {
  const autopilot = read('../../herdr-autopilot/SKILL.md');
  const enqueue = section(autopilot, '### 2. 新需求或 Bug 入队（仅当用户给出新任务时）');
  assert.match(enqueue, /^\| `small` \| `bugfix` \| .*\/dimon-mode .*「判定规模」.*scope:small.*playbooks\/small-change\.md/m);
  assert.match(enqueue, /\.\.\/dimon-mode\/SKILL\.md#判定规模/);
  assert.doesNotMatch(autopilot, /[①②③]|scope:bug/);
});

test('登记规模分流的三个 Issue 标签', () => {
  const labels = section(read('../../../docs/agents/triage-labels.md'), '## 规模分流');
  assert.deepEqual([...labels.matchAll(/^\| `([^`]+)` \|/gm)].map(([, label]) => label),
    ['scope:bug', 'scope:small', 'scope:mmf']);
});
