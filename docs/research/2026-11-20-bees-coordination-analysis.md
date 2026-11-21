# Bees 并发协调机制与资源控制分析

日期：2026-11-20。性质：只读调查记录，不是决策。结论里的建议待 Dimon 审定后才进入 ADR 或配置。

## 0. 证据基线

| 对象 | 版本 / 坐标 |
|---|---|
| CrommaCode | 0.3.34（`/Applications/CrommaCode.app/Contents/Info.plist`） |
| bees 二进制 | `/Applications/CrommaCode.app/Contents/MacOS/bees`，5.3 MB，sha256 前缀 `242b31837af43e04` |
| strings 导出 | `strings -n 6 <bees> > /tmp/bees-strings.txt`，2238 行；下文 `S:<行号>` 指此文件 |
| bees 手册 | `~/.cromma-bees/bin/bees manual > /tmp/bees-manual.md`，59 行，"bees manual v3"；下文 `M:<行号>` |
| 运行环境 | `~/.cromma-bees/`（config.json、worker-home、hives） |
| Claude Code / pi | 2.1.329 / 1.5.2 |
| 我们的配置 | `~/.config/delivery-pipeline/model-roles.json` v7；校验器 `delivery-pipeline/skills/delivery-pipeline-setup/scripts/model_config.py`（delivery-pipeline HEAD `78d0a3b`） |
| pi-subagents | `/Users/dimon/.pi/agent/npm/node_modules/pi-subagents` |
| 机器 | 48 GB RAM |

样本限制：hives 下只有 ads-decision-system 的两个 hive（`ads-decision-system-1795177824-1`、`ads-decision-system-1795179628-4`）有完整日志，共 8 只 bee。**8 只 bee 全部跑在 JUNBO `gpt-6.2-sol` 上，没有一只跑过 DeepSeek / kimi / glm。** 因此"小模型在 bees 下不发散"目前没有运行证据，下文凡涉及小模型效果的结论都是推断。

## 1. 机制概述

bees 是 queen（主 agent）调用的命令行派发器。queen 拆 slice、写 brief、派 bee、合并、跑门禁；bee 只写一个 slice。

1. **角色分工**：queen 不写 slice（M:5）。每只 bee 是一个 headless `claude -p` 进程，跑在 `.claude/worktrees/bee-<name>` 工作树、`bee/<name>` 分支上（M:6），从当前 HEAD 分出（M:49）。
2. **命令面**（S:815-845）：
   - `bees fly <name> <brief.md> [--turns N] [--provider ID]`：飞一只。
   - `bees swarm <dir> [-p N] [--turns N] [--provider ID]`：并行飞一个目录的 brief，"re-flies once any bee that did not commit"（S:1111）。
   - `bees merge` / `drop` / `status` / `gateway` / `hook` / `key` / `wire` / `skill`。
   - fly/swarm 阻塞 5–30 分钟（M:22）。
3. **拆分规则**（M:33-35）：按 module 与 contract 切；两个 slice 不碰同一文件；contract 两端放同一 slice；按 wave 排序，一个 wave 只依赖已合并的 wave。
4. **brief 规则**（M:38-44）：一段目标、确切文件清单、要照抄的模式文件、验收命令、禁止项；首行是标题。
5. **门禁与恢复**：
   - 合并用 `merge --no-ff`，遇冲突停（M:52）。
   - 每个 wave 合并后 queen 跑 build/typecheck/lint，"Bees do not run heavy builds"（M:53）。
   - 门禁红：queen 写 fix brief、贴错误、飞 fix bee；三轮仍红则 queen 自己修（M:54）。
   - 运行时恢复：没有 commit 的 bee 重飞一次（S:316-317 "re-flying … bee(s) without a commit"）；进程消失或出错记为 `lost`（S:1065 "lost: worker process vanished"、"lost: run ended with an error"）。
