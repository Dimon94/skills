---
name: delivery-cycle
description: 手动维护一个 Linear 团队／项目的本周工作集合：核对上海时区单周 Cycle，按真实 MMF 身份纳入进行中的父 Spec Issue 与 ticket，按正式交付决定跨周结转，逐项前读、最小 cycle 写入并回读。用于用户要求维护本周 Cycle、同步本周工作集合或判断正式交付时。
---

# delivery-cycle

本 Skill 是周期维护规则与正式交付判断的唯一 owner。M2 自动调用、M3 周报和其他入口只调用同一个脚本，不复制判断。

## 何时调用

用户明确要求对一个团队／项目维护本周集合时调用。没有明确的 `teamId`、`projectId` 和专用排除标签 ID 时，先问用户，不猜。

## 入口

```js
import { assessFormalDelivery, maintainCurrentWeek } from './scripts/delivery-cycle.js';

const result = await maintainCurrentWeek(
  { scope: { teamId, projectId, exclusionLabelId }, exclude: [], restore: [] },
  { linear, evidence, now: () => new Date() }
);
```

`linear` 与 `evidence` 是 Adapter，合同写在 [scripts/delivery-cycle.js](scripts/delivery-cycle.js) 的 L5 块。现有 Linear MCP 读不到完整周期配置，也没有回读过的写入能力。缺这些能力时，Adapter 必须抛出 `capability_unavailable` 或返回 `'unknown'`，不能拿基本 team 字段补齐。

## 维护规则

1. 本周是 Asia/Shanghai 周一 00:00 起的左闭右开 7 天。团队配置必须是：启用 Cycle、上海时区、一周、周一开始、无 cooldown。目标 Cycle 边界必须与本周完全一致。双周不截半。
2. 前置不满足时零写入，整体 `unsynchronized`，并给出稳定 code：`configuration_mismatch`、`configuration_unverifiable`、`cycle_missing`、`permission_denied`、`capability_unavailable`。
3. 完整分页读取 Issue。带原 Spec 引用的是 MMF 父项，它的直接子项是 ticket。Epic 不进 Cycle。进行中但身份断裂的项报 `identity_unverifiable`，范围外的项报 `scope_invalid`，两者都不写。
4. 父项进行中，或任一 ticket 进行中时，纳入父项和进行中的 ticket。父项保持原状态，未开始的兄弟票不纳入，没有进行中关联的 Backlog 也不纳入。
   上一周期 Cycle 里的 MMF 父项（含已完成）也参与结转判断，随它处理的只有仍需工作的 ticket。见下文「跨周结转」。
5. 每项写入前重算当周并重读 Issue。已在目标 Cycle 的项不写。跨过周一就报 `cycle_expired`，并停止旧周的后续写入。
6. patch 只含 `cycle`。写入后回读业务字段，结论只看回读：
   - 回读符合目标记 `verified`，即使响应超时或带 GraphQL errors。
   - 响应超时、为空或形状不明，或回读为空、出错、缺 `cycleId`，记 `write_unknown`。
   - 响应声称成功但回读不符，记 `readback_mismatch`。
   - 响应带 GraphQL errors 或 `success: false` 且回读不符，记 `write_failed`。
   - 写入被拒绝记 `permission_denied`。
7. 整体状态：全部符合为 `synchronized`；至少一项符合（含原本无需变更项）但仍有失败或未知为 `partial`；没有符合项且有无法判定项为 `unknown`；其余为 `unsynchronized`。`changed` 只统计回读确认的变更。
8. 重试就是再调用一次。每次都重新核对并前读：上次 Unknown 但实际已生效的项记 `unchanged`，不重放；`partial` 后只写仍不符合的项。已 `verified` 的项不回滚。

## 正式交付

`assessFormalDelivery({spec, main})` 是唯一公式。两项都是 `verified` 时为 `delivered`；任一为 `not_met` 时为 `not_delivered`；其余为 `unknown`。`effectiveAt` 只在已交付且两个事件时间都存在时取较晚值，否则为 `null`。证据不足时保持 Unknown，并附 `evidence_unavailable`。

工作流状态、Integration、HTTP 200、口头声称和提交时间都不替代这两项证据。维护入口对每个 MMF 只读一次父项证据，经同一公式判断；ticket 沿用父项结论，不单独判断。

## 跨周结转

按父项的正式交付结论决定整个 MMF 的归属：

| 交付结论 | 归属 | action |
| --- | --- | --- |
| `not_delivered` 或 `unknown` | 移入本周 Cycle | 原在上一周期为 `carry`，其余为 `include` |
| `delivered`，`effectiveAt` 在本周开始之后（含周一 00:30） | 保留或移入本周 | 同上 |
| `delivered`，`effectiveAt` 早于本周开始 | 不得在本周：在本周的改为 `cycle=null` 并回读；旧周归属不动 | `not_carry` |
| `delivered`，`effectiveAt = null` | 保持原归属，不写，报 `delivery_time_unverifiable` | `unchanged`，`write: unknown` |

父项 Done 但未交付，或 Started 但已交付，附加 `workflow_drift` 交原 owner 核对。归属仍按上表，不改任何状态。已完成的 ticket 不复制、不重开、不移动；未来 Cycle 和更早 Cycle 的项不处理。

## 当前未实现

- `exclude` 与 `restore`：非空时整次返回 `capability_unavailable`，零写入。
- 原生自动归属冲突。

## 不做

不改团队配置，不创建 Cycle 或标签，不改工作流状态和其他字段，不归档、关闭或重开 Issue，不 push、merge 或部署。同步结果不作为开发、派发、预算或恢复的 gate。
