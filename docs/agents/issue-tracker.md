# Issue tracker

本仓的 Issue、Epic、Spec、PRD 与执行 ticket 统一归 Linear：

- Workspace：`erplus`。
- Team：`Dawn`（`DD`）。
- Project：[skills（P-DD-11）](https://linear.app/erplus/project/skills-1e11dea56aec)。
- Project UUID：`d67cdf20-2212-48e3-84f4-5dc6e3b978fe`。

代码与 PR 保留在 [Dimon94/skills](https://github.com/Dimon94/skills)。历史 GitHub Issue 保留原始记录；后续任务在本 Linear 项目管理，不维护双份可变任务状态。

## 约定

- **建 Issue**：通过 Linear MCP 创建，固定 `team = Dawn`、`project = P-DD-11`。Epic 为父 Issue，MMF 的 Spec 为其子 Issue，执行 ticket 归对应 Spec。原 Issue 可直接补成 Spec，避免重复开单。
- **读 Issue**：按完整 `DD-<number>` 或 Linear URL 获取，读取描述、状态、标签、父子关系、依赖与相关评论。
- **列 Issue**：按 `project = P-DD-11` 过滤，再按状态或标签收窄；不能只按 Dawn 列出其他个人项目的任务。
- **评论／关闭／打标**：使用 Linear 的评论、状态及增量标签操作；完成后读回实际字段。已取消与已完成分别表达，不把 Canceled 当作正式交付。
- **triage 标签**：五个 canonical 角色与本仓 label 的映射见 repo://docs/agents/triage-labels.md。
- 所有远程写操作只在获得明确授权后执行。调试闭环（repo://docs/agents/debugging.md 第 8 节）与 wayfinding 认领所需的建单和打标视为已批准；批量建票仍需明确授权。

## 当 skill 说 "publish to the issue tracker"

在上述 Linear 项目创建或更新 Issue，读回正文与关系，再返回完整标识和 URL。Spec 运行前置未满足时明确列出 Unknown，保持未就绪；不能仅因正文已发布就标 `ready-for-agent`。

## 当 skill 说 "fetch the relevant ticket"

按完整 `DD-<number>` 获取 Linear Issue，并读取父 Spec 与实际依赖。历史 GitHub 编号写成 `GH-<number>`，仅在明确查询历史原件时使用 `gh issue view`；新任务不用裸 `#<number>`，避免与 PR 混淆。

## 阻断与依赖

使用 Linear 原生 `blocks`／`blockedBy` 关系表达依赖；正文可补充解除条件，不另维护一套依赖清单。判断依赖是否解除时，回读被依赖 Issue 的真实完成状态及要求的交付证据。被取消不自动代表已满足依赖，须明确撤销或调整该依赖。

## Wayfinding 编排

/wayfinder 地图与 ticket 在 issue tracker 的表达约定：

- **map（地图）**：一个 Issue，label `wayfinder:map`。
- **子 ticket**：普通 Issue，`parentId` 指向 map；label `wayfinder:map-DD-<number>` 标识所属 map，另加 `wayfinder:research|prototype|grilling|task`。正文首行写 `Map: DD-<number>`。
- **查某图的 frontier**：限定本项目、父 map 与未完成状态，排除 `wayfinder:claimed` 和尚未解除的原生阻断关系。
- **认领与完成**：开工前加 `wayfinder:claimed`；完成后在 resolution comment 写结论、转完成状态，并在 map 的 Decisions-so-far 追加索引。
- 动态归属标签随 map 创建；静态标签首次使用前核对，缺少时通过 Linear 标签能力创建并回读。

## 程序化访问（API）

优先使用官方 Linear MCP。MCP 缺少所需能力时，使用已授权的 Linear GraphQL 通道；缺权限则明确报告，不静默改写 GitHub Issue。不维护本仓平台封装脚本。GitHub 代码与 PR 操作继续使用 `gh` CLI。