6. **本地 gateway**：fly 时启动，监听 `127.0.0.1`（S:815-845 "(started by fly) serve the local model gateway on 127.0.0.1"）。
   - 端点：`POST /lease`、`/v1/messages`、`/v1/messages/count_tokens`、`/health`（S:181、S:904）。
   - 只认自己的启动 token（S:904 "this gateway takes only its own launch token"），空闲超时自动退出（S:55）。
   - 协议转换：Anthropic ↔ openai_chat ↔ openai_responses（S:843）。Route 结构含 `model small_model effort max_output`（S:882）。剥离 `<think>`/`<thinking>` 标签（S:902）。
   - provider 错误分类 `Blank BadKey Credit NoModel Limited Unreachable Timeout` 与 `resets_at`（S:927、S:908）。推断：这些分类驱动"按 Settings 优先级依次尝试 provider"（S:815-845 "providers are tried in their priority order … --provider pins one, no fallback"）。

## 2. 术语映射

| bees | 本仓已有概念 | 映射说明 |
|---|---|---|
| queen | `coordinator`（`model_config.py:15-27` 的 TASK_TYPES） | 同一职责：拆分、派发、集成、门禁。queen 不写 slice（M:5），与我们 coordinator 只集成一致 |
| bee | worker / 子代理 | 一次性执行者，不保留会话。我们没有对应的 GLOSSARY 词条 |
| wave | 波次（`skills/to-tickets/SKILL.md:19`："波次 / 关键路径：依赖图的层与最长链。同一波可以并发"） | 完全同义。bees 多一条硬约束：wave 只依赖**已合并**的 wave（M:35） |
| slice | ticket / 垂直切片（`GLOSSARY.md:107`、`:111`） | 粒度近似 ticket，不是 ticket 之下的子层。证据：`jb226` 一只 bee 对一张 JB-226；`jb218-jb220-audience`、`jb74-jb76-business`、`jb261-jb262-monitoring` 一只 bee 合并多张票（hive 目录名）。bees 额外要求 slice 文件不相交（M:34），对应我们的合同票前移规则（`skills/to-tickets/SKILL.md:28`） |
| brief | 子代理任务文本 | 我们没有固定格式。bees 的 brief 是有结构的任务合同（M:38-44） |

**Epic→MMF→ticket 如何嵌入并发层**：不需要新增第四层。实测里 slice 与 ticket 是 1:1 或 1:N（多票并一只 bee），没有出现 1 张票拆成多只 bee。推断的嵌入方式：

```
Epic → MMF → ticket（to-tickets 产出，带 Blocked by）
                └─ wave = 依赖图的一层（to-tickets 已定义）
                     └─ brief = 一张或几张文件不相交的 ticket 的派发合同
```

"8–10 bee per ticket" 与 bees 的实际用法不符：bees 的并发发生在**同一 wave 的多张票之间**，不是一张票内部。

**GLOSSARY 是否加 coordinator/worker**：现在不加。`GLOSSARY.md:11` 的入门规则要求"代码或运行状态已表达 + 需求或 ADR 确认 + 不是同义词"。`coordinator` 只在 delivery-pipeline 的校验器里出现，本仓没有代码或 ADR 用它；`worker` 没有任何本仓代码表达。若后续采纳第 7 节的 brief 模板，再把 **brief**（派发合同）作为唯一新词条提出，queen/bee 仍用 coordinator/子代理表达。

## 3. 配置扩展设计

### 3.1 bees 的两个值放在哪

- `~/.cromma-bees/config.json:107` `"max_turns": 80`、`:108` `"parallel": 10`。两者是**全局顶层键**，不按 provider 区分。
- 每次调用可覆盖：`--turns N`、`-p N`（S:815-845）。
- 实测 queen 会按 brief 调小轮次：`ready-jb218-ci` 的 meta 记 `max_turns` 18，`jb220-ci` 记 22，其余 80（各 bee 的 `meta.json`）。
- 实测并发只有 5：wave-4 的 5 只 bee `started_at` 都是 `1795185324`，两只 ci bee 之后串行（`ads-decision-system-1795179628-4/*/meta.json`）。

