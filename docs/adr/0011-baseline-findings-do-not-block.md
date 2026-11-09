# 基线已有的问题不阻断本次

Status: accepted

Related: 修订 repo://docs/adr/0008-review-round-limit.md 末段“不改严重度定义和阻断线”；repo://skills/code-review/SKILL.md；repo://skills/implement/SKILL.md；delivery-pipeline 仓 `docs/adr/0017-review-budget.md`

## Context

`code-review` 规定 P0/P1 阻断，但没区分问题是否由本次改动带来。审查者读 diff 时会读到周边旧代码；旧代码里的 P1 会让本次 `BLOCK`，占用三轮预算，并把实现者拉去改范围外的代码。

来源：pstack `skills/poteto-mode/playbooks/autopilot-full.md` 第 4 步（cursor/plugins@6b03002）：PR 的 base 已有的问题不阻断，除非 PR 复制了它或让它新被走到；其余进后续工作。2026-11-08 用户决定 pstack 原则与旧决定冲突时按 pstack 改。

证据边界：delivery-pipeline ADR-0017 记录的 DD-179 等多轮案例中，基线已有问题的占比 Unknown。本决定属推断性预防。

## Decision

### 1. 基线已有的 P0/P1 记为 P2

审查者在 fixed point 上核对同一问题。已存在时记 P2，标「基线已有，原级 P0/P1」，由调用方登记 issue，不阻断。

### 2. 复制或新触达按原级别

本次 diff 复制了该问题，或让新的调用方、入口走到它时，算本次引入，按原级别处理。

### 3. 核对不了按本次引入

审查者无法在 fixed point 上核对时，按本次引入处理（fail-close）。

被否决：新增“基线”严重度或单独计数。那样 verdict 规则、delivery-pipeline `review_gate.py` 与 `implement` 的 P2 处理都要加分支；记为 P2 后调用方不变。

## Consequences

### 正面

- 本次合入只为本次带来的风险负责，审查轮次不被旧问题消耗。
- 旧问题照样进入 issue，不丢。

### 负面 / 成本

- 旧的 P1 可能在 issue 积压里停留更久。
- 核对 fixed point 增加审查者的工作量；“新触达”的判断依赖审查者读调用链。

### 边界

不改 P0–P3 定义、三轮上限和 verdict 两值。调用方的计数与 gate 不变。
