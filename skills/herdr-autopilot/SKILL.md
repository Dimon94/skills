---
name: herdr-autopilot
description: 从 T3 Code 等外部宿主操控默认 Herdr 窗口，靠账本白名单隔离，按 dimon-mode 与 delivery-pipeline-herdr 自动推进多需求与缺陷修复。
disable-model-invocation: true
---

# Herdr Autopilot

从外部宿主（如 T3 Code）调度默认 Herdr session（也支持 `--session <name>`），作为多 PR 无人值守交付的 Herdr 运行期适配层。多 PR 无人值守的验证、合入前主干判定、门禁复签、按副作用判卡死与停机零写入合同以 [`autopilot-full.md`](../dimon-mode/playbooks/autopilot-full.md) 为主（只验证不合并或有依赖栈时以 [`autopilot-stack.md`](../dimon-mode/playbooks/autopilot-stack.md) 为主）；本 Skill 只承载 Herdr 侧的账本白名单、布局命名、模型启动、事件唤醒、Issue 同步与资源回收。

## Herdr 运行期边界

- **总控只写账本与调度**：不改产品代码、不解冲突、不代输确认门（含 spec-preview confirm），发现工具链 bug 开 bugfix lane 去修；其余多 PR 门禁与复签规则按 [`autopilot-full.md`](../dimon-mode/playbooks/autopilot-full.md) 第 1、5、6 步执行。
- **默认主窗口合一**：默认使用 `default` Herdr session；除非用户显式指定 `--session`，不为任务拆独立 session。
- **账本白名单隔离**：只读取、回复、操作账本里已登记的 `agent` / `pane_id`；用户手工开的未登记 pane/agent 一律忽略。
- **模型按配置**：lane 的 harness、model、effort 只经 `launch` 从 delivery-pipeline 模型配置解析；`register` 拒绝未经 `launch` 启动的 pane。
- **零抢焦点**：所有 workspace / tab / pane 操作携带 `--no-focus`，不依赖 `--current` 或 focused pane。
- **一个 Epic 一个 workspace**：每个 Epic 独占一个 workspace，它的 Spec、ticket、bugfix lane 都落在这里；`place` 按 `--epic` 复用该 Epic 的 workspace，没有就新建；`register` 拒绝跨 Epic 共用或同 Epic 分散。
- **2×2 四格与可视化命名**：每张 worker tab 最多 4 个 pane，按左上 → 右上 → 左下 → 右下均分，满 4 自动开 `-2`；workspace、tab、pane 统一采用 `<Issue号> <中文简写>[ <英文>]` 短命名，由脚本校验汉字与显示宽度上限。
- **Issue 状态强同步**：`register`、`set-stage --stage awaiting_merge`、`set-stage --stage done` 由脚本自动调用 tracker 同步状态并回读校验，回读不符即 fail-close；严禁口头汇报进展而把 Issue 留在 `Backlog`。

## 布局与可视化命名

统一格式：**`<Issue号> <中文简写>[ <英文>]`**（Issue 号置前防截断，中文 2–6 字提炼核心动作/对象，必要时附极短英文如 `M3`、`API`、`Job`）。汉字计 2 列、ASCII 计 1 列：

| 对象 | 宽度上限 | 命名示例 | 说明 |
| --- | --- | --- | --- |
| Workspace（左侧 space） | 20 列 | `JB-512 零停机 M3` | 所属 Epic 的简称，以 Epic 号开头；由 `place --workspace-label` 命名 |
| Tab（顶部标签） | 20 列（前缀 ≤ 18） | `JB-512 实施` / `JB-512 实施-2` | 协调 tab 单独占 1 格；worker tab 每张最多 4 格，满 4 顺延 `-2` |
| Pane（单格标题） | 24 列 | `JB-548 扩表Job`、`JB-546 双向门禁` | 每格对应具体票/角色，由脚本自动调用 `herdr pane rename` |

多票并行落位统一调用 `place`（脚本按 2×2 四格自动 split 与命名，并发走账本锁防竞态）；`pipeline` 阶段调用 `/delivery-pipeline-herdr` 时，给其 `--tab-prefix` 与 `--title` 传入同一套短命名。

## 主循环

每次收到 WAKE 或用户发话，按顺序执行 5 步：

### 1. 巡检快照

```bash
node scripts/autopilot.js poll
```

