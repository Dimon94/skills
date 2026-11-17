/**
 * check-tickets 公开入口：给 Spec 与票草稿，断言报出的规则与图指标。
 * 期望值来源：to-tickets 的归属唯一、两类依赖边、合同先行与票面不写估算规则；
 * DD-455 回放的旧切法波次与关键路径取自 Linear 原生依赖关系（7 波：470→471→473→474→476→480→484）。
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { checkTickets } = require("../scripts/check-tickets.js");

const SPEC = `## Business Flow
- T1：下单
- T2：退款
- R1：只能退款一次
## User Stories
1. 买家看到退款状态
2. 客服发起退款
`;
const ticket = (id, fields) =>
  `## ${id}: 票 ${id}\n${Object.entries(fields).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`;
const GOOD = {
  C: { Kind: "contract", Owns: "无", Stories: "", Modules: "RefundApi", "Blocked by": "None" },
  "01": { Owns: "T1", Stories: "1", Modules: "Order", "Blocked by": "C" },
  "02": { Owns: "T2, R1", Respects: "R1", Stories: "2", Modules: "Refund", "Blocked by": "C" },
};
const draft = (overrides = {}) =>
  Object.entries({ ...GOOD, ...overrides })
    .filter(([, f]) => f)
    .map(([id, f]) => ticket(id, f))
    .join("\n");
const rules = (text, spec = SPEC) =>
  [...new Set(checkTickets(spec, text).filter(([level]) => level !== "info").map(([, rule]) => rule))].sort();
const info = (text, rule, spec = SPEC) => checkTickets(spec, text).find(([l, r]) => l === "info" && r === rule)?.[2];

test("合格草稿：每条 T/R 恰有一个 owner，合同票单独成第 1 波，两张行为票并发", () => {
  assert.deepEqual(rules(draft()), []);
  assert.equal(info(draft(), "waves"), "1:C  2:01,02");
});

test("同一 T 被两张票 Owns，或无人 Owns，都报 owner", () => {
  assert.deepEqual(rules(draft({ "01": { ...GOOD["01"], Owns: "T1, T2" } })), ["owner"]);
  assert.deepEqual(rules(draft({ "02": { ...GOOD["02"], Owns: "T2" } })), ["owner"]);
});

test("Respects 不算覆盖；引用未定义编号报 undefined", () => {
  assert.deepEqual(rules(draft({ "01": { ...GOOD["01"], Respects: "R9" } })), ["undefined"]);
});

test("User Story 没有票指向报 stories", () => {
  assert.deepEqual(rules(draft({ "02": { ...GOOD["02"], Stories: "" } })), ["stories"]);
});

test("行为票不负责任何 T/R 报 empty；structure 票可以为空", () => {
  const extra = { Owns: "", Stories: "1", Modules: "X", "Blocked by": "C" };
  assert.deepEqual(rules(draft({ "03": extra })), ["empty"]);
  assert.deepEqual(rules(draft({ "03": { ...extra, Kind: "structure" } })), []);
});

test("合同票负责 T、带阻塞边或多于一张，都报 contract", () => {
  assert.deepEqual(rules(draft({ C: { ...GOOD.C, Owns: "T1" }, "01": { ...GOOD["01"], Owns: "无" } })).includes("contract"), true);
  assert.deepEqual(rules(draft({ C: { ...GOOD.C, "Blocked by": "01" } })), ["contract", "edges"].sort());
  assert.deepEqual(rules(draft({ D: { ...GOOD.C } })), ["contract"]);
});

test("缺 Blocked by、引用不存在的票、依赖成环，都报 edges", () => {
  const { "Blocked by": _, ...noEdge } = GOOD["01"];
  assert.deepEqual(rules(draft({ "01": noEdge })), ["edges"]);
  assert.deepEqual(rules(draft({ "01": { ...GOOD["01"], "Blocked by": "99" } })), ["edges"]);
  const cyclic = draft({ "01": { ...GOOD["01"], "Blocked by": "02" }, "02": { ...GOOD["02"], "Blocked by": "01" } });
  assert.deepEqual(rules(cyclic), ["edges"]);
});

test("票面出现 token 估算数字报 token；普通数字不报", () => {
  assert.deepEqual(rules(draft({ "01": { ...GOOD["01"], Note: "约 95k" } })), ["token"]);
  assert.deepEqual(rules(draft({ "01": { ...GOOD["01"], Note: "超时 20 秒，最多 3 次" } })), []);
});

test("同一波两张行为票声明同一 Module 报 overlap 警告，不报错", () => {
  const text = draft({ "02": { ...GOOD["02"], Modules: "Order" } });
  const overlap = checkTickets(SPEC, text).filter(([, rule]) => rule === "overlap");
  assert.deepEqual(overlap.map(([level]) => level), ["warn"]);
});

// ---- DD-455 回放：旧切法 vs 合同先行 --------------------------------------
const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

test("DD-455 旧切法：7 波，R 贯穿多票导致 owner 不唯一，Story 无落点", () => {
  const spec = fixture("dd455-spec.md");
  const old = fixture("dd455-old.md");
  assert.equal(info(old, "critical-path", spec), "470 → 471 → 473 → 474 → 476 → 480 → 484（7 波）");
  assert.deepEqual(rules(old, spec), ["overlap", "owner", "stories"]);
});

test("DD-455 合同先行：无 error，关键路径 6 波，同波 Module 重叠只剩 1 处", () => {
  const spec = fixture("dd455-spec.md");
  const lines = checkTickets(spec, fixture("dd455-new.md"));
  assert.deepEqual(lines.filter(([level]) => level === "error"), []);
  assert.equal(info(fixture("dd455-new.md"), "critical-path", spec), "C → 472 → 473 → 474 → 476 → 480（6 波）");
  assert.equal(lines.filter(([, rule]) => rule === "overlap").length, 1);
});
