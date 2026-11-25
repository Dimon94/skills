---
name: to-spec
description: "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed."
disable-model-invocation: true
---

This skill takes the current conversation context and codebase understanding and produces a spec. Do NOT interview the user; just synthesize what you already know.

The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the spec, and respect any ADRs in the area you're touching. 按运行时目录定位并完整读取 `codebase-design/SKILL.md`，Module、Interface、Seam 等词按它的定义使用。依赖缺失时点名路径和受影响决定，把 Spec 标为未就绪。MMF 来自 Epic 时，按 Epic Issue 链接与 MMF 标识读回已确认范围、决定、`Blocked by` 和下游候选，写进 Spec。先查同一标识的已发布 Spec；已有坐标就复用。新建 Epic 下的 Spec 由持有 Epic claim 的交付 coordinator 派发唯一工作项。用户直接给 Epic 和 MMF 时，从该 Epic 的交付入口接续，复用同一认领与依赖 gate。

2. 判定 MMF。Spec 描述一个 MMF：验收、合入与上线的单位，对应一个 MR。用两个问题判定需求：切成两半，存在一种切法让每半都能单独上线且单独有人用吗；整体单独上线有人用吗。结果取其一：
   - 切得开 → 多个 MMF：停下，以 `NEXT: to-epic <理由>` 交回调用方（独立调用时请用户运行 `/to-epic`），列出已识别的 MMF 候选及各自的用户结果。
   - 切不开，且整体单独上线有人用 → 正好一个 MMF：继续。
   - 整体单独上线没人用 → 不足一个 MMF：停下，以 `NEXT: blocked-human <理由>` 交回调用方，说明它是某个 MMF 里的 ticket，点名所属 MMF；不知道写 Unknown。
   完成条件：结果是三者之一，两个问题各有答案和依据。

3. 判定 Business Flow。行为的状态跨越步骤或时间留存，或者包含失败重试、审批、取消、不可逆副作用时，按模板画状态图；其余情况在该节写 `N/A` 和一句理由。完成条件：该节是一张图加规则，或一条 `N/A` 理由。

4. 按 [bdd](../bdd/SKILL.md) 把业务决定写成有独立来源的 Given / When / Then 场景。覆盖每条 T/R，也覆盖已决定的失败、重试和跨步骤不变量。同一场景可同时覆盖转移与规则。在能观察全部结果的公开 Seam 上选检查，写出复用、补强或待裁决的理由。

优先复用 Issue 中仍适用的测试决定。调用方传入 `planning_mode: auto` 时，从独立业务预期和公开入口选择能观察完整结果的 Seam，记录选择、理由和证据坐标后继续。业务预期无独立来源、互相矛盾或需要改变时，才以 `NEXT: blocked-human <待决定事项>` 交回。独立调用或沿原人工计划审核合同时，缺少适用确认先取得用户确认。

5. 定形状：要新建或修改 Module 时，运行 `architect`，把选定形状的签名和状态归属写进 Implementation Decisions。完成条件：Business Flow 的每个状态都能用一行答出 owner Module。

6. Write the spec using the template below. 发布前逐项核对：每个 T、R 和 Business Flow 状态都有唯一 owner Module，T 和 R 也都出现在 Testing Decisions；每个新建或修改的 Module 都用代码写了 Interface，也写了 Seam，跨 Module 的 R 都列了参与方，命中分支链或同步标志位的写明数据形状决定。有缺口先补，补不上的写 Unknown 并点名影响。将草稿正文经 stdin 传给本 Skill 的 `node scripts/check-spec.js --require-scenarios`。脚本检查九个章节、Dependencies 节的 `Blocked by:` 与 `Blocks:` 行、T/R 与状态的唯一 owner 行（`Owns:` 开头）、场景表列、唯一 id、covers 对每条 T/R 的覆盖、未定义编号和正文文件路径；输出 `ok` 才发布，报错逐条改完再跑。正文直接发布到 Spec Issue，应用 `ready-for-agent` 标签。来自 Epic 的 Spec 创建时就在 Dependencies 节写 `Epic: <URL>` 与 `MMF: <标识>`，并在同一次创建里把 tracker 原生父项设为该 Epic；正文链接只生成 related，不算父子关系，父项不留给 coordinator 事后补。读回正文、原生父项、身份字段与已知 Map 链接，把读回正文经 stdin 传给 `node scripts/check-spec.js --parent <读回父项>`（父项为空传 `''`），输出 `ok` 才算发布完成；报 `parent` 时补父项后重新读回。Epic 下的 Spec 由其已获认领的 lane 在重读关联后创建。把发布坐标和待连关系交回 coordinator，由它汇总写回 Epic 正文与跨 Spec 关系。未发布对方的依赖留在正文；依赖类型与解除时点按 Epic 的决定。

