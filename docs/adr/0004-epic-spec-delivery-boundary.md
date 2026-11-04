# Epic 按 Spec 划分交付边界

Status: accepted

Related: repo://skills/to-epic/SKILL.md

## Context

用户确认大需求采用 Epic → 多个 Spec → 各 Spec 内 tickets，一个 Spec 对应一个 MR。用户要求先验证最小完整路径，再按业务结果形成可并发候选，同时遵循 codebase-design；规划入口应独立可用。

原入口把史诗寻路、决策票、多张 Wayfinder 地图及全局就绪门槛集中在同一 Skill，与本次选择的交付层级不同。内容来源保存在 repo://skills/sync-upstream-skills/references/adapted-sources.md。

## Decision

### 1. 以 Spec 划分交付，以 ticket 划分执行

`to-epic` 拥有整体目标、Spec 候选、顺序和依赖。当前候选交给 `to-spec` 细化，内部实施工作交给 `to-tickets`。一份 Spec 的目标由一个 MR 完整验收；不因内部票数增加而扩大 MR 的交付范围。

首片选择核心、小、能验证关键未知的完整路径。远期候选保留目标、依赖与未知，临近执行再细化；不要求为整个 Epic 预先确定全部实现。

### 2. 拆分同时满足深 Module 设计与真实依赖

拆分读取 `codebase-design`，当前及准备并发的候选明确相关 Module、共享状态 owner 和 Interface。Spec 与 Module 不要求一一对应。共享 Interface 对齐后可以并发推进 Implementation；真实能力仍约束验收交付。

只等待会影响当前承诺的能力或关键反馈。普通文件重叠作为冲突风险处理，业务不变量与真实顺序决定阻塞。

### 3. 独立规划并按批准范围滚动更新

入口采用显式调用，产品源码保持只读。目标项目的 tracker 和权限决定保存方式；未配置或未获发布授权时交付草稿。规划产物可由不同执行方消费，不依赖特定调度器、worker 或 worktree。

获批范围内自主细化未开工候选并更新依赖；改变批准结果、验收或关键业务语义等真实取舍再交用户决定。实现、MR、CodeReview 和部署由下游负责。

### 4. 替换原入口

本仓只保留 `skills/to-epic/` 作为该规划入口的 Canonical source。原入口与专用寻路 references 退出，运行时名称更新为 `to-epic`，不保留旧名称的别名或并行合同。既有远程 Epic 通过其正文、评论与 Spec 链接续接，不自动迁移或关闭远程条目。

## Consequences

### 正面

规划结果直接表达可交付的 Spec，首片和后续并发有可核对的依据；批准结果在滚动细化中保留去向。

### 负面 / 成本

未知可能使后续候选重切，执行方需要核对实际交接合同。读取格式和安装成功不能证明真实 Epic 的拆分有效，行为验证入口见 repo://skills/to-epic/references/verification.md。

### 边界

本决定约束 `to-epic` 的规划合同，不修改第三方 `to-spec`、`to-tickets`、独立的 `vertical-slicing` 或执行器合同，也不据此声称它们已经兼容新交付层级。后续改动沿各自 owner 和授权执行。
