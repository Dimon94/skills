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
type Decision = { field: string; reason: string; owner: string };
type MissingDecision = { ticket: string; missing: Decision[] };
type Site = {
  slices: Omit<Brief, 'ticket' | 'base'>[];
  decisions?: Decision[];
  dependencies?: { ticket: string; commit: Revision }[];
};
declare function prepare(ticket: Ticket, scenarios: Scenario[], base: Revision, site?: Site): Brief[] | MissingDecision;
```

`delegate-ticket` 负责语义对账、查先例和填写 `site`。`prepare` 从原票解析 `Blocked by`。`None` 或 `无` 可直接准备。已命名的前置票由负责人读回其完成证据，把票号和已落地的交付提交放入 `site.dependencies`；脚本逐票核实提交在 `base` 的历史里。`Unknown（原因）`、缺依赖证据或缺现场草案均返回原票号的 `MissingDecision`。

`ticket + slice_id` 标识一次票内分片。`scenarios` 引用原场景，`owns` 表达父票分给本片的 T/R。各片的目标与期望合起来覆盖整票。`writable`、`read_first` 为目标仓库根的相对文件路径。`check` 是一条命令的参数数组，首项为程序，`expected` 写该命令要观察到的结果。技术负责人协调共享写入，派发同波独立文件。收到缺项后从原 owner 取得决定，再用原票号和场景准备合同。

```ts
type SliceEvidence = {
  ticket: string; slice_id: string; scenarios: string[]; base: Revision;
  commit: Revision | null; check: string[]; observed: string; gaps: string[];
};
type Run = { base: Revision; check: string[]; ok: boolean; observed: string };
type SliceRecord = { run?: Run; gaps?: string[] };
type ScenarioCheck = { id: string; seam: string; expected: string; covers: string[]; check: string[] };
type MmfPlan = {
  mmf: string; base: Revision; scenarios: Scenario[]; scenarioChecks: ScenarioCheck[];
  briefs: Brief[]; evidence: SliceEvidence[];
};
type Gate = {
  name: 'E2E' | 'ablation' | 'full' | 'Standards' | 'Spec';
  base: Revision; status: string; detail: string;
};
type MmfRecord = { observations?: (Run & { id: string })[]; gates?: Gate[]; gaps?: string[] };
type MmfVerdict = {
  mmf: string; base: Revision; verdict: 'pass' | 'return';
  scenarios: { id: string; expected: string; observed: string; evidence: string[] }[];
  checks: string[]; gaps: string[];
};
declare function implement(input: Brief, record?: SliceRecord): SliceEvidence;
declare function implement(input: MmfPlan, record?: MmfRecord): MmfVerdict;
```

技术负责人在取得观察前逐个核准 `scenarioChecks`。每项从原场景绑定 `id`、`seam`、`then`（存为 `expected`）及完整 `covers`，选择在该入口断言全部结果的命令。S1 用 `['node', 'check.cjs', 'all']` 检查停止状态和第一段读回。独立实施整个 MMF 时，`briefs` 和 `evidence` 均为空数组，同样需要完整场景检查。

开发者执行获准命令，填写 `run`。其中 `base` 是运行时的 HEAD。片级回执中的 `base` 是派发基线，`commit` 是交付提交。技术负责人先核对每片已落入 `MmfPlan.base`。快进与合并核对祖先关系；改写提交须在集成历史中逐个找到等价补丁，核对文件路径、模式和前后内容。证据不足则退回该片。随后在干净的集成提交上运行获准的场景命令，记录真实输出和退出结果。每项门禁提交实际回执 `pass`，仅 E2E、消融允许用 `n/a` 并在 `detail` 说明依据。缺片、缺证或集成后丢失原结果均给出 `return` 和具体缺口。

[prepare](../../delegate-ticket/scripts/prepare.js) 与 [implement](../../implement/scripts/implement.js) 既导出同名 CommonJS 函数，也支持在目标仓库根运行 Node CLI。Skill 负责取得现场、运行检查、读回实际结果；两个脚本只核收传入的合同与回执、只读核对 Git。CLI 从标准输入读取一个 JSON 对象，向标准输出写结果 JSON。通过退出 0，缺项退出 1。

| CLI | 标准输入 | 输出 |
| --- | --- | --- |
| `node <delegate-ticket>/scripts/prepare.js` | `{ticket, scenarios, base, site}` | `Brief[]` 或 `MissingDecision` |
| `node <implement>/scripts/implement.js` | `{input: brief, record: {run, gaps}}` | `SliceEvidence` |
| `node <implement>/scripts/implement.js` | `{input: plan, record: {observations, gates, gaps}}` | `MmfVerdict` |

## 运行共同样例

1. 从本仓根运行 `node skills/to-spec/scripts/check-spec.js skills/to-tickets/references/stop-turn/spec.md`。再运行 `node skills/to-tickets/scripts/check-tickets.js skills/to-tickets/references/stop-turn/spec.md skills/to-tickets/references/stop-turn/ticket.md`。预期 `ok`、第 1 波 `TURN-1`。旧输入回归入口为 `node --test skills/to-spec/tests/check-spec.test.js skills/to-tickets/tests/check-tickets.test.js`。
2. 将 [例子项目的公开入口](stop-turn/example/turn.js) 所在目录作为目标仓库根。`require('./skills/to-tickets/references/stop-turn/briefs.cjs')()` 从本仓读出三组 `site.slices` 草案。用例子项目的实际提交调用 `prepare(ticket, scenarios, base, {slices})`。`single` 产出一份合同，`split` 产出两份，票号与场景相同。`missingResult` 的两片都检查状态，交齐也缺 R1。运行 `node skills/to-tickets/references/stop-turn/verify-contract.cjs`，预期输出包含 `TURN-1 / S1 ok`。它以真实 Git 和子进程验证片级交付与同 Seam 的场景观察。弱票案例传入人工对账指出的遗漏，验证缺项回传。门禁与双轴审查使用模拟回执。
3. 在例子项目根分别运行 `node check.cjs status`、`node check.cjs results`。未实施时分别在 `running` 和空结果处报红。两个开发者可各自只改 `status.js` 或 `results.js` 并重跑本片命令。整票执行 `node check.cjs all`，同时观察停止与「第一段」。这些是样例项目的检查；真实实施回执填写实际基线、提交和命令结果。
