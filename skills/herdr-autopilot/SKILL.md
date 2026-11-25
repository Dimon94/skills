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
- **零抢焦点**：所有 workspace / tab / pane 操作携带 `--no-focus`，不依赖 `--current` 或 focused pane。
- **2×2 四格与可视化命名**：每张 worker tab 最多 4 个 pane，按左上 → 右上 → 左下 → 右下均分，满 4 自动开 `-2`；workspace、tab、pane 统一采用 `<Issue号> <中文简写>[ <英文>]` 短命名，由脚本校验汉字与显示宽度上限。
- **不可逆硬拦截**：合并 PR/MR、强推共享分支、删除数据、生产部署、对外发消息只升级给用户，绝不代输确认口令。
- **Issue 状态强同步**：`register`、`set-stage --stage awaiting_merge`、`set-stage --stage done` 由脚本自动调用 tracker 同步状态并回读校验，回读不符即 fail-close；严禁口头汇报进展而把 Issue 留在 `Backlog`。

## 布局与可视化命名

统一格式：**`<Issue号> <中文简写>[ <英文>]`**（Issue 号置前防截断，中文 2–6 字提炼核心动作/对象，必要时附极短英文如 `M3`、`API`、`Job`）。汉字计 2 列、ASCII 计 1 列：

| 对象 | 宽度上限 | 命名示例 | 说明 |
| --- | --- | --- | --- |
| Workspace（左侧 space） | 20 列 | `JB-512 零停机 M3` | 主任务/Epic 简称，经 `--workspace-label` 同步 `herdr workspace rename` |
| Tab（顶部标签） | 20 列（前缀 ≤ 18） | `JB-512 实施` / `JB-512 实施-2` | 协调 tab 单独占 1 格；worker tab 每张最多 4 格，满 4 顺延 `-2` |
| Pane（单格标题） | 24 列 | `JB-548 扩表Job`、`JB-546 双向门禁` | 每格对应具体票/角色，由脚本自动调用 `herdr pane rename` |

多票并行落位统一调用 `place`（脚本按 2×2 四格自动 split 与命名，并发走账本锁防竞态）；`pipeline` 阶段调用 `/delivery-pipeline-herdr` 时，给其 `--tab-prefix` 与 `--title` 传入同一套短命名。

## 主循环

每次手动触发或定时巡检，按顺序执行 5 步：

### 1. 巡检快照

```bash
node scripts/autopilot.js poll
```

- 返回 `status: "quiet"` 且本次没有新需求入队时，本轮直接结束，只回复一行当前活跃 lane 计数（若为兜底定时巡检且无变化，静默收口）。
- 每条 lane 的每个状态只报一次。状态没变的 lane 进 `unchanged`，只带身份，不带尾部；全部没变就是 `quiet`。`unchanged` 里的 lane 不重新分诊。
- 用户发话的回合、新会话或上下文接力后的第一次巡检用 `poll --full`，重报全量。
- 脚本只对 `idle` / `done` / `blocked` 且状态有变的已登记 lane 抓尾部输出，保持主上下文精简。
- 收到 `[herdr-autopilot WAKE]` 事件唤醒时，立刻走本步骤并进入第 3 步分诊回应。

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

1. 在目标仓库为任务创建隔离 worktree，并通过 `place` 在目标 workspace 落位（每 tab 最多 4 pane、2×2 均分，自动完成 workspace / tab / pane 可视化命名）：
   ```bash
   node scripts/autopilot.js place \
     --workspace <ws_id> --cwd <任务工作树根目录> --issue <issue key 或 URL> \
     --tab-prefix "<中文简写[ 英文]>" --pane-label "<中文简写[ 英文]>" \
     [--workspace-label "<中文简写[ 英文]>"] [--exclude-tab <coord_tab_id>]
   ```
2. 在返回的 `pane_id` 启动目标交互式 Agent（默认 `pi`，名称遵循 `[a-z][a-z0-9_-]{0,31}`）：
   ```bash
   herdr agent start <agent_name> --kind pi --pane <pane_id>
   ```
3. 登记 lane（`--pane` 必带可视化 `--label`，脚本自动补齐 `<Issue号>` 并校验宽度；落入共享四格 worker tab 时加 `--keep-tab-label` 保留 tab 名），登记成功后再投递首条命令并挂事件 watcher：
   ```bash
   node scripts/autopilot.js register \
     --id <lane_id> --issue <issue key 或 URL> --repo <repo_path> --stage <stage> \
     --agent <agent_name> --pane <pane_id> --workspace <ws_id> \
     --label "<中文简写[ 英文]>" [--keep-tab-label] [--workspace-label "<中文简写[ 英文]>"] \
     --worktree <任务工作树根目录> --base <实际合入的本地分支名>
   herdr agent prompt <agent_name> "<首条命令>"
   node scripts/autopilot.js watch --id <lane_id> --thread <当前 T3 线程 ID> --daemon --after-prompt
   ```

只读任务使用 `--pane-only` 代替 `--worktree` 和 `--base`。写任务在新建的任务工作树根目录启动 pane。