| bee | turns / 上限 | 时长 s | cost $ | 上下文峰值 tokens | 结果 |
|---|---|---|---|---|---|
| jb226 | 40/80 | 409 | 2.81 | 51,849 | success |
| ready-jb218-ci | 19/18 | 141 | 0.56 | 31,425 | `error_max_turns`，exit 1 |
| jb218-jb220-audience | 63/80 | 884 | 6.96 | 98,018 | success |
| jb219-report-replay | 53/80 | 697 | 2.83 | 61,867 | success |
| jb220-ci | 9/22 | 197 | 1.45 | 41,029 | success |
| jb261-jb262-monitoring | 72/80 | 1014 | 7.58 | 112,822 | success |
| jb74-jb76-business | 80/80 | 1165 | 8.69 | 128,397 | success（打满轮次） |
| jb84-build-receipt | 72/80 | 987 | 8.98 | 121,522 | success |

来源：各 bee 的 `log.jsonl` 最后一条 `result` 事件（`num_turns`、`duration_ms`、`total_cost_usd`、`subtype`）与逐条 `usage`。8 只合计 $39.86。

结论：80 轮对 ticket 粒度偏紧，8 只里 4 只用到 72 轮以上。

### 3.2 我们的 v7 缺什么

- `model-roles.json` v7 的 `work.*` 单元格恰好是 `{agent, model, effort, fallbacks}`（`model-roles.json:3-34`）。校验器 `_cell_errors` 拒绝多余键（`model_config.py:82-93`）。
- 顶层必须恰好是 `{version, work, modes, review}` 加 v7 的 `model_families`（`model_config.py:193-199`）。
- 所以加任何并发或轮次字段都必须升 version 并改校验器。

### 3.3 建议结构（推断，待审定）

并发是机器与派发器的属性，不是某个模型角色的属性；轮次是 brief 的属性，按任务调整（bees 自己也是全局默认 + 单次覆盖）。因此不进 `work.*` 单元格，新增一个顶层键：

```json
{
  "version": 8,
  "work": { "...": "不变" },
  "modes": { "...": "不变" },
  "review": { "...": "不变" },
  "model_families": {},
  "dispatch": {
    "parallel": 4,
    "max_turns": 100
  }
}
```

- `parallel` 默认 4：与 pi-subagents `parallel.concurrency` 默认值一致（`pi-subagents/docs/configuration.md:552-562`，`src/shared/types.js:101` `MAX_CONCURRENCY=4`），也接近 bees 实测的 5。
- `max_turns` 默认 100：实测 80 有一半 bee 逼近上限。具体值需要更多样本，现为推断。
- 单次派发覆盖写在 brief 或派发参数里，不进配置文件。

**是否新增 `worker` role**：不建议。理由：

1. `work.*` 按任务类型分（backend/frontend/testing…，`model_config.py:15-27`）。`worker` 是执行形态，与任务类型正交。加进去会出现"frontend 的 worker 用哪个模型"的二义。
2. 降级模型的证据缺失：bees 实测全部用 `gpt-6.2-sol`，没有小模型样本（见 0 节）。
3. 若要试低成本模型，用现有结构即可：在某个 `work.<type>` 的 `fallbacks` 或 `modes` 里放 `deepseek-flash` / `gpt-6-luna` 单元格，effort 沿用该任务类型的现值。不需要新 role。

### 3.4 bee 的思考强度

bees 不设置思考强度：

- strings 里没有 `--effort`、`MAX_THINKING_TOKENS`、`CLAUDE_CODE_EFFORT`（各 0 次命中）。claude CLI 有 `--effort <level>`（`claude --help` 第 85 行），bees 没传。
- Route 结构有 `effort` 字段（S:882），但 `~/.cromma-bees/config.json` 的 12 个 provider 都没填 effort。
- 8 只 bee 的 `init` 事件只有 `model`，没有 effort 字段。

所以 bee 跑的是 Claude Code 对该模型的默认 effort。经 gateway 转发到 `gpt-6.2-sol` 时实际生效的档位 Unknown。

实测每只 bee 都有 thinking 块（3–33 个），但可见的 thinking 文本只有 109–2,005 字符（各 bee `log.jsonl` 的 assistant `thinking` 块）。上游可能只回传思考摘要，这个字符数不能当成推理量。

结论：bees 降成本靠窄任务和轮次上限，不靠降低思考强度。我们也不应把 bee 的 effort 设为 `low`。

## 4. 小模型防迷失

### 4.1 bees 实际用的约束

系统提示全文 7 句（S:1065-1072），逐条对应约束：

