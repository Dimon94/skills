# 本仓任务统一由 Linear 管理

Status: accepted

Related: [DD-539](https://linear.app/erplus/issue/DD-539)、[DD-540](https://linear.app/erplus/issue/DD-540)

## Context

用户明确要求在 Dawn 团队建立 skills 项目，后续 Issue 统一使用 Linear。本仓原 tracker 指向 GitHub；沿用旧规则会使开发周期管理与需求、Spec 分散在两个平台。

## Decision

### 1. 任务 owner

本仓 Issue、Epic、Spec、PRD 与执行 ticket 由 Linear 唯一管理，具体坐标和操作约定归 repo://docs/agents/issue-tracker.md。GitHub 继续拥有代码与 PR。

### 2. 迁移范围

本次开发周期 Epic 从 GH-111 迁入 Linear，M1 Spec 直接在 Linear 发布。GH-111 保留历史并关闭为已迁移，留下目标链接；不批量迁移或关闭其他历史 Issue。

## Consequences

### 正面

任务关系与周期可在同一平台查询，消除跨平台的双份任务状态。

### 负面 / 成本

调用本仓 tracker 的开票、缺陷落账与依赖查询规则需同步更新。Linear 不可访问时明确报告阻塞，不另建 GitHub 镜像。

### 边界

GitHub 的合入事实仍是交付核对的证据来源。本决定不授权历史全量迁移、功能实现或改变现有自动调度；更换 tracker 时另立 ADR。
