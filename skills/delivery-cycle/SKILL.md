---
name: delivery-cycle
description: 手动维护一个 Linear 团队／项目的本周工作集合：核对上海时区单周 Cycle，按真实 MMF 身份纳入进行中的父 Spec Issue 与 ticket，按正式交付决定跨周结转，用专用标签持久剔除与恢复，逐项前读、最小增量写入并回读。用于用户要求维护本周 Cycle、同步本周工作集合、剔除或恢复工作项，或判断正式交付时。
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

`linear` 与 `evidence` 是 Adapter，合同写在 [scripts/delivery-cycle.js](scripts/delivery-cycle.js) 的 L5 块。现有 Linear MCP 读不到完整周期配置，也没有回读过的写入能力。缺这些能力时，Adapter 必须抛出 `capability_unavailable` 或返回 `'unknown'`，不能拿基本 team 字段补齐。`readIssue` 必须返回 `{id, teamId, projectId, statusType, labels, parentId, cycleId, specRef}`；其中 `teamId`、`projectId`、`specRef` 是对 Spec §3 形状的扩展，缺 `teamId`／`projectId` 的项按 `scope_invalid` 处理，零写入。

## 维护规则

1. 本周是 Asia/Shanghai 周一 00:00 起的左闭右开 7 天。团队配置必须是：启用 Cycle、上海时区、一周、周一开始、无 cooldown。目标 Cycle 边界必须与本周完全一致。双周不截半。
2. 前置不满足时零写入，整体 `unsynchronized`，并给出稳定 code：`configuration_mismatch`、`configuration_unverifiable`、`cycle_missing`、`exclusion_marker_missing`、`permission_denied`、`capability_unavailable`。排除标签读不到或不属于本团队时报 `exclusion_marker_missing`，不用本地列表替代。
3. 完整分页读取 Issue。带原 Spec 引用的是 MMF 父项，它的直接子项是 ticket。Epic 不进 Cycle。进行中但身份断裂的项报 `identity_unverifiable`，范围外的项报 `scope_invalid`，两者都不写。
4. 父项进行中，或任一 ticket 进行中时，纳入父项和进行中的 ticket。父项保持原状态，本周新建的未开始兄弟票不纳入，没有进行中关联的 Backlog 也不纳入。本周 Cycle 里未开始的 ticket 不是纳入父项的理由。
   MMF 是否相关只看三项：父项进行中或停在上一周期且未完成；父项在上一周期或本周 Cycle（含已完成，参与结转判断）；存在进行中、且不在未来 Cycle 的 ticket。上一周期未完成的 ticket（含未开始的）只在 MMF 已相关时随行结转；它自己不让 MMF 相关。MMF 不相关时，这类 ticket 记 `unchanged`／`unchanged`，不写、不报问题。见下文「跨周结转」。
   已在未来 Cycle（开始时间不早于本周结束，含下周和更远）的项视为他人排期：先于纳入判断滤出，记 `unchanged`／`unchanged`，不写、不移回本周，也不把父项拉进本周。这类只观察的项在整体状态里不算符合项（见规则 7）。父项在未来 Cycle 而 ticket 已纳入本周时，父项附加 `workflow_drift`，交原 owner 核对。
5. 每项写入前重算当周并重读 Issue，回读后再核对一次。已在目标 Cycle 的项不写。
   - 前读时项已离开授权团队或项目，报 `scope_invalid`；父子关系或 Spec 引用与计划时不同，报 `identity_unverifiable`。该项不写，其余继续。
   - 真正写入前再分页重读 Cycle：本周 Cycle 边界不再等于本周，报 `configuration_mismatch`；本周 Cycle 消失，报 `cycle_missing`。两者都停止后续写入。重读后按新的 Cycle 列表重判当前项的前读值。
   - `cycle_expired` 有两类触发：上海时钟已跨过周一 00:00；或计划时在本周 Cycle 的项，在前读、写前重读或回读时已在紧接的下一 Cycle。Linear 原生滚动与他人周中手动移动无法区分，两者都保守停止。该项记 `failed`，停止旧周的全部后续写入。
   - 计划时不在本周 Cycle、前读才发现已在未来 Cycle 的纳入目标视为他人排期：该项记 `unchanged`，不报失败，其余继续。
   - 停止后续写入时，当前项与全部未处理项都列入 `items`（`unchanged`／`failed`），只报一条阻断。
   已观察到新周归属的项绝不回移旧周。下一次调用按新周重新核对和计划。没有 CAS，前读之后、写入之前的漂移只能由回读发现并报告，不能根除。
6. patch 只含 `cycle` 与专用排除标签的增减（`addLabels`／`removeLabels`），其他标签与字段不提交。写入后回读 `cycleId` 与 `labels`，结论只看回读：
   - 回读符合目标记 `verified`，即使响应超时或带 GraphQL errors。
   - 响应超时、为空或形状不明，或回读为空、出错、缺 `cycleId`，记 `write_unknown`。
   - 响应声称成功但回读不符，记 `readback_mismatch`。
   - 响应带 GraphQL errors 或 `success: false` 且回读不符，记 `write_failed`。
   - 响应声称成功的剔除，回读标签已加、但仍在本周 Cycle，记 `native_assignment_conflict`；平台明确拒绝的剔除按上一条记 `write_failed`。
   - 写入抛出 `permission_denied` 或 `capability_unavailable` 是确定失败，原样上报，该项 `failed`，不记 `write_unknown`。
