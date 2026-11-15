---
name: delivery-cycle
description: 手动维护一个 Linear 团队／项目的本周工作集合：核对上海时区单周 Cycle，按真实 MMF 身份纳入进行中的父 Spec Issue 与 ticket，按正式交付决定跨周结转，用专用标签持久剔除与恢复，逐项前读、最小增量写入并回读。用于用户要求维护本周 Cycle、同步本周工作集合、剔除或恢复工作项，或判断正式交付时。
---

# delivery-cycle

本 Skill 是周期维护规则与正式交付判断的唯一 owner。M2 自动调用、M3 周报和其他入口只调用同一个脚本，不复制判断。

## 何时调用

用户明确要求对一个团队／项目维护本周集合时调用。没有明确的 `teamId`、`projectId` 和专用排除标签 ID 时，先问用户，不猜。

## 入口

```bash
node skills/delivery-cycle/scripts/run.js --team <teamId> --project <projectId> --exclusion-label <labelId> \
  [--exclude id1,id2] [--restore id1,id2] [--spec-acceptance <Spec identifier>=<commentId>:<verified|not_met>] \
  [--transport mcp|graphql]
```

stdout 输出一行 `MaintenanceResult` JSON。退出码：`0` 为 `synchronized`，`1` 为其余结果，`2` 为参数错误。PR 合入事实经 `gh api` 只读读回。

Linear 通道：

- 默认 `--transport mcp`：脚本经 `mcporter call magpie.call_tool` 调本机 magpie hub 上已授权的官方 Linear MCP（`linear__get_team`、`list_cycles`、`list_issues`、`get_issue`、`list_issue_labels`、`list_comments`、`save_issue`）。OAuth 留在 hub，不要 API Key，不读钥匙串。此通道的 Issue id 是 identifier（如 `DD-541`），`--exclude`／`--restore` 也传 identifier。
- 可选 `--transport graphql`：Personal API Key 从 macOS 钥匙串读取（service `refresh-linear-api-key`，account 为当前系统用户），只放进 `Authorization` 头。key 缺 read scope 只影响这个通道。
- 默认通道失败时不要转去问用户要 Key，也不要打开 secret 请求；按结果里的 code 报告。

官方 MCP 的 `get_team` 只返回团队基础身份，没有时区、周期长度、开始日、cooldown。所以默认通道下结果会是 `configuration_unverifiable`，message 点名缺的字段。同时脚本仍读一次 Cycle：观察到不是 7 天的 Cycle 时另列一条 `configuration_mismatch`，写明 Cycle id 与天数。向用户报告时分三句说清：Linear 可读；团队配置缺这些字段，无法核实；观察到的 Cycle 是 14 天，不符合单周。不从 Cycle 日期反推时区或设置，也不说团队参数已核实。`--spec-acceptance` 可重复或逗号分隔，格式错误按参数错误退出（`2`），零请求。

脚本内调用同一入口：

```js
import { maintainCurrentWeek } from './scripts/delivery-cycle.js';
import { createKeychainTransport, createLinearAdapter } from './scripts/linear-graphql.js';
import { createEvidenceAdapter, createGhPullReader } from './scripts/evidence.js';
import { createLinearMcpAdapter, createMcpEvidenceSource, createMcporterCaller } from './scripts/linear-mcp.js';
```

Adapter 合同写在 [scripts/delivery-cycle.js](scripts/delivery-cycle.js) 的 L5 块，MCP 工具映射写在 [scripts/linear-mcp.js](scripts/linear-mcp.js)，GraphQL 映射写在 [scripts/linear-graphql.js](scripts/linear-graphql.js)。只有平台明确拒权（MCP 工具错误含 permission／forbidden／unauthorized／scope，或 GraphQL `Invalid scope`、401／403）才报 `permission_denied`，零写入；其余读取失败报 `capability_unavailable`。`readIssue` 返回 `{id, teamId, projectId, statusType, labels, parentId, cycleId, specRef}`；其中 `teamId`、`projectId`、`specRef` 是对 Spec §3 形状的扩展，缺 `teamId`／`projectId` 的项按 `scope_invalid` 处理，零写入。

Spec 身份只看 to-spec 产物：Issue 描述按行含全部 `## Problem Statement`、`## Solution`、`## User Stories`、`## Implementation Decisions`、`## Testing Decisions`、`## Out of Scope` 时，它是 MMF 父 Spec Issue（`specRef` 为自身 identifier）。与有无 Epic 父项、有无子项和标题都无关，所以零 ticket 的独立 Spec 也算。to-tickets 的 ticket 模板（`## Parent`／`## What to build`／`## Acceptance criteria`）和 Epic 都不是 Spec。缺描述或模板不全时不是 Spec，进行中又不属于已核实的 Spec 时报 `identity_unverifiable`。

职责分工：