| # | 系统提示原句 | 约束 |
|---|---|---|
| 1 | "A queen agent wrote your brief and will merge your branch." | 角色锚定，bee 不做集成决策 |
| 2 | "Work only inside the current git worktree, and change only the files your brief names." | 工作树隔离 + 文件白名单 |
| 3 | "Before editing, read the nearest CLAUDE.md or AGENTS.md and the header comments of the files you touch. Follow the patterns already in the code." | 只读最近的规则，不读用户全局 |
| 4 | "Do not write tests unless the brief asks. Do not deploy. Do not push. Do not touch any other branch." | 禁止项 |
| 5 | "If the brief names a self-check command, run it and fix what it reports." | 单一自检命令作反馈环 |
| 6 | "When done, `git add` explicit paths and commit … Co-Authored-By: DeepSeek …" | commit 即完成信号 |
| 7 | "Your final reply is at most ten lines: what changed, what is unfinished, the risks." | 输出预算 |

系统提示之外的约束（任务里列出的之外，补充项）：

1. **commit 存在性是机器可判的完成标准**。swarm 只看有没有 commit，没有就重飞一次（S:1111）。模型自述不参与判定。
2. **`--max-turns` 硬上限**（S:1072 argv）。超限直接 `error_max_turns`（`ready-jb218-ci/log.jsonl` 的 result："Reached maximum number of turns (18)"）。
3. **重型构建上收到 queen**（M:53）。jb226 的 brief 也写了"重型构建留给主执行者"（`hives/ads-decision-system-1795177824-1/jb226/brief.md`）。
4. **slice 文件不相交、contract 两端同 slice**（M:34）。并发 bee 之间没有共享写目标，不需要协调。
5. **wave 只依赖已合并 wave**（M:35）。bee 看到的 HEAD 已含前置成果。
6. **三轮红门后 queen 接手**（M:54）。bee 失败的成本有上界。
7. **`.bees/rules.md` 追加到每只 bee 的系统提示**（S:1119、S:1135）。项目级规则的唯一注入口。ads repo 没有该文件。
8. **brief 带精确命令**。jb226 的验收命令连端口和 reporter 都写死：`cd frontend && PLAYWRIGHT_PORT=5186 bunx playwright test tests/country-distribution.spec.ts --project=workspace-source --workers=1 --reporter=line`（`jb226/brief.md`）。
9. **brief 禁止递归派发**："不要另建分支/worktree，不要合并、推送、建合并请求、请求发布、改 Linear、调用广告账户或再派代理"（`jb226/brief.md`）。

### 4.2 bees 没做的约束（与任务描述的预设不同）

- **工具没有收窄**。jb226 的 `init` 事件列出 22 个工具，含 `Task`、`WebFetch`、`WebSearch`、`Workflow`、`Write`（`jb226/log.jsonl` 第 1 行）。strings 里没有 `--allowed`（0 次命中）。防递归派发靠 brief 文字，不靠工具白名单。
- **技能不是零**。同一 `init` 事件有 17 个 skills，全部是 Claude Code 内建（deep-research、code-review、simplify、batch、loop 等），另有 3 个 builtin plugin。没有用户技能，因为 worker-home 是空的（第 5 节）。
- **没有用 `--bare`**（strings 0 次命中）。`claude --help` 里 `--bare` 会跳过 hooks、plugin sync、auto-memory 与 CLAUDE.md 自动发现；bees 选择保留 CLAUDE.md 发现。

### 4.3 实测的偏离

- **读了白名单外的上层规则**：jb226 第 28 步读了 `/Users/dimon/AGENTS.md` 等上层 AGENTS.md（`jb226/log.jsonl` tool_use 序列）。系统提示说"nearest"，模型读了整条链。
- **trailer 被项目规则覆盖**：jb226 的 commit `47910df1` trailer 是 `Co-Authored-By: Claude Code <noreply@anthropic.com>`，不是系统提示要求的 DeepSeek。推断：项目 AGENTS.md 的提交规范优先于追加的系统提示。
- **改动守住了白名单**：jb226 改 4 个文件 +65/-4，全部在 brief "可改文件"内。
- **轮次超限**：`ready-jb218-ci` 在 18 轮上限内没完成。

### 4.4 对比我们的子代理

