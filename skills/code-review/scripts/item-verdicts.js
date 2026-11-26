#!/usr/bin/env node
// ========================================================================
// L3 文件合同
// COORD: skills/code-review/scripts/item-verdicts.js
// INPUT: 已核锁的 smyw Spec 与 Spec 子代理的 ItemVerdict[]。
// OUTPUT: Spec 轴的逐项 finding 与 verdict。CLI 同时回传原始结论供 compare 使用。
// POS: code-review 拥有 P1 判定。证据齐全性归 spec-preview 的 compare。
// DEPS: repo://skills/spec-preview/lib/change-items.cjs 的 changeItems。
// EXPORT: judgeItems(spec, verdicts) -> { verdict, findings }。
// TEST: repo://skills/spec-preview/tests/scenarios.test.mjs 的 S6。
// L4 判定合同
// INVARIANT: 锁定版每个改动项恰有一条结论。接受只对该结论的 id 生效。
// OUT: 未接受的 deviation、missing、extra 各产生一条 P1。存在 P1 即 BLOCK。
// FAIL: 输入不完整时抛出带 rule 的 Error。CLI 只写 stderr 并退出 2。
// L5 参数合同
// PARAM: <锁定版 spec.json> <verdicts.json>，均为文件路径。
// PAIR: extra 结论使用 extra:<短名>。accepted 为用户原话，纯空白视为未接受。
// L6 过程合同
// CHAIN: 以锁定版核对结论覆盖后输出判定。用户明确接受某项后重跑相同输入合同。
// ========================================================================
const { readFileSync } = require('node:fs');
const { changeItems } = require('../../spec-preview/lib/change-items.cjs');

const verdictKinds = new Set(['match', 'deviation', 'missing', 'extra']);

function fail(rule, message, cause) {
  throw Object.assign(new Error(message, { cause }), { rule });
}

function changedIds(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    fail('spec-invalid', '请传入锁定版 Spec 的 JSON 对象。');
  }
  try {
    return new Set(changeItems(spec).map(({ id }) => id));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    fail('spec-invalid', '无法读取 Spec 改动项。请核对锁定版 JSON。', error);
  }
}

function validateVerdict({ id, verdict }, expected, seen) {
  if (!verdictKinds.has(verdict)) {
    fail('verdict-invalid', `请为 ${id ?? '缺少 id 的结论'} 填写 match、deviation、missing 或 extra。`);
  }
  if (seen.has(id)) fail('verdict-duplicate', `结论 ${id} 重复。请保留一条。`);
  const locked = expected.has(id);
  if (!locked && (typeof id !== 'string' || !/^extra:\S+$/u.test(id))) {
    fail('verdict-unknown', `结论 ${id} 不在锁定版中。请核对 id 或使用 extra:<短名>。`);
  }
  if (locked === (verdict === 'extra')) {
    fail('verdict-kind', `结论 ${id} 的类型与锁定版不符。请核对 extra 标记。`);
  }
}

function judgeItems(spec, verdicts) {
  if (!Array.isArray(verdicts)) fail('verdict-invalid', '请传入 ItemVerdict JSON 数组。');
  const expected = changedIds(spec);
  const seen = new Set();
  const findings = [];
  for (const entry of verdicts) {
    validateVerdict(entry ?? {}, expected, seen);
    const { id, verdict, accepted } = entry;
    seen.add(id);
    if (verdict !== 'match' && !(typeof accepted === 'string' && accepted.trim())) {
      findings.push({ id, severity: 'P1', verdict, rule: 'unaccepted' });
    }
  }
  for (const id of expected) {
    if (!seen.has(id)) fail('verdict-missing', `缺少 ${id} 的结论。请补齐后重跑。`);
  }
  return { verdict: findings.length ? 'BLOCK' : 'PASS', findings };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) fail('input-json', `${path} 不是有效 JSON。请修正文件。`, error);
    if (!error.code) throw error;
    fail('input-read', `无法读取 ${path}（${error.code}）。请核对文件路径。`, error);
  }
}

function main(args) {
  try {
    if (args.length !== 2) fail('usage', '用法：node item-verdicts.js <锁定版 spec.json> <verdicts.json>');
    const [specPath, verdictsPath] = args;
    const spec = readJson(specPath);
    const verdicts = readJson(verdictsPath);
    const result = judgeItems(spec, verdicts);
    console.log(JSON.stringify({ ...result, verdicts }));
    return result.verdict === 'PASS' ? 0 : 1;
  } catch (error) {
    if (!error.rule) throw error;
    console.error(`${error.rule}\t${error.message.replace(/[\r\n]+/g, ' ')}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { judgeItems };