- CLI 只做确定性部分：Linear 读写、按模板判断 Spec 身份、经 GitHub 读回 PR 合入事实、回读快照评论并核对它属于该 Spec。
- 手动调用本 Skill 的 agent 在运行前，对每个候选 Spec 读原验收／closeout 评论。原文明确写出 Spec 验收通过或未通过时，才用 `--spec-acceptance` 传入该评论 ID 与结论；读不出明确结论就不传，该条件保持 Unknown。agent 不写评论、不改 Issue。

## 维护规则

1. 本周是 Asia/Shanghai 周一 00:00 起的左闭右开 7 天。团队配置必须是：启用 Cycle、上海时区、一周、周一开始、无 cooldown。目标 Cycle 边界必须与本周完全一致。双周不截半。
2. 前置不满足时零写入，整体 `unsynchronized`，并给出稳定 code：`configuration_mismatch`、`configuration_unverifiable`、`cycle_missing`、`exclusion_marker_missing`、`permission_denied`、`capability_unavailable`。排除标签读不到或不属于本团队时报 `exclusion_marker_missing`，不用本地列表替代。
3. 完整分页读取 Issue。带原 Spec 引用的是 MMF 父项，它的直接子项是 ticket。Epic 不进 Cycle。进行中但身份断裂的项报 `identity_unverifiable`，范围外的项报 `scope_invalid`，两者都不写。
4. 父项进行中，或任一 ticket 进行中时，纳入父项和进行中的 ticket。父项保持原状态，本周新建的未开始兄弟票不纳入，没有进行中关联的 Backlog 也不纳入。本周 Cycle 里未开始的 ticket 不是纳入父项的理由。
   MMF 是否相关只看三项：父项进行中或停在任一过去 Cycle 且未完成；父项在上一周期或本周 Cycle（含已完成，参与结转判断）；存在进行中、且不在未来 Cycle 的 ticket。过去 Cycle（含跳过几周后更早的 Cycle）中未完成的 ticket（含未开始的）只在 MMF 已相关时随行结转；它自己不让 MMF 相关。MMF 不相关时，这类 ticket 记 `unchanged`／`unchanged`，不写、不报问题。见下文「跨周结转」。
   已在未来 Cycle（开始时间不早于本周结束，含下周和更远）的项视为他人排期：先于纳入判断滤出，记 `unchanged`／`unchanged`，不写、不移回本周，也不把父项拉进本周。这类只观察的项在整体状态里不算符合项（见规则 7）。父项在未来 Cycle 而 ticket 已纳入本周时，父项附加 `workflow_drift`，交原 owner 核对。
5. 每项写入前重算当周并重读 Issue，回读后再核对一次。已在目标 Cycle 的项不写。
   - 前读时项已离开授权团队或项目，报 `scope_invalid`；父子关系或 Spec 引用与计划时不同，报 `identity_unverifiable`。该项不写，其余继续。
   - 真正写入前再分页重读 Cycle：本周 Cycle 边界不再等于本周，报 `configuration_mismatch`；本周 Cycle 消失，报 `cycle_missing`。两者都停止后续写入。重读后按新的 Cycle 列表重判当前项的前读值。
   - `cycle_expired` 有两类触发：上海时钟已跨过周一 00:00；或计划时在本周 Cycle 的项，在前读、写前重读或回读时已在紧接的下一 Cycle。Linear 原生滚动与他人周中手动移动无法区分，两者都保守停止。该项记 `failed`，停止旧周的全部后续写入。
   - 计划时不在本周 Cycle、前读才发现已在未来 Cycle 的纳入目标视为他人排期：该项记 `unchanged`，不报失败，其余继续。
   - 停止后续写入时，当前项与全部未处理项都列入 `items`（`unchanged`／`failed`），只报一条阻断。剔除／恢复先于纳入执行；在这一阶段阻断时纳入计划尚未生成，纳入项不列入 `items`。
   已观察到新周归属的项绝不回移旧周。下一次调用按新周重新核对和计划。没有 CAS，前读之后、写入之前的漂移只能由回读发现并报告，不能根除。
6. patch 只含 `cycle` 与专用排除标签的增减（`addLabels`／`removeLabels`），其他标签与字段不提交。写入后回读 `cycleId` 与 `labels`，结论只看回读：
   - 回读符合目标记 `verified`，即使响应超时或带 GraphQL errors。
   - 响应超时、为空或形状不明，或回读为空、出错、缺 `cycleId`，记 `write_unknown`。
   - 响应声称成功但回读不符，记 `readback_mismatch`。
   - 响应带 GraphQL errors 或 `success: false` 且回读不符，记 `write_failed`。
   - 响应声称成功的剔除，回读标签已加、但仍在本周 Cycle，记 `native_assignment_conflict`；平台明确拒绝的剔除按上一条记 `write_failed`。
   - 写入抛出 `permission_denied` 或 `capability_unavailable` 是确定失败，原样上报，该项 `failed`，不记 `write_unknown`。