`--issue` 写本 lane 服务的 Epic、Spec 或 ticket，缺了 register 直接失败。`register` 通过后脚本会自动把该 issue 及尚未开始的 Linear 父链（Spec / Epic）置为 `In Progress` 并回读确认，失败或 issue 已处终态时拒绝登记。Bug 没有 issue 时，先按目标项目的调试闭环建单再登记；没有建单授权就 escalate。首条命令带上同一坐标，Epic 下的 MMF 写成 `/to-spec <Epic URL> <MMF 标识>`。lane 新建的 Spec 和 ticket 必须是该 issue 的原生子项：Spec 由 to-spec 读回 `--parent` 核对，ticket 由 to-tickets 读回父子关系。正文链接只算 related，不算挂上。

### 3. 暂停分诊（仅当 `needs_attention` 非空时）

读取 [references/pause-triage.md](references/pause-triage.md)，逐条判定 `needs_attention` 中的 lane：

- **自动推进（Auto-reply）**：
  1. 先过熔断闸门：
     ```bash
     node scripts/autopilot.js record-reply --id <lane_id> --note "<回复摘要>"
     ```
  2. 退出码 `0` 且 `allowed: true` 时，才发送回复并重挂事件 watcher：
     ```bash
     herdr agent prompt <agent_name> "<回复正文>"
     node scripts/autopilot.js watch --id <lane_id> --thread <当前 T3 线程 ID> --daemon --after-prompt
     ```
     若阶段已切换（例如 `to-epic` 完成转 `/to-spec`），同步调用 `node scripts/autopilot.js set-stage --id <lane_id> --stage <next_stage>`。
  3. 退出码 `2` 表示触发连续自动回复熔断（已自动标为 `escalated`），停止自动回复并列入本轮上报。
- **升级人类（Escalate）**：
  仅在缺少外部权限/凭证、遇到不可逆操作、触发熔断或同类失败连续两次未定位根因时标记状态，不向 pane 发输入；`to-epic` / `to-spec` / `to-tickets` / `dimon-mode` 过程链路内的常规规划与拆票裁决由总控直接拍板推进：
  ```bash
  node scripts/autopilot.js escalate --id <lane_id> --reason "<一句话原因>"
  ```
- **PR/MR 就绪待合入**：
  `delivery-pipeline-herdr` 或 `bugfix` 已完成验收并等待人类合入时（脚本同步把直接 issue 推进至 `In Review` 并回读）：
  ```bash
  node scripts/autopilot.js set-stage --id <lane_id> --stage awaiting_merge
  ```
- **流水线内子票状态同步**：
  巡检 `pipeline` lane 时，若观察到某张子票（如 `JB-546`）已开始实施或已验收合入集成分支，但未单独登记为独立 lane，立即运行确定性同步命令更新该子票状态并回读：
  ```bash
  node scripts/autopilot.js sync-issue --issue <ticket_key_or_url> --target <started|review|done>
  ```
- **用户答复已升级项后**：
  将用户的拍板原文转发给对应 `agent_name`，并调用 `node scripts/autopilot.js resolve --id <lane_id>` 恢复自动巡检。

### 4. 验收和清理

每次巡检也检查 `awaiting_merge`。确认交付已验收、PR/MR 已合入并更新对应的本地合入分支后，执行下列命令。只读任务在结果已交付后执行。Herdr 的 idle/done 只能作为检查交付结果的信号。

```bash
node scripts/autopilot.js set-stage --id <lane_id> --stage done
```

脚本核对已登记的 pane 和 agent、任务工作树归属、工作树洁净状态和 Git 祖先关系，依次回收工作树、本地任务分支、pane，随后把直接 issue 置为 `Done` 并回读确认，全部通过才写入 `done`（父项 Epic/Spec 保持只读不自动关闭）。只读任务（`--pane-only`）只关闭 pane，默认不关闭 issue。若该 issue 因外部部署或线上验收门暂不能关闭，显式传 `--keep-issue-open --reason "<原因>"`（脚本保持其为 `In Review` 并记录原因）。任一步失败即进入 `escalated`，排除原因后重试同一命令即可幂等续跑。旧账本缺少所有权、squash/rebase 后无法证明祖先关系时保留现场并上报。

### 5. 汇报收口

只输出本轮 `poll` 报出的项；`unchanged` 里等人的 lane 只在 `poll --full` 的回合重列：

- 本轮自动推进的 lane（`lane_id`、`issue`、动作、当前 stage）。
- `escalated` 队列：每条给「卡点 + 推荐选项 + 理由」，方便用户一句话批复。
- `awaiting_merge` 队列：PR/MR 坐标与验收状态。
- 用户在任意终端直接运行 `herdr` 即可查看并随时接管所有会话。

## 事件唤醒与兜底巡检

- **主通道（事件唤醒）**：每次入队或自动回复后调用 `node scripts/autopilot.js watch --id <lane_id> --thread <当前 T3 线程 ID> --daemon --after-prompt`。脚本用 `herdr agent wait` 阻塞等待目标进入 `idle` / `done` / `blocked`，命中后立刻经 T3 `t3_thread_send` 激活主会话，按 PID 文件去重，并在 lane 非 `active` 时抑制陈旧唤醒。
- **兜底通道（低频定时巡检）**：在 T3 Code 中配合 `schedule_task` 设为 15–30 分钟低频兜底（防 watcher 进程异常退出或凭证失效），全绿运行中静默结束，不再用 3–5 分钟高频轮询充当主通道。