任务预设"我们的 subagent：全技能池、用户 AGENTS.md、长 session context、可能改任意文件"，实际取决于走哪条路径：

| 约束 | bees | pi-subagents `worker` | herdr pi pane（delivery-pipeline） | T3 `delegate_task` |
|---|---|---|---|---|
| 技能 | 17 内建，无用户技能 | `inheritSkills: false`（`agents/worker.md`） | 全量：启动 argv 只有 `--approve --model --thinking`（`model_config.py:1480`），无 `--no-skills` | Unknown |
| 项目规则 | 最近 AGENTS.md | `inheritProjectContext: true` | 全量 | Unknown |
| 上下文 | 每只新 session（strings 无 `--resume`） | `defaultContext: fresh` | 新 pane | 无父历史（工具描述："No parent history"） |
| 工具 | 22 个，未收窄 | 白名单 `read, grep, find, ls, bash, edit, write, contact_supervisor` | 全量 | Unknown |
| 文件白名单 | brief 文字 + 系统提示 | 无固定机制 | 无 | 无 |
| 完成判定 | commit 存在 + 一次重飞 | 子代理返回 | 派发器状态 | 子代理返回 |
| 轮次上限 | `--max-turns` | `turnBudget {maxTurns, graceTurns}`（`pi-subagents/CHANGELOG.md:2349`），未配置 | 无（pi CLI 无 `--max-turns`） | Unknown |
| thinking | 由 gateway 路由 effort | `thinking: high` | 按 model-roles | 继承 |

差距排序：

1. **brief 合同缺失**（最大）。我们没有"文件白名单 + 模式文件 + 单一验收命令 + 禁止项"的固定格式。这是 bees 防迷失的主体，且与运行时无关。
2. **完成判定是自述**。`skills/implement/SKILL.md:50` 已规定"子代理自述不算通过"，但没有 commit 存在性这类机器检查。
3. **herdr pi pane 不瘦身**。`startup_request` 没传 `--no-skills`、`--no-extensions`、`--no-context-files`（`model_config.py:1454-1499`），196 个用户技能（`~/.agents/skills`）全部可见。
4. pi-subagents `worker` 在工具和技能上**已比 bees 更窄**；差在没配 turnBudget、thinking 默认 high。

## 5. 资源瘦身

### 5.1 bees 做了什么

| 手法 | 证据 |
|---|---|
| 独立 `CLAUDE_CONFIG_DIR=worker-home` | S:1072 env 常量；`~/.cromma-bees/worker-home` 7.9 MB，其中 `projects/` 7.8 MB 是 bee 会话转录；`.claude.json` 只有 firstStart、machineID 和 3 个 builtin plugin 使用记录；无 settings、skills、CLAUDE.md |
| 关闭非必要流量 | S:1072 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` |
| Bash 超时 | S:1072 `BASH_DEFAULT_TIMEOUT_MS=600000`，另设 `BASH_MAX_TIMEOUT_MS` |
| 本地 gateway | 127.0.0.1、launch token、空闲退出（S:55、S:904）。**注意：gateway 只做协议转换和路由，上游仍是云端 provider**。实测上游是 `https://ai-claude-code-hub.jetmobo.com`（`config.json` custom-1）。"不绕云端"不成立；成立的是"不经 Anthropic 官方端点"。`apiKeySource: none`（jb226 init） |
| 结构化输出 | `--output-format stream-json --verbose`（S:1072） |
| 独立进程 | 每只 bee 一个 `claude -p` 进程，meta.json 记 `pid` |
| 清理 | `worker-home/.last-cleanup` 存在，清理策略 Unknown |

### 5.2 bees 没做什么

- **无上下文上限**：strings 里 `autocompact` 0 次、无 `--max-budget-usd`。上下文峰值 128,397 tokens（jb74-jb76-business）。
- **无 session 复用**：strings 无 `--resume`。每只 bee 首个请求约 12k tokens 基线（jb226 首个 usage `input_tokens` 12,186）。
- **prompt cache 命中正常**：逐条 assistant 消息里的 `usage.cache_read_input_tokens` 都是 0，但每只 bee 最终 `type: result` 汇总的 `usage` 显示缓存读取 286K–7.27M tokens，命中率 71%–91%（`cache_read / (input + cache_read + cache_creation)`，9 次运行）。例：jb226 input 405,539、cache_read 1,188,352，命中 75%，$2.81；jb74-jb76-business input 876,977、cache_read 7,265,664，命中 89%，$8.69。推断：stream 事件里的逐条 usage 不带缓存字段，只有 result 汇总带。
- **worker-home 无大小上限**：没找到相关常量，Unknown。
- **工作树依赖不共享**：jb226 在新工作树里跑了 `bun install --frozen-lockfile`（log tool_use）。主仓 `node_modules` 904 MB、`frontend/node_modules` 16 MB。