7. 整体状态只看有写入目标的项；只观察的项（未来 Cycle 的项、不相关 MMF 的上一周期 ticket、未清出的本周 ticket）列在 `items` 里，但不算符合项。全部符合为 `synchronized`；至少一项符合（含原本无需变更项）但仍有失败或未知为 `partial`；未被阻断、没有符合项且有无法判定项为 `unknown`；其余为 `unsynchronized`。被阻断时没有符合项一律 `unsynchronized`。`changed` 只统计回读确认的变更。运行中途才阻断（如写前重读 `cycle_missing`）且已有符合项时为 `partial`，因为之前的写入已真实落地；入口即阻断为 `unsynchronized`。
8. 重试就是再调用一次。每次都重新核对并前读：上次 Unknown 但实际已生效的项记 `unchanged`，不重放；`partial` 后只写仍不符合的项。已 `verified` 的项不回滚。

## 正式交付

`assessFormalDelivery({spec, main})` 是唯一公式。两项都是 `verified` 时为 `delivered`；任一为 `not_met` 时为 `not_delivered`；其余为 `unknown`。`effectiveAt` 只在已交付且两个事件时间都存在时取较晚值，否则为 `null`。事件时间必须是带时区的 ISO 8601 字符串，日期必须真实存在（`2026-02-30` 不算），其余形状按缺失处理。证据不足时保持 Unknown，并附 `evidence_unavailable`。证据形状不合法，或 `verified`／`not_met` 缺 `source`，该条件按 `unknown` 处理。

工作流状态、Integration、HTTP 200、口头声称和提交时间都不替代这两项证据。维护入口对每个 MMF 只读一次父项证据，经同一公式判断；ticket 沿用父项结论，不单独判断。

## 跨周结转

按父项的正式交付结论决定整个 MMF 的归属：

| 交付结论 | 归属 | action |
| --- | --- | --- |
| `not_delivered` 或 `unknown` | 移入本周 Cycle | 原在上一周期为 `carry`，其余为 `include` |
| `delivered`，`effectiveAt` 在本周开始之后（含周一 00:30） | 保留或移入本周 | 同上 |
| `delivered`，`effectiveAt` 早于本周开始 | 不得在本周：在本周的改为 `cycle=null` 并回读；旧周归属不动 | `not_carry` |
| `delivered`，`effectiveAt = null` | 保持原归属，不写，报 `delivery_time_unverifiable` | `unchanged`，`write: unknown` |

父项 Done 但未交付，或 Started 但已交付，附加 `workflow_drift` 交原 owner 核对。父项在本周前已交付时，本周 Cycle 里未完成的 ticket（含未开始的）都随父项移出本周。清出与纳入分开判定：父项不在上一周期或本周 Cycle、MMF 也不相关时，只要本周 Cycle 里有它未完成的 ticket，仍读一次父项证据，结论为本周前已交付就清出这些 ticket；父项不纳入、不写。结论是其他情况（含 Unknown、时间缺失）时不写，保持原归属，按上表和证据规则报告；其中仍进行中的 ticket 附加 `workflow_drift`。归属仍按上表，不改任何状态。已完成的 ticket 不复制、不重开、不移动。未来 Cycle 的项视为他人排期，不处理；更早 Cycle 中进行中的项按规则 4 纳入，未开始项不处理。

## 剔除与恢复

剔除只存在于 Linear：Issue 上的专用排除标签。本地不保存逐项副本，所以剔除跨调用、跨进程保留，直到用户恢复。

1. `exclude` 与 `restore` 只接受已核实的 MMF 父项或 ticket。范围外的 ID 报 `scope_invalid`，身份不明的报 `identity_unverifiable`，都不写。同一 ID 同时出现在两边时按 `exclude` 处理，并报 `pick_conflict`（本实现新增 code，只报告）。
2. 先处理显式选择，再规划其余项。每个选择都前读、增量 patch、回读：
   - `exclude` 加标记。未完成的项在本周 Cycle 时同时提交 `cycle = null`；不在本周或已完成时只加标记，归属不动。
   - `restore` 只删目标自身的标记，不提交 `cycle`。之后按当前身份、状态和正式交付规则重新判断，不强制纳入。
   - 已满足目标的选择记 `unchanged`，零 mutation，标签不重复。
3. 标记边界：
   - 父项有标记时，整个 MMF 不纳入，已核实的子票（含后来新建的）派生生效，标记不复制到子票。
   - 子票有标记时只排除它自己，不影响兄弟票和父项。
   - 恢复父项不清除子票自身的标记；恢复子票不绕过父项的标记。
4. 每次维护都会把已剔除、未完成、但出现在本周 Cycle 的项清出本周（action `exclude`）。不在本周或已完成的不动。
5. 清空被原生自动归属抵消时报 `native_assignment_conflict`：保留标记、不改状态、不宣称成功。下次维护会再次识别并纠正。M1 不承诺平台永不加回。
6. 本次未能回读确认的选择项不进入纳入计划；父项未定时整个 MMF 本次不动。下次调用先回读，已生效则记 `unchanged`，不重放。

## 不做

不改团队配置，不创建 Cycle 或标签，不改工作流状态、其他标签和其他字段，不归档、关闭或重开 Issue，不 push、merge 或部署。同步结果不作为开发、派发、预算或恢复的 gate。
