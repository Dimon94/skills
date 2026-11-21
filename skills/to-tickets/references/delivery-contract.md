# 场景从 Spec 到整体验收的交接合同

以 [S1 的 Spec](stop-turn/spec.md) 为例。需求作者在 Spec 决定期望，`to-tickets` 把 `T1, R1` 分给 [TURN-1](stop-turn/ticket.md)。技术负责人根据目标项目的基线补齐派发合同。开发者交回本片的检查结果，技术负责人收齐各片并在集成结果上按原场景验收。

## 规划产物（A02）

| 位置 | 交接内容 |
| --- | --- |
| Spec / Business Flow | 定义 T 和 R。Implementation Decisions 拥有 Interface、Ensures 与 Module 归属。 |
| Spec / Testing Decisions | 场景表的列为 `id, covers, given, when, then, source, seam`。`id` 在本 Spec 内唯一；`covers` 列出相关 T/R；`source` 指向决定该预期的独立来源。 |
| ticket 标题和字段区 | `## <id>: <标题>`。发布后沿用 tracker id。Parent、Repo、Kind、Owns、Respects、Stories、Modules、Blocked by 仍在首个 `###` 之前。每条 T/R 在票级恰有一个 Owns，Respects 只记录须遵守的规则。 |
| ticket / What to build | `Scenarios:` 引用父 Spec 的场景 id；`Interface:` 和 `Ensures:` 定位原决定，可摘录影响本票的短签名和承诺。写明允许的业务增量和范围边界。 |
| ticket / Acceptance criteria | 每项点名场景和 T/R，写清谁从哪个入口执行什么、全部可观察结果及验证入口。`Prereq check` 沿用原位置。 |

结构票或合同票实际没有行为场景时写 `Scenarios: N/A（理由）`，验收写明保持行为的入口或要调用的冻结签名。行为票需要能回到原场景。缺少场景字段的历史票按原 id、Kind、归属与依赖读回，已认领票按原合同继续。新委派遇到缺项时沿原票号返回 `MissingDecision`。技术负责人补现场，改变业务期望须回到 Spec 的需求作者。

```ts
type Scenario = { id: string; covers: string[]; given: string; when: string; then: string; source: string; seam: string };
type Ticket = { id: string; body: string }; // tracker 持久标识与读回的 Markdown 正文
```

规划检查器沿用 [checkSpec(text)](../../to-spec/scripts/check-spec.js) 的 `[rule, message][]` 和 [checkTickets(spec, tickets)](../scripts/check-tickets.js) 的 `[level, rule, message][]`。语义对账把票面期望逐项对照原场景。[删去读回结果的错票](stop-turn/ticket-missing-result.md) 与正例只有验收句不同，即使编号与归属齐全也应退回 TURN-1。

## 执行产物（A03）

```ts
type Revision = string; // 目标仓库的确定提交
type Brief = {
  ticket: string; slice_id: string; scenarios: string[]; base: Revision;
  title: string; goal: string; owns: string[]; writable: string[]; read_first: string[];
  check: string[]; expected: string; exclusions: string[];
};
type MissingDecision = { ticket: string; missing: { field: string; reason: string; owner: string }[] };
declare function prepare(ticket: Ticket, scenarios: Scenario[], base: Revision): Brief[] | MissingDecision;
```

`ticket + slice_id` 标识一次票内分片。`scenarios` 引用原场景，`owns` 表达父票分给本片的 T/R。各片的目标与期望合起来覆盖整票。`writable`、`read_first` 为目标仓库根的相对文件路径。`check` 是一条命令的参数数组，首项为程序，`expected` 写该命令要观察到的结果。技术负责人协调共享写入，派发同波独立文件。收到缺项后从原 owner 取得决定，再用原票号和场景准备合同。

```ts
type SliceEvidence = {
  ticket: string; slice_id: string; scenarios: string[]; base: Revision;
  commit: Revision | null; check: string[]; observed: string; gaps: string[];
};
type MmfPlan = {
  mmf: string; base: Revision; scenarios: Scenario[]; briefs: Brief[]; evidence: SliceEvidence[];
};
type MmfVerdict = {
  mmf: string; base: Revision; verdict: 'pass' | 'return';
  scenarios: { id: string; expected: string; observed: string; evidence: string[] }[];
  checks: string[]; gaps: string[];
};
declare function implement(input: Brief | MmfPlan): SliceEvidence | MmfVerdict;
```

开发者记录实际命令、观察结果和提交；没有提交时写 `null` 并说明缺口。技术负责人按原票核收每个必需片，在 `MmfPlan.base` 指定的集成提交上逐场景对账。`MmfVerdict.checks` 记录适用的 E2E、消融、全量检查与 Standards/Spec 审查的结果坐标。缺片、缺证或整合后丢失原结果时给出 `return` 和具体缺口。

[prepare 合同桩](../../delegate-ticket/scripts/prepare.js) 与 [implement 合同桩](../../implement/scripts/implement.js) 是 CommonJS 导出。A01 调用抛出 `ERR_NOT_IMPLEMENTED`。A03 承接正常 Skill 入口和执行行为。

## 运行共同样例

1. 从本仓根运行 `node skills/to-spec/scripts/check-spec.js skills/to-tickets/references/stop-turn/spec.md`。再运行 `node skills/to-tickets/scripts/check-tickets.js skills/to-tickets/references/stop-turn/spec.md skills/to-tickets/references/stop-turn/ticket.md`。预期 `ok`、第 1 波 `TURN-1`。旧输入回归入口为 `node --test skills/to-spec/tests/check-spec.test.js skills/to-tickets/tests/check-tickets.test.js`。
2. 将 [例子项目的公开入口](stop-turn/example/turn.js) 所在目录作为目标仓库根。`require('./skills/to-tickets/references/stop-turn/briefs.cjs')(base)` 从本仓读出三组样例，`base` 传入例子项目的实际提交。`single` 交给一个开发者，`split` 分给两个开发者，二者的票号和场景相同。`missingResult` 的两片都检查状态，交齐也缺 R1。运行 `node skills/to-tickets/references/stop-turn/verify-contract.cjs`，预期 `A01 contract fixture ok`。它检查正例覆盖、弱票差异、缺失覆盖和两个合同桩的显式红灯。
3. 在例子项目根分别运行 `node check.cjs status`、`node check.cjs results`。未实施时分别在 `running` 和空结果处报红。两个开发者可各自只改 `status.js` 或 `results.js` 并重跑本片命令。整票执行 `node check.cjs all`，同时观察停止与「第一段」。这些是样例项目的检查；真实实施回执填写实际基线、提交和命令结果。