- 返回 `status: "quiet"` 且本次没有新需求入队时，本轮直接结束，只回复一行当前活跃 lane 计数。
- 每条 lane 的每个状态只报一次。状态没变的 lane 进 `unchanged`，只带身份，不带尾部；全部没变就是 `quiet`。`unchanged` 里的 lane 不重新分诊。
- 用户发话的回合、新会话或上下文接力后的第一次巡检用 `poll --full`，重报全量。
- 脚本只对 `idle` / `done` / `blocked` 且状态有变的已登记 lane 抓尾部输出，保持主上下文精简。
- 收到 `[herdr-autopilot WAKE]` 消息时不跑 `poll`：消息正文就是这次巡检结果，直接进入第 3 步。
- WAKE 正文与 herdr 实际状态不符、上下文接力后，或收到哨兵的系统通知时，不信 WAKE 正文，改跑 `poll --full`。
- `unwatched` 非空表示这些 lane 的哨兵已经不在了：对每条重新执行 `watch`。
- `unreleased` 非空表示 lane 已是 `done` 却没经 `set-stage done` 收口，pane 还开着：对每条重跑它给出的 `set-stage` 命令。

### 2. 新需求或 Bug 入队（仅当用户给出新任务时）

按任务类型选入口：

| 任务类型 | 初始 stage | 首条投递命令 |
| --- | --- | --- |
| 大需求 / Epic | `epic` | `/to-epic <目标与上下文>` |
| 明确单个 MMF | `spec` | `/to-spec <MMF 与上下文>` |
| 已有 Spec 待拆票 | `tickets` | `/to-tickets <Spec 坐标>` |
| 已有票或既有 map | `pipeline` | `/delivery-pipeline-herdr <map 或 Epic 坐标>` |
| Bug 修复 | `bugfix` | `/dimon-mode 按 playbooks/bug-fix.md 复现并修复：<现象与坐标>` |
| `small` | `bugfix` | `/dimon-mode 按「判定规模」一节确认 scope:small，再按 playbooks/small-change.md 实现：<现象与坐标>` |

