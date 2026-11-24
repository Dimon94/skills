---
name: herdr-autopilot
description: 从 T3 Code 等外部宿主操控独立命名 Herdr session，按 dimon-mode 与 delivery-pipeline-herdr 自动推进多需求与缺陷修复。
disable-model-invocation: true
---

# Herdr Autopilot

从外部宿主（如 T3 Code）调度独立命名 Herdr session（默认 `autopilot`），在其中并发推进多个需求与缺陷，并在子 Agent 暂停时按 `dimon-mode` 原则自动分诊回复或升级给用户。

## 边界

- **单一独立窗口**：所有自动驾驶任务统一落在同一个 `--session autopilot` 内（除非用户显式指定其他 session 名），绝不操控用户的默认或 focused Herdr session。
- **不按任务拆 session**：多个需求、并行队列或“新会话”一律在同一个 `autopilot` session 内通过不同的 `workspace` / `tab` / `pane` 与语义化命名（如 `ads-triage`、`ads-ready`）区分，保证用户在副屏只开一个 `herdr session attach autopilot` 窗口即可看到全部 Agent 会话。
- 只读取、回复账本中登记的 lane；未登记的 pane/agent 一律忽略。
- 不可逆操作（合并 PR/MR、强推共享分支、删除数据、生产部署、对外发消息）只升级给用户，绝不代输确认口令。

## 主循环

每次手动触发或定时巡检，按顺序执行 4 步：

### 1. 巡检快照

```bash
node scripts/autopilot.js poll --session autopilot
```

- 返回 `status: "quiet"` 且本次没有新需求入队时，本轮直接结束，只回复一行当前活跃 lane 计数。
- 脚本只对 `idle` / `done` / `blocked` 的已登记 lane 抓尾部输出，保持主上下文精简。

### 2. 新需求或 Bug 入队（仅当用户给出新任务时）

按任务类型选入口：

| 任务类型 | 初始 stage | 首条投递命令 |
| --- | --- | --- |
| 大需求 / Epic | `epic` | `/to-epic <目标与上下文>` |
| 明确单个 MMF | `spec` | `/to-spec <MMF 与上下文>` |
| 已有 Spec 待拆票 | `tickets` | `/to-tickets <Spec 坐标>` |
| 已有票或既有 map | `pipeline` | `/delivery-pipeline-herdr <map 或 Epic 坐标>` |
| Bug 修复 | `bugfix` | `/dimon-mode 按 playbooks/bug-fix.md 复现并修复：<现象与坐标>` |

入队动作：

1. 在目标仓库为任务创建隔离 worktree（或通过 `herdr --session autopilot worktree create` 创建），获取 `workspace` 与 `pane_id`。
2. 在该 pane 启动目标交互式 Agent（默认 `pi`，名称遵循 `[a-z][a-z0-9_-]{0,31}`）：
   ```bash
   herdr --session autopilot agent start <agent_name> --kind pi --pane <pane_id>
   ```
3. 先登记账本，再投递首条命令：
   ```bash
   node scripts/autopilot.js register --session autopilot \
     --id <lane_id> --repo <repo_path> --stage <stage> \
     --agent <agent_name> --pane <pane_id> --workspace <ws_id>
   herdr --session autopilot agent prompt <agent_name> "<首条命令>"
   ```

### 3. 暂停分诊（仅当 `needs_attention` 非空时）

读取 [references/pause-triage.md](references/pause-triage.md)，逐条判定 `needs_attention` 中的 lane：

- **自动推进（Auto-reply）**：
  1. 先过熔断闸门：
     ```bash
     node scripts/autopilot.js record-reply --session autopilot --id <lane_id> --note "<回复摘要>"
     ```
  2. 退出码 `0` 且 `allowed: true` 时，才发送回复：
     ```bash
     herdr --session autopilot agent prompt <agent_name> "<回复正文>"
     ```
     若阶段已切换（例如 `to-epic` 完成转 `/to-spec`），同步调用 `node scripts/autopilot.js set-stage --session autopilot --id <lane_id> --stage <next_stage>`。
  3. 退出码 `2` 表示触发连续自动回复熔断（已自动标为 `escalated`），停止自动回复并列入本轮上报。
- **升级人类（Escalate）**：
  仅在缺少外部权限/凭证、遇到不可逆操作、触发熔断或同类失败连续两次未定位根因时标记状态，不向 pane 发输入；`to-epic` / `to-spec` / `to-tickets` / `dimon-mode` 过程链路内的常规规划与拆票裁决由总控直接拍板推进：
  ```bash
  node scripts/autopilot.js escalate --session autopilot --id <lane_id> --reason "<一句话原因>"
  ```
- **PR/MR 就绪待合入**：
  `delivery-pipeline-herdr` 或 `bugfix` 已完成验收并等待人类合入时：
  ```bash
  node scripts/autopilot.js set-stage --session autopilot --id <lane_id> --stage awaiting_merge
  ```
- **用户答复已升级项后**：
  将用户的拍板原文转发给对应 `agent_name`，并调用 `node scripts/autopilot.js resolve --session autopilot --id <lane_id>` 恢复自动巡检。

### 4. 汇报收口

只输出有变化的项与当前需人类处理的队列：

- 本轮自动推进的 lane（`lane_id`、动作、当前 stage）。
- `escalated` 队列：每条给「卡点 + 推荐选项 + 理由」，方便用户一句话批复。
- `awaiting_merge` 队列：PR/MR 坐标与验收状态。
- 附上围观命令：`herdr session attach autopilot`。

## 定时巡检

在 T3 Code 中配合 `schedule_task`（建议每 3–5 分钟）调用本 Skill 执行一轮巡检：全绿运行中时静默结束，仅在出现待拍板项或阶段收口时汇报。
