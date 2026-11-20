/**
 * check-spec 公开入口：给一份 Spec 文本，断言报出的规则集合。
 * 期望值来源：to-spec 模板的九个章节与 Dependencies 两行、第 6 步发布前核对项（含每个状态唯一 owner）、模板“不写文件路径”。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkSpec } = require('../scripts/check-spec.js');

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