7. 整体状态只看有写入目标的项；只观察的项（未来 Cycle 的项、不相关 MMF 的过去 Cycle ticket、未清出的本周 ticket）列在 `items` 里，但不算符合项。全部符合为 `synchronized`；至少一项符合（含原本无需变更项）但仍有失败或未知为 `partial`；未被阻断、没有符合项且有无法判定项为 `unknown`；其余为 `unsynchronized`。被阻断时没有符合项一律 `unsynchronized`。`changed` 只统计回读确认的变更。运行中途才阻断（如写前重读 `cycle_missing`）且已有符合项时为 `partial`，因为之前的写入已真实落地；入口即阻断为 `unsynchronized`。
8. 重试就是再调用一次。每次都重新核对并前读：上次 Unknown 但实际已生效的项记 `unchanged`，不重放；`partial` 后只写仍不符合的项。已 `verified` 的项不回滚。

## 正式交付

`assessFormalDelivery({spec, main})` 是唯一公式。两项都是 `verified` 时为 `delivered`；任一为 `not_met` 时为 `not_delivered`；其余为 `unknown`。`effectiveAt` 只在已交付且两个事件时间都存在时取较晚值，否则为 `null`。事件时间必须是带时区的 ISO 8601 字符串，日期必须真实存在（`2026-02-30` 不算），其余形状按缺失处理。证据不足时保持 Unknown，并附 `evidence_unavailable`。证据形状不合法，或 `verified`／`not_met` 缺 `source`，该条件按 `unknown` 处理。

工作流状态、Integration、HTTP 200、口头声称和提交时间都不替代这两项证据。

两项证据都复用原 owner 的事实，不新建标记或账本：

- `main`：closeout 记录的 PR 合入事实（owner：`git-rebase-main` 的 closeout）。读 Spec Issue 的 attachments，只取 `https://github.com/<owner>/<repo>/pull/<n>` 形式的链接并去重。恰好一个时经 `gh api repos/<owner>/<repo>/pulls/<n>` 读回：已合并且 `base.ref` 等于仓库默认分支为 `verified`，来源是 PR 链接，事件时间是 `merged_at`；未合并为 `not_met`；合入其他分支为 `unknown`。没有 PR、多于一个 PR 或读取失败时为 `unknown`。
- `spec`：原 Spec 验收／closeout 评论的快照（见「入口」的职责分工）。脚本回读该评论，评论属于这个 Spec Issue 时，结论取快照值，来源是评论链接，事件时间为 `null`；评论可能事后补写，`createdAt` 不能证明验收实际发生时间。因此该 Adapter 即使确认已交付，也不推断所属周，保持原归属并报告 `delivery_time_unverifiable`。没有快照、评论读不到或属于其他 Issue 时为 `unknown`。

评论正文里的 sha 和时间、提交日期都不作证据。读取失败（含 `permission_denied`）只让该条件为 `unknown`，原因写进 `reason`。维护入口对每个 MMF 只读一次父项证据，经同一公式判断；ticket 沿用父项结论，不单独判断。

## 跨周结转

按父项的正式交付结论决定整个 MMF 的归属：

| 交付结论 | 归属 | action |
| --- | --- | --- |
| `not_delivered` 或 `unknown` | 移入本周 Cycle | 原在过去 Cycle 为 `carry`，其余为 `include` |
| `delivered`，`effectiveAt` 在本周开始之后（含周一 00:30） | 保留或移入本周 | 同上 |
| `delivered`，`effectiveAt` 早于本周开始 | 不得在本周：在本周的改为 `cycle=null` 并回读；旧周归属不动 | `not_carry` |
| `delivered`，`effectiveAt = null` | 保持原归属，不写，报 `delivery_time_unverifiable` | `unchanged`，`write: unknown` |

父项 Done 但未交付，或 Started 但已交付，附加 `workflow_drift` 交原 owner 核对。父项在本周前已交付时，本周 Cycle 里未完成的 ticket（含未开始的）都随父项移出本周。清出与纳入分开判定：父项不在上一周期或本周 Cycle、MMF 也不相关时，只要本周 Cycle 里有它未完成的 ticket，仍读一次父项证据，结论为本周前已交付就清出这些 ticket；父项不纳入、不写。结论是其他情况（含 Unknown、时间缺失）时不写，保持原归属，按上表和证据规则报告；其中仍进行中的 ticket 附加 `workflow_drift`。归属仍按上表，不改任何状态。已完成的 ticket 不复制、不重开、不移动。未来 Cycle 的项视为他人排期，不处理；更早 Cycle 中进行中的项按规则 4 纳入；未开始项只在 MMF 已相关时随行结转，否则不处理。

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