规模判定见 [`dimon-mode` 的「判定规模」](../dimon-mode/SKILL.md#判定规模)。

入队动作：

1. 在目标仓库为任务创建隔离 worktree，并通过 `place` 在所属 Epic 的 workspace 落位。Epic 还没有 workspace 时 `place` 用 `--workspace-label` 新建；每 tab 最多 4 pane、2×2 均分，workspace / tab / pane 自动命名：
   ```bash
   node scripts/autopilot.js place \
     --epic <Epic key> --cwd <任务工作树根目录> --issue <issue key 或 URL> \
     --tab-prefix "<中文简写[ 英文]>" --pane-label "<中文简写[ 英文]>" \
     [--workspace-label "<中文简写[ 英文]>"] [--exclude-tab <coord_tab_id>]
   ```
2. 在返回的 `pane_id` 按模型配置启动 Agent（名称遵循 `[a-z][a-z0-9_-]{0,31}`）。harness、model、effort 只由 `launch` 从 `~/.config/delivery-pipeline/model-roles.json` 解析，不手写 `herdr agent start`：
   ```bash
   node scripts/autopilot.js launch --stage <stage> --agent <agent_name> --pane <pane_id> [--task <任务类型>]
   ```
   `epic` / `spec` / `tickets` / `pipeline` 默认用 `planning` 项；`bugfix` 必须显式 `--task`（如 `backend`、`frontend`）。能力探测不到所配模型时 `launch` 失败，按报错修配置或升级给用户，不换 harness 绕过。
3. 登记 lane（`--pane` 只接受经 `launch` 启动的 pane，账本冻结其 harness 与模型；`--pane` 必带可视化 `--label`，脚本自动补齐 `<Issue号>` 并校验宽度；落入共享四格 worker tab 时加 `--keep-tab-label` 保留 tab 名），登记成功后再投递首条命令并挂事件 watcher：
   ```bash
   node scripts/autopilot.js register \
     --id <lane_id> --issue <issue key 或 URL> --repo <repo_path> --stage <stage> \
     --agent <agent_name> --pane <pane_id> --workspace <ws_id> --epic <Epic key> \
     --label "<中文简写[ 英文]>" [--keep-tab-label] \
     --worktree <任务工作树根目录> --base <实际合入的本地分支名>
   node scripts/autopilot.js watch --id <lane_id> --thread <当前 T3 线程 ID>
   herdr agent prompt <agent_name> "<首条命令>"
   ```

只读任务使用 `--pane-only` 代替 `--worktree` 和 `--base`。写任务在新建的任务工作树根目录启动 pane。

`--issue` 写本 lane 服务的 Epic、Spec 或 ticket，缺了 register 直接失败。`--epic` 写它所属的 Epic；lane 本身就是 Epic 或无 Epic 的 Bug 时省略，脚本以 `--issue` 为 Epic，这个 lane 也就独占一个 workspace。`register` 通过后脚本会自动把该 issue 及尚未开始的 Linear 父链（Spec / Epic）置为 `In Progress` 并回读确认，失败或 issue 已处终态时拒绝登记。Bug 没有 issue 时，先按目标项目的调试闭环建单再登记；没有建单授权就 escalate。首条命令带上同一坐标，Epic 下的 MMF 写成 `/to-spec <Epic URL> <MMF 标识>`。lane 新建的 Spec 和 ticket 必须是该 issue 的原生子项：Spec 由 to-spec 读回 `--parent` 核对，ticket 由 to-tickets 读回父子关系。正文链接只算 related，不算挂上。

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
  `delivery-pipeline-herdr` 或 `bugfix` 已完成验收并等待人类合入时（脚本同步把直接 issue 推进至 `In Review` 并回读）：
  ```bash
  node scripts/autopilot.js set-stage --id <lane_id> --stage awaiting_merge
  ```
- **流水线内子票状态**：
  `pipeline` lane 里 Spec 与各票的 Linear 状态由 delivery-pipeline Driver 自动推进，总控不手工同步。Driver 报同步失败时按 escalate 处理；修复后补一次 `node scripts/autopilot.js sync-issue --issue <key> --target <started|review|done>`。
- **用户答复已升级项后**：
  将用户的拍板原文转发给对应 `agent_name`，并调用 `node scripts/autopilot.js resolve --id <lane_id>` 恢复自动巡检。

### 4. 验收和清理

用户发话的回合也检查 `awaiting_merge`。确认交付已验收、PR/MR 已合入并更新对应的本地合入分支后，执行下列命令。只读任务在结果已交付后执行。Herdr 的 idle/done 只能作为检查交付结果的信号。

```bash
node scripts/autopilot.js set-stage --id <lane_id> --stage done
```

脚本核对已登记的 pane 和 agent、任务工作树归属、工作树洁净状态和 Git 祖先关系，依次回收工作树、本地任务分支、pane，随后把直接 issue 置为 `Done` 并回读确认，全部通过才写入 `done`（父项 Epic/Spec 保持只读不自动关闭）。只读任务（`--pane-only`）只关闭 pane，默认不关闭 issue。若该 issue 因外部部署或线上验收门暂不能关闭，显式传 `--keep-issue-open --reason "<原因>"`（脚本保持其为 `In Review` 并记录原因）。工作树要留作证据，或 squash 后证明不了已合入时，传 `--keep-tree --reason "<原因>"`：脚本保留树和分支，照常关 pane。不手改账本把 lane 写成 `done`。任一步失败即进入 `escalated`，排除原因后重试同一命令即可幂等续跑。旧账本缺少所有权、squash/rebase 后无法证明祖先关系时保留现场并上报。

### 5. 汇报收口

只输出本轮 `poll` 报出的项；`unchanged` 里等人的 lane 只在 `poll --full` 的回合重列：

- 本轮自动推进的 lane（`lane_id`、`issue`、动作、当前 stage）。
- `escalated` 队列：每条给「卡点 + 推荐选项 + 理由」，方便用户一句话批复。
- `awaiting_merge` 队列：PR/MR 坐标与验收状态。
- 用户在任意终端直接运行 `herdr` 即可查看并随时接管所有会话。

Milestone 收口后接着派下一个 Milestone，不等用户催。若总控上下文已很大，先交接到新总控线程：交接摘要写账本位置、活跃 lane 和待办，新线程首轮跑 `poll --full`。不在同一线程无限续跑。

## 上下文预算

- 总控不读源码和完整 diff，只读 lane 的交付摘要与账本。
- `herdr agent read` 只读有限尾部行。不 `ls` / `cat` 账本 lanes 目录或大日志。
- 不整份打印工具清单。

## 事件唤醒

`watch` 先于首条 `herdr agent prompt` 执行，一条 lane 只订阅一次。它把 lane 当前状态记成基线，并保证当前 T3 线程有一个哨兵进程在跑。哨兵每 15 秒在本机巡检一次本线程订阅的 lane：状态没变不发消息，变了才经 T3 注入的 `$T3CODE_CLI_PATH thread send` 发一条 `[herdr-autopilot WAKE]`，正文带巡检结果。同一状态只唤醒一次；lane 进入 `done` 或 `awaiting_merge` 后退订。订阅的 lane 全部退订后哨兵自己退出。lane 退订后又恢复执行（例如 `awaiting_merge` 收到修改意见），重新执行 `watch`。

- 不给巡检建 `schedule_task`、cron 或任何定时巡检。
- 哨兵叫不醒线程时发一条 macOS 系统通知，并写进 `watch` 输出里的日志路径；看到通知就回总控线程跑 `poll --full`。
- 唤醒通道断了（`watch` 报缺少 T3 环境、收到系统通知、lane 在动却长时间没有 WAKE）：告诉用户，改由用户发话驱动巡检。仍不建定时巡检。
