---
name: herdr-autopilot
description: 从 T3 Code 等外部宿主操控默认 Herdr 窗口，靠账本白名单隔离，按 dimon-mode 与 delivery-pipeline-herdr 自动推进多需求与缺陷修复。
disable-model-invocation: true
---

# Herdr Autopilot

从外部宿主（如 T3 Code）直接调度默认 Herdr session（用户敲 `herdr` 打开的主窗口；也支持显式 `--session <name>`），在其中并发推进多个需求与缺陷，并在子 Agent 暂停时按 `dimon-mode` 原则自动分诊回复或升级给用户。

## 边界

- **默认主窗口合一**：默认使用 `default` Herdr session（所有 `herdr` 命令直接执行，无需额外适配远程连接）；除非用户显式指定其他 `--session`，否则不为任务拆独立 session。
- **账本白名单隔离**：只读取、回复、操作账本里已登记的 `agent` / `pane_id`；用户手工开的未登记 pane/agent 一律忽略。
- **零抢焦点**：严禁使用 `--current` 或依赖 focused pane；新建 workspace / worktree / tab / pane 一律带 `--no-focus`，并用语义化名称区分各任务（如 `ads-triage`、`ads-ready`）。
- **不可逆硬拦截**：合并 PR/MR、强推共享分支、删除数据、生产部署、对外发消息只升级给用户，绝不代输确认口令。

## 主循环

每次手动触发或定时巡检，按顺序执行 4 步：

### 1. 巡检快照

```bash
node scripts/autopilot.js poll
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

1. 在目标仓库为任务创建隔离 worktree（或 `herdr worktree create ... --no-focus` / `herdr workspace create ... --no-focus`），获取 `workspace` 与 `pane_id`。
2. 在该 pane 启动目标交互式 Agent（默认 `pi`，名称遵循 `[a-z][a-z0-9_-]{0,31}`）：
   ```bash
   herdr agent start <agent_name> --kind pi --pane <pane_id>
   ```
3. 登记时用 lane ID 命名该 pane 所在的标签页。需要自定义标题时给 register 加 `--label "任务简称"`。登记成功后再投递首条命令：
   ```bash
   node scripts/autopilot.js register \
     --id <lane_id> --repo <repo_path> --stage <stage> \
     --agent <agent_name> --pane <pane_id> --workspace <ws_id>
   herdr agent prompt <agent_name> "<首条命令>"
   ```

### 3. 暂停分诊（仅当 `needs_attention` 非空时）

读取 [references/pause-triage.md](references/pause-triage.md)，逐条判定 `needs_attention` 中的 lane：

- **自动推进（Auto-reply）**：
  1. 先过熔断闸门：
     ```bash
     node scripts/autopilot.js record-reply --id <lane_id> --note "<回复摘要>"
     ```
  2. 退出码 `0` 且 `allowed: true` 时，才发送回复：
     ```bash
     herdr agent prompt <agent_name> "<回复正文>"
     ```
     若阶段已切换（例如 `to-epic` 完成转 `/to-spec`），同步调用 `node scripts/autopilot.js set-stage --id <lane_id> --stage <next_stage>`。
  3. 退出码 `2` 表示触发连续自动回复熔断（已自动标为 `escalated`），停止自动回复并列入本轮上报。
- **升级人类（Escalate）**：
  仅在缺少外部权限/凭证、遇到不可逆操作、触发熔断或同类失败连续两次未定位根因时标记状态，不向 pane 发输入；`to-epic` / `to-spec` / `to-tickets` / `dimon-mode` 过程链路内的常规规划与拆票裁决由总控直接拍板推进：
  ```bash
  node scripts/autopilot.js escalate --id <lane_id> --reason "<一句话原因>"
  ```
- **PR/MR 就绪待合入**：
  `delivery-pipeline-herdr` 或 `bugfix` 已完成验收并等待人类合入时：
  ```bash
  node scripts/autopilot.js set-stage --id <lane_id> --stage awaiting_merge
  ```
- **用户答复已升级项后**：
  将用户的拍板原文转发给对应 `agent_name`，并调用 `node scripts/autopilot.js resolve --id <lane_id>` 恢复自动巡检。

### 4. 汇报收口

只输出有变化的项与当前需人类处理的队列：

- 本轮自动推进的 lane（`lane_id`、动作、当前 stage）。
- `escalated` 队列：每条给「卡点 + 推荐选项 + 理由」，方便用户一句话批复。
- `awaiting_merge` 队列：PR/MR 坐标与验收状态。
- 用户在任意终端直接运行 `herdr` 即可查看并随时接管所有会话。

## 定时巡检

在 T3 Code 中配合 `schedule_task`（建议每 3–5 分钟）调用本 Skill 执行一轮巡检：全绿运行中时静默结束，仅在出现待拍板项或阶段收口时汇报。