审阅历史 Spec 时，沿用 `node scripts/check-spec.js` 读取；准备新票前，把缺少的场景或独立预期交回需求作者。

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## Business Flow

The states the feature moves through and the rules that must always hold, in the reader's words. Write `N/A` and one reason when step 3 finds no business state.

<business-flow-example>

```mermaid
stateDiagram-v2
  state "待支付" as unpaid
  state "已支付" as paid
  state "已退款" as refunded
  [*] --> unpaid
  unpaid --> paid: T1 支付成功
  paid --> refunded: T2 退款完成
```

- R1：同一笔订单只能退款一次

未列出的转移一律禁止。每个 T 和 R 都是这个 MMF 的 MR 验收项。

</business-flow-example>

- 状态和箭头用读者能看到或在意的业务词，代码名和变量名留给 Implementation Decisions。
- 箭头写成 `T<n> 事件 [条件]`，失败、取消和重试也各占一条箭头。规则写成 `R<n>`，表达必须一直成立的事。
- 状态和转移只在本节定义，User Stories 负责说明为什么需要这些行为。
- 箭头控制在约 20 条。超出时先合并读者不区分的状态；仍读不清，说明它不止一个 MMF：停下，以 `NEXT: to-epic <理由>` 交回调用方重切 MMF（独立调用时请用户运行 `/to-epic`）。

## User Stories

只列能解释本 MMF 用户动机的故事。每条编号，供 ticket 引用。

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

转移、重试和不变量留在 Business Flow，具体例子放入 Testing Decisions。

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Use `codebase-design` terms. For each Module built or modified, state:

- Which T, R and Business Flow states it owns, on one `Owns:` line (omit when Business Flow is `N/A`). 状态用图里的 id。 一条 R 要靠多个 Module 共同守住时，在 owner 下写 `Participants:`，列出其余 Module；每个参与方在相关签名的 `Ensures:` 里回引 R 编号
- Its Interface, written as code：用目标项目的语言写类型和函数签名，函数体留空。选错会破坏 T、R 或调用方的签名，在下面加 `Ensures:`，列返回承诺、错误模式和顺序约束；其余签名只留一行说明
- Its Seam: reuse an existing one first; justify a new one by the Adapter rule in `codebase-design`
- For a new Module, the result of the deletion test
- Its data shape decision, when the requirement would add one more branch to an existing if/else or switch chain, or a second flag that must stay in sync with an existing one: read `principle-model-the-domain` and `principle-redesign-from-first-principles` in full from the runtime skill directory, then record the changed shape or why the branch stays

Interface 代码只写控制实现所需的决定，写短。

Do NOT include specific file paths. They may end up being outdated very quickly.

If a prototype produced a snippet that encodes a decision more precisely than a signature can (state machine, reducer, schema), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Testing Decisions

按[场景表与停止回合实例](../to-tickets/references/delivery-contract.md)写出每个场景。沿用列 `id | covers | given | when | then | source | seam`。用 S1、S2 等稳定标识；`covers` 写 Business Flow 的 T/R，Business Flow 为 `N/A` 时可写 `N/A`。`then` 写清全部可观察结果及相关 Interface 的 Ensures。`source` 定位独立预期，`seam` 点名公开操作与读回入口。

在表后写场景对应的检查和选择理由。逐项核对它能看见每个结果、拒绝违反不变量的实现。
- For any R involving money, concurrency, duplicated side effects or irreversible steps: the project's `formal-verify-*` skill that checks it, or the need to generate one with `create-formal-verification-skill`
- 项目有 `verify-*` 时，每个 T 写由哪条 journey 端到端检查

## Dependencies

本 MMF 与其他 MMF 或外部前提之间的阻塞边。来自 Epic 时先写 `Epic: <URL>` 和 `MMF: <标识>`，再记录 Epic 中相关的依赖与解除证据。独立 MMF 写 `无` 和一句依据。

- `Repo:` 本 MMF 代码落在哪个 Git 仓库，写仓库目录名（如 `tiktok-ad-automation`）。派发方据此判断要不要跨仓路由。一个 MMF 的代码跨两个仓库时，停下，以 `NEXT: to-epic <理由>` 交回调用方按仓库拆开（独立调用时请用户运行 `/to-epic`）。
- `Blocked by:` 每条写前提（MMF 或 Spec 链接、外部能力）、类型、依赖的 Interface、能力或反馈、解除证据。类型取 **开工**（前提交付前不能开工）或 **上线**（Interface 已对齐，可并发开发，验收与上线等前提就绪）。
- `Blocks:` 依赖本 MMF 的 MMF 及其消费的 Interface。改这些 Interface 前先协调对方。

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>
