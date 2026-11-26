/**
 * check-spec 公开入口：给一份 Spec 文本，断言报出的规则集合。
 * 期望值来源：to-spec 模板的九个章节与 Dependencies 两行、第 6 步发布前核对项（含每个状态唯一 owner）、模板“不写文件路径”。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkSpec } = require('../scripts/check-spec.js');

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const STOP = readFileSync(join(__dirname, '../../to-tickets/references/stop-turn/spec.md'), 'utf8');
const scene = STOP.split('\n').find(line => line.startsWith('| S1 |'));

test('停止回合的场景定义有独立来源、唯一标识，covers 对应每条业务 T/R', () => {
  assert.deepEqual(checkSpec(STOP), []);
  const cases = [
    [scene.replace(/\| MMF A [^|]+\|/, '|  |'), /source/],
    [`${scene}\n${scene}`, /S1/],
    [scene.replace('T1, R1', 'T1, R9'), /R9/],
    [scene.replace('T1, R1', 'T1') + '\n\n备注仍提到 R1。', /R1/],
    [scene.replace('T1, R1', 'T1, R1, apple'), /covers/],
    ['', /场景/],
  ];
  for (const [replacement, message] of cases) {
    const result = checkSpec(STOP.replace(scene, replacement));
    assert.ok(result.some(([rule, detail]) => rule === 'scenario' && message.test(detail)), JSON.stringify(result));
  }
});

const DEPS = '- Blocked by: 无，独立 MMF\n- Blocks: 无';
const spec = ({ flow, decisions, testing, deps = DEPS, extra = '' }) => `## Problem Statement
用户看不到退款结果。
## Solution
显示退款状态。
## Business Flow
${flow}
## User Stories
1. As a buyer, I want refund status, so that I trust the shop
## Implementation Decisions
${decisions}
## Testing Decisions
${testing}
## Dependencies
${deps}
## Out of Scope
无
## Further Notes
${extra}
`;

const FLOW = 'unpaid --> paid: T1 支付成功\npaid --> refunded: T2 退款完成\n- R1：只能退款一次';
const rules = (text) => [...new Set(checkSpec(text).map(([rule]) => rule))].sort();

test('合格 Spec：每个 T/R 与状态恰有一条 Owns 行，T/R 进入 Testing Decisions', () => {
  const text = spec({ flow: FLOW, decisions: '- Owns：T1–T2，unpaid、paid、refunded。\n- Owns: R1。Participants：T1 支付入口', testing: '- T1、T2、R1 经退款 Interface 检查' });
  assert.deepEqual(checkSpec(text), []);
});

test('历史输入可读回；同一正文作为新草稿时须补齐场景', () => {
  const legacy = spec({flow: 'N/A：纯查询', decisions: '复用查询', testing: '结果可见'});
  assert.deepEqual(checkSpec(legacy), []);
  assert.ok(checkSpec(legacy, true).some(([rule]) => rule === 'scenario'));
});

test('Business Flow 写 N/A 时不要求 T/R', () => {
  assert.deepEqual(checkSpec(spec({ flow: 'N/A：只读筛选，没有业务状态', decisions: '复用查询 Module', testing: '筛选结果' })), []);
});

test('缺章节或 Business Flow 空白都失败', () => {
  assert.deepEqual(rules('## Problem Statement\nx\n## Solution\ny'), ['business-flow', 'sections']);
});

test('Dependencies 缺 Blocked by 或 Blocks 行都失败；写“无”也算声明', () => {
  const missing = spec({ flow: 'N/A：无状态', decisions: '复用', testing: '筛选', deps: '退款候选之后再做' });
  assert.deepEqual(checkSpec(missing).map(([, m]) => m), ['Dependencies 缺少 Blocked by: 行；没有边写“无”和依据', 'Dependencies 缺少 Blocks: 行；没有边写“无”和依据']);
  const edges = spec({ flow: 'N/A：无状态', decisions: '复用', testing: '筛选', deps: '- `Blocked by:` DD-12 销售导出 · 上线 · 生成结果 Interface · DD-12 上线\n- **Blocks**：无' });
  assert.deepEqual(checkSpec(edges), []);
});

test('T/R 无 owner、重复 owner、未进 Testing Decisions、引用未定义编号都失败', () => {
  const text = spec({ flow: FLOW, decisions: '- Owns: T1, R1\n- Owner: R1, R9', testing: '- T1 检查' });
  const errors = checkSpec(text).map(([rule, message]) => `${rule} ${message.split(' ')[0]}`);
  assert.ok(errors.includes('owner T2'));
  assert.ok(errors.includes('owner R1'));
  assert.ok(errors.includes('testing T2'));
  assert.ok(errors.includes('undefined R9'));
});

test('Business Flow 的状态无 owner 或重复 owner 都失败；state 别名与 [*] 按状态 id 计', () => {
  const flow = 'state "待支付" as unpaid\n[*] --> unpaid\nunpaid --> paid: T1 支付成功\npaid --> refunded: T2 退款完成\n- R1：只能退款一次';
  const text = spec({ flow, decisions: '- Owns: T1–T2, R1, unpaid, paid\n- Owns: paid', testing: '- T1、T2、R1 检查' });
  assert.deepEqual(checkSpec(text).map(([rule, m]) => `${rule} ${m.split(' ')[0]}`), ['state paid', 'state refunded']);
});

test('正文出现仓库文件路径失败，URL 不算', () => {
  const text = spec({ flow: 'N/A：无状态', decisions: '改 src/main/lib/tool-model.ts', testing: '见 scripts/e2e/cases.mjs', extra: 'https://linear.app/x/issue/DD-1/a.ts' });
  assert.deepEqual(checkSpec(text).map(([, m]) => m), ['Spec 不写文件路径：src/main/lib/tool-model.ts', 'Spec 不写文件路径：scripts/e2e/cases.mjs']);
});

// ---- 读回父项 --------------------------------------------------------------
// 期望值来源：to-spec 第 6 步“来自 Epic 的 Spec 在创建时以 Epic 为原生父项”。
// 反例取自 JB-513 读回：正文 Dependencies 写了 Epic 链接，tracker 只生成 related，parentId 为空。
const { spawnSync } = require('node:child_process');
const EPIC = 'https://linear.app/erplus/issue/JB-512/tk-ada-zero-downtime';
const fromEpic = spec({ flow: 'N/A：无状态', decisions: '- 复用现有入口', testing: '- 公开入口检查', deps: `${DEPS}\n- Epic: ${EPIC}\n- MMF: M2` });

test('来自 Epic 的 Spec 读回父项为空或不是该 Epic 时报 parent；草稿与独立 Spec 不查父项', () => {
  const parentRules = (text, parent) => checkSpec(text, false, parent).map(([rule]) => rule);
  assert.deepEqual(parentRules(fromEpic, ''), ['parent']);
  assert.deepEqual(parentRules(fromEpic, 'JB-511'), ['parent']);
  assert.deepEqual(parentRules(fromEpic, 'JB-512'), []);
  assert.deepEqual(parentRules(fromEpic, EPIC), []);
  assert.deepEqual(parentRules(fromEpic), []);
  assert.deepEqual(parentRules(spec({ flow: 'N/A：无状态', decisions: '- 复用', testing: '- 检查' }), ''), []);
});

test('CLI --parent 读回为空时退出 1 并输出 parent 行', () => {
  const script = require.resolve('../scripts/check-spec.js');
  const run = (parent) => spawnSync(process.execPath, [script, '--parent', parent], { input: fromEpic, encoding: 'utf8' });
  const orphan = run('');
  assert.equal(orphan.status, 1);
  assert.match(orphan.stdout, /^error\tparent\t/m);
  assert.equal(run('JB-512').stdout.trim(), 'ok');
});

test('CLI --require-preview 只接受 Dependencies 中有效的版本锁，并能与其他发布选项同时使用', () => {
  const script = require.resolve('../scripts/check-spec.js');
  const run = (input, ...args) => spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
  const hash = 'ab'.repeat(32);
  const lock = `Preview: v2 sha256:${hash}`;
  const addLock = (line) => STOP.replace('## Dependencies\n', `## Dependencies\n${line}\n`);
  assert.equal(run(STOP).stdout.trim(), 'ok');
  for (const text of [STOP, `${STOP}\n${lock}`, addLock(`Preview: v0 sha256:${hash}`),
    addLock(`Preview: v2 sha256:${hash.toUpperCase()}`), addLock(lock.slice(0, -1))]) {
    const result = run(text, '--require-preview');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^error\tpreview\t[^\n]+\n$/);
  }
  for (const line of [lock, `- \`${lock}\``, `* **Preview:** v2 sha256:${hash}`]) {
    const result = run(addLock(line), '--parent', '', '--require-preview', '--require-scenarios');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), 'ok');
  }
});