### 5.3 8–10 并发会不会爆内存

实测进程常驻内存（`ps -o rss`）：pi 进程 180–282 MB / 个（7 个样本），`claude -p --output-format stream-json` 进程 210 MB。

推断：10 个 worker 进程约 2–3 GB，48 GB 机器不会因 agent 进程爆内存。真正的瓶颈依次是：

1. **每个工作树的依赖安装**：磁盘与 IO。按 ads repo 计，10 棵树全量安装接近 9 GB。
2. **浏览器测试**：每只 bee 跑 Playwright 会起 Chromium 与 dev server，单实例数百 MB 到 1 GB 以上（数值未实测，Unknown）。bees 靠"bee 不跑重型构建"回避（M:53）。
3. **端口冲突**：jb226 brief 写死 `PLAYWRIGHT_PORT=5186`。并行 bee 若用同一端口会互相干扰。bees 没有端口分配机制（strings 未见），靠 queen 写 brief 时人工错开。
4. **API 速率与成本**：缓存命中 71%–91% 时，实测每只 $0.56–8.98；10 并发即每波约 $5–90。

我们侧的并发闸门已存在：pi-subagents `parallel.concurrency` 默认 4、`maxTasks` 默认 8（`docs/configuration.md:552-562`），`globalConcurrencyLimit` 默认 20（`:479-487`），`maxActiveAsyncRunsPerSession` 默认不限（`:511-518`）。`~/.pi/agent/settings.json` 没有 subagents 配置，所以全部走默认。

## 6. 对比我们的 subagent

| 维度 | bees | 我们（pi-subagents / herdr / T3） | 谁更强 |
|---|---|---|---|
| 并发调度 | `-p N`，全局默认 10 | `parallel.concurrency`、`globalConcurrencyLimit`、`maxActiveAsyncRunsPerSession` | 我们（三层闸门） |
| 工作树隔离 | 每 bee 一棵树一条分支 | `subagent` 的 `worktree: true`；T3 `isolation: "worktree"`；本仓 `worktree.sh` | 持平 |
| 轮次上限 | `--max-turns` | pi-subagents `turnBudget`（未配置）；herdr pi 无 | bees（已默认开启） |
| 工具收窄 | 无 | worker 白名单 | 我们 |
| 技能/插件隔离 | 空 worker-home | worker `inheritSkills: false`；herdr 未隔离 | 视路径 |
| 任务合同 | 固定 brief 格式 | 自由文本 | bees |
| 完成判定 | commit 存在 + 重飞一次 | 自述 | bees |
| 多 provider | 本地 gateway 转协议，让 `claude` 跑非 Anthropic 模型 | pi 原生多 provider；magpie | 我们不需要 gateway |
| 失败升级 | 三轮红后 queen 接手 | `skills/implement` 有 R1-R3 循环 | 持平 |
| 可观测 | stream-json 日志、`bees hook` 追踪主 agent（`ads-decision-system-1795179628-4/trace.jsonl` 1576 行） | pi-subagents 运行产物与 status | 持平 |

## 7. 结论与建议

### Q1 术语映射

queen = coordinator，bee = 子代理，wave = 波次（`skills/to-tickets/SKILL.md:19` 已定义），slice ≈ ticket（1:1 或 N 票并一只 bee），brief = 派发合同。Epic→MMF→ticket 之下**不加第四层**：并发发生在同一波次的多张票之间。coordinator/worker **暂不入** GLOSSARY.md，因为不满足 `GLOSSARY.md:11` 的入门条件；若采纳 brief 模板，只新增 **brief** 一个词条。

### Q2 并发与轮次配置

