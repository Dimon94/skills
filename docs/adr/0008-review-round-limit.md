# Review 最多三轮，只报具体反例

Status: accepted（末段“不改阻断线”被 0011 修订）

Related: supersedes repo://docs/adr/0005-code-review-upstream-severity.md 的复审范围与上游差异；repo://skills/code-review/SKILL.md；repo://skills/implement/SKILL.md；delivery-pipeline 仓 `docs/adr/0017-review-budget.md`

## Context

ADR-0005 之后，Review 仍然过度。最近 30 天 2673 条审查会话去重后约 344 条 P0/P1，最大的三类是合同未兑现、时序或身份代次、入口或调用方遗漏（关键词粗分）。这些问题多数本该在实现阶段拦住：`implement` 先审查后对账，验收不枚举失败方式，也不要求列调用方。

2026-11-05 用户决定：Review 最多三轮，三轮后结束；R3 后仍有 P0/P1 视为实现链路故障，触发 retro。用户认为抽象的对抗性审查价值很低，agent 容易陷入挑刺和 YAGNI，token 更应投给实证验证和形式化验证。形式化方法也有边界：它只证明实现符合模型里的规则，规则是否符合意图由人判断。

## Decision

1. `code-review` 同一 scope 最多三轮：R1 找全 P0/P1，R2、R3 只看修复。没有 P0/P1 就结束，scope 终结后的改动不再开轮（delivery-pipeline DD-291 曾在 R1 PASS 后续开 R2、R3）。
2. 删除 Fowler 坏味道基线。finding 必须有触发场景、可观察影响和能走通的反例。
3. `implement` 从 spec 逐条拆验收，列失败方式和入口清单，对账移到审查之前。
4. 验证分层：约束和类型、测试和真实运行、需要时的形式验证。模型检查的路径要在真实代码上复现。
5. R3 后仍有 P0/P1：不提交成功结论，不开第 4 轮，运行 `retro` 复盘实现链路。

本记录取代 repo://docs/proposals/2026-11-04-development-workflow-optimization.md 中“固定轮次不作为判据”的取舍：上限不是自动通过，到顶后仍不放行。

## Consequences

- 与上游的差异变大，对照上游更新的成本上升。
- 结构性问题不再由 Review 兜底，需要架构规范和专项 Review 在明确触发时处理。
- 部分真实缺陷会以 P2 进入 Issue 积压，分级准确度成为主要风险。

本记录不改严重度定义和阻断线。预算记账与 gate 由 delivery-pipeline 拥有。
