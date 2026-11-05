# code-review 以上游原版为基础，只加严重度

Status: superseded by repo://docs/adr/0008-review-round-limit.md（复审范围与上游差异；严重度与阻断线不变）

Related: supersedes repo://docs/adr/0002-owned-code-review.md；repo://skills/code-review/SKILL.md；repo://skills/sync-upstream-skills/references/adapted-sources.md

## Context

ADR-0002 按 2026-09-07 的需求，让 code-review 在 Codex runtime 固定审查模型（implementation `gpt-6-astra` low、whole-change `gpt-5.6-sol` xhigh），并加入 Luna 委派、模型 readback 与中断语义。

之后 delivery-pipeline 在用户级配置 `~/.config/delivery-pipeline/model-roles.json` 的 `review.<scope>.<axis>` 中保存两轴模型，并把它作为 `review_models` 传给 code-review（delivery-pipeline 仓 `skills/delivery-pipeline/references/model-role-routing.md` 的 review packet 段）。Skill 内的固定默认成为第二份模型配置，2026-11-04 读回时已与配置值不同。

审查也缺少严重度：`repo://skills/gh-merge-pr/SKILL.md` 与 delivery-pipeline 都以 blocker / blocking finding 判定通过，但没有 owner 定义什么算阻断，修复后的复审范围也没有边界。

2026-11-04 用户确认：code-review 回到上游原版的双轴结构；只有 P0/P1 阻断，P2 登记 issue，修复后只复审修复 diff。

## Decision

### 1. 以上游原版为基础

正文取 mattpocock/skills `skills/engineering/code-review`，commit `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`。本仓只增加三处：调用方证据包与 WIP 范围、P0–P3 严重度与两值 verdict、审查中断不算完成。来源登记在 adapted-sources.md，不进入快照锁定。

### 2. Skill 不约束模型

与上游一致，Skill 正文不提模型。delivery-pipeline 链路上，两轴模型来自 `delivery-pipeline-setup` 写入的 `review.<scope>.<axis>`，由 delivery-pipeline 的 packet 交给审查 worker；链路外沿用当前会话的默认子代理。

### 3. 只有 P0/P1 阻断

每条 finding 标 P0–P3；项目质量规范定义了级别时用项目定义。每轴 verdict 只取 `BLOCK` 与 `PASS`。P2 由调用方登记 issue，P3 只留在报告里。P0/P1 修复后，复审范围是修复 diff 及其影响到的行为；修复引入新行为、改动公开 Interface 或依赖时重新划定范围。

## Consequences

### 正面

- 与上游的差异集中在三处，对照上游更新的成本低。
- 模型只有 delivery-pipeline 配置一个来源，不再出现与配置不一致的第二份默认。
- 阻断线有唯一 owner，`gh-merge-pr`、delivery-pipeline 与 implement 不再各自解释 blocker。
- 修复后的复审有边界，不再审到没有 finding 为止。

### 负面 / 成本

- 去掉 Luna 委派、模型请求与 readback 记录。需要这类审计时由调用方记录。
- 不再随上游自动同步，更新按 adapted-sources.md 人工对照。

### 边界

- 本记录不改 delivery-pipeline 的证据预检、review scope 与模型配置。
- 阻断线或复审范围改变时，新建 ADR supersede 本记录。
