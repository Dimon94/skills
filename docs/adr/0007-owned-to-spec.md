# to-spec 转为本仓自有 Skill

Status: accepted（§3 被 0016 修订：增加参与方）

Related: repo://skills/to-spec/SKILL.md；repo://docs/adr/0004-epic-spec-delivery-boundary.md；repo://docs/adr/0006-owned-tdd-implement.md

## Context

`~/.agents/skills/to-spec` 原本链接到 mattpocock/skills。上游模板没有表达业务状态流转的位置，也不要求 Module 设计遵循 `codebase-design`。用户确认：

- Spec 增加业务状态图，形式参考 pstack `statechart` 的读者视角。
- Spec 符合 `codebase-design`。
- `to-tickets` 不加约束。
- 不等真实 Spec 试跑结束，直接改造 `to-spec`。

## Decision

### 1. 接管运行时名称

Skill 放在 repo://skills/to-spec/，名称不变，经 repo://scripts/link-skills.sh 链入 agent 目录。repo://scripts/install-development-workflow.sh 不再把 `to-spec` 链到 mattpocock。来源登记在 repo://skills/sync-upstream-skills/references/adapted-sources.md，不进入快照锁定。

### 2. Business Flow 是条件章节

状态跨越步骤或时间留存，或包含失败重试、审批、取消、不可逆副作用时，Spec 带状态图、转移编号 T 和规则编号 R；其余情况写 `N/A` 和理由。强制每份 Spec 画图会产生装饰图，因此否决。

手写状态图用于暴露歧义和约定验收，不证明规则成立。涉及资金、并发、重复副作用或不可逆操作的规则，在 Testing Decisions 点名形式验证。pstack `statechart` 未引入本仓；形式验证复用已有 `create-formal-verification-skill`。

### 3. 完成标准留在 Spec 层

每个 T 和 R 都是 MR 验收项，并有唯一 owner Module。ADR 0004 规定一份 Spec 由一个 MR 完整验收，所以 `to-tickets` 不变。“每个 T 恰好归一张票”过严，一条转移可以先搭骨架、再补失败路径，因此否决。

## Consequences

### 正面

- 状态组合的缺口在写 Spec 时暴露。
- T、R、Module、测试和验收有共同编号，不需要另建台账。

### 负面 / 成本

- 上游 `to-spec` 的更新改为人工对照。
- 拆票遗漏要到 MR 验收才暴露。
- 行为效果未经真实 Spec 验证，见 repo://skills/to-spec/references/verification.md。

### 边界

- MR 验收反复发现拆票遗漏 T 或 R 时，再评估给 `to-tickets` 增加覆盖要求。
- 回退：把 symlink 指回 mattpocock 对应目录，恢复安装脚本中的 `to-spec`。