bees 把 `parallel: 10`、`max_turns: 80` 放在 `~/.cromma-bees/config.json:107-108` 的全局顶层，单次用 `-p`/`--turns` 覆盖。我们应在 model-roles.json 加顶层 `dispatch: {parallel, max_turns}` 并升 v8，同时改 `model_config.py:193-199` 的顶层键校验。建议初值 `parallel: 4`、`max_turns: 100`（推断，实测 80 轮有 4/8 只逼近上限）。**不新增 `worker` role**：它与任务类型正交，且没有小模型样本证明降级可行；试验低成本模型用现有 `fallbacks` 或 `modes` 即可。

### Q3 小模型防迷失

bees 的防迷失主体是**任务合同 + 机器判定**，不是运行时：文件白名单、模式文件、单一精确验收命令、禁止递归派发、commit 即完成、轮次硬上限、重型构建上收、slice 文件不相交、wave 只依赖已合并成果、三轮红后接手。bees 没收窄工具，也加载了 17 个内建技能。我们的差距在 brief 合同和完成判定；工具与技能隔离上 pi-subagents `worker` 已更窄，herdr pi pane 是唯一未瘦身路径。小模型实际效果 Unknown：8 只样本全是 `gpt-6.2-sol`。

### Q4 资源瘦身与高并发内存

bees 的瘦身是空 `CLAUDE_CONFIG_DIR`、关非必要流量、Bash 超时、stream-json、独立进程、本地协议网关。它不限上下文、不复用会话；prompt cache 实测命中 71%–91%。进程内存约 210–280 MB / 个，8–10 并发约 2–3 GB，48 GB 机器不会因此爆内存。瓶颈是工作树依赖安装（ads repo 约 0.9 GB / 树）、并行浏览器测试、写死的端口、长轮次带来的 API 成本。

### Q5 是否写独立工蜂派发器

**不写。用 pi-subagents 现有能力 + 一份 brief 模板 + 一个 commit 检查。**

| 方案 | 工作量 | 收益 | 兼容性 |
|---|---|---|---|
| A. 自写 bees 式派发器 | 高：进程管理、工作树、重飞、日志、可能还要 gateway | 与 B 相同；gateway 对 pi 无用（pi 原生多 provider） | 新增第二套派发机制，违反 entropy-governance 的单一机制原则 |
| B. pi-subagents 自定义 agent + workflow | 低：一个 agent 定义 + 一个 workflow 脚本 + brief 模板 | 拿到 bees 的全部有效约束 | 复用现有闸门、工作树、turnBudget |
| C. 直接用 bees | 零开发 | 立即可用 | 只能驱动 `claude`；不进 delivery-pipeline 状态 |

B 的最小形态（推断，未实现）：

1. 自定义 agent：`inheritSkills: false`、thinking 沿用 model-roles 中该任务类型的 effort（现为 high）、工具白名单同 `worker`、`turnBudget: {maxTurns: 100}`、系统提示照抄 bees 7 句的语义（改为中文、trailer 改本仓格式）。
2. brief 模板：标题、一段目标、可改文件、模式文件、单一验收命令、禁止项（含"不再派代理"）、端口或资源占用。
3. workflow：`worktree: true` 并发跑同一波次的 brief；回收时检查分支上有无新 commit 与改动是否越出白名单，未提交的重飞一次；波次合并后由 coordinator 跑重型门禁。
4. herdr 路径若继续使用，`startup_request` 对 pi 补 `--no-skills --no-extensions`（`model_config.py:1480`）。

### 下一步

按 Q5 方案 B 落地：自定义 agent 定义、brief 模板与 commit 检查 workflow 作为一张实现票处理。模型沿用 model-roles 现有配置，不另做小模型对比测试。

## 附：未确认项

- 小模型在 bees 下的完成率与越界率：无样本，Unknown。
- 逐条 assistant usage 缓存字段为 0、result 汇总却有缓存读取的原因：推断是 stream 事件只带增量 usage，根因 Unknown。
- `worker-home/.last-cleanup` 的清理策略与上限：Unknown。
- T3 `delegate_task` 子线程是否加载用户技能与 AGENTS.md：Unknown。
- Playwright 并发的实际内存占用：未实测。
