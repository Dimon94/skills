# pi-loop 技术设计

Status: implemented（2026-10-25，pi 1.4.0，Node 22）

本文件记录 pi-loop 的结构、状态模型、调度规则、取舍与验证证据。需求与验收标准归 repo://docs/pi-loop/prd.md；使用方法归 repo://skills/pi-loop/SKILL.md。

## 1. 结构

```text
skills/pi-loop/
├── SKILL.md            使用合同
├── package.json        只声明 "type": "module"
├── lib/                pi 扩展目录（安装时整个目录被 symlink）
│   ├── index.js        pi 接入层：命令、工具、事件、状态行
│   ├── runtime.js      调度状态机：宿主与时钟靠注入
│   ├── command.js      /loop 参数解析
│   ├── state.js        循环形状、严格解码、结算与恢复规则
│   └── schedule.js     间隔、cron、下一轮时刻：纯函数
├── scripts/install.js  契约脚本：install / --check / --uninstall
└── tests/              node:test，宿主与时钟替身在 fake-host.js
```

依赖单向：`schedule` ← `state` ← `command`、`runtime` ← `index`。只有 `index.js` 碰 pi API 与真实时钟；其余模块可在 Node 里直接测试。无第三方依赖；工具参数用 pi 宿主提供的 `typebox`。

## 2. 状态模型

一个循环的持久字段：

| 字段 | 含义 |
| --- | --- |
| `id`、`name` | 自增编号；名字匹配 `state.js` 的 `NAME_PATTERN` |
| `prompt`、`promptKind`、`filePath` | 提示词与种类 `text` / `file` / `command`；`file` 存绝对路径，触发时再读 |
| `mode` 与 `everyMs` 或 `cron` | `interval` / `cron` / `auto`；cron 存解析后的 5 个取值集合 |
| `status` | `idle`（等下一轮）或 `dispatched`（本轮已发出） |
| `nextAt` | 下一轮时刻；派发后与暂停时为 `null` |
| `fires`、`misses` | 已触发次数；`auto` 连续漏调 `loop_next` 的次数 |
| `createdAt`、`expiresAt`、`maxFires` | 生命周期；`expiresAt` 缺省为创建后 7 天 |
| `paused`、`pauseReason` | 暂停标志与原因 |

持久化方式：每次结构变化，`runtime.js` 调用 `pi.appendEntry("pi-loop-state", { version: 1, loops })` 追加一条会话条目。该条目类型为 `custom`，不进模型上下文，也不在界面渲染。恢复时取当前分支（`sessionManager.getBranch()`）上最后一条。

解码规则（`state.js` 的 `decodeState`）：

- 版本不符或结构不对：整份拒绝，不恢复任何循环，报错。
- 单条字段不合法、id 或名字重复：丢弃该条，其余照常恢复，提示丢弃数量。
- `maxId` 覆盖被丢弃的条目，新循环不复用它们的 id。

## 3. 调度状态机

```text
            create（cron 除外：nextAt = now）
                 │
                 ▼
   ┌────────► idle ──到点且会话空闲、无排队──► dispatched
   │           ▲                                   │
   │           │ settle：算下一轮                   │ agent_settled
   │           └───────────────────────────────────┤
   │                                               ├─ Esc 中断 ─────────┐
   │ resume（从当前时刻起算一个周期）               ├─ 30 秒未开工 ──────┤
   │                                               ├─ auto 连漏 2 次 ───┤
   └──────────────────── paused ◄──────────────────┴─ 文件读不了 ──────┘

   任一状态 ──stop / --max 到数 / 超过 expiresAt / cron 一年无匹配──► 删除
```

关键规则（`runtime.js`）：

- 单计时器：只为最早的 `nextAt` 起一个计时器。真实时钟按 60 秒分片，每片醒来按当前时间重算。
- 派发前检查：`ctx.isIdle()` 为真、`ctx.hasPendingMessages()` 为假、没有 inflight。不满足时 5 秒后再看。
- 先占 inflight，再读提示词文件，再写状态（`fires + 1`、`dispatched`），最后发送。崩溃最多丢一轮，不会重发。
- 发送：`pi.sendUserMessage(prompt, { deliverAs: "followUp", expandPromptTemplates: promptKind === "command" })`。只有斜杠提示词走展开。
- 开工确认：收到 `agent_start` 视为开工。30 秒看门狗未见开工就暂停。`sendUserMessage` 的异常由 pi 吞掉、转为 `emitError`，所以看门狗是唯一可靠的失败信号。
- 结算：收到 `agent_settled` 时只结算 inflight 的那一轮。`aborted` 为真就暂停。否则按 `settleLoop` 依次检查 `--max`、cron 无匹配、超过 `expiresAt`，再写入下一轮时刻。
- 下一轮时刻：`interval` 为结束时刻加 `everyMs`；`cron` 为结束时刻之后的第一个匹配；`auto` 采用本轮 `loop_next` 给的时刻，没给就用结束时刻加 20 分钟。
- 恢复（`resumeLoop`）：未到点的空闲循环保留原 `nextAt`；`dispatched` 或已过点的从当前时刻起算一个周期；暂停的保持暂停。

## 4. pi 接入点（`index.js`）

| pi 接口 | 用途 |
| --- | --- |
| `registerCommand("loop")` | 解析参数；非 TUI 模式拒绝，并在无 UI 的模式下写 stderr；校验斜杠提示词（`getCommands()` 中 `source === "extension"` 拒绝，`skill:` 找不到报错） |
| `registerTool("loop_next")` | `delay` 或 `reason`；只在 `auto` 循环触发的那一轮有效 |
| `registerTool("loop_status")` | 循环列表与最近 5 条事件 |
| `session_start`、`session_tree` | TUI 模式下重绑：detach，再按当前分支 attach |
| `before_agent_start` | 循环触发的轮次注入一条 `pi-loop-guidance` 自定义消息（`display: false`），告诉模型是否要调 `loop_next` |
| `agent_start` / `agent_settled` | 开工确认 / 本轮结算 |
| `session_shutdown` | 停计时器，清状态行刷新 |
| `ui.setStatus("pi-loop")` | 状态行，30 秒刷新一次倒计时 |

## 5. 取舍

**自建，不采用第三方包。** `@pwguler/pi-loop` 缺自定节奏，补上要改它的调度核心与状态格式，等于分叉维护。`pi-cc-loop` 的命令由模型解析，坏状态照常运行，且发版不跑测试，与 PRD 的 G2、G3 冲突。自建约 1000 行，无依赖，测试覆盖调度核心。命令解析参考了 pwguler 的首尾选项写法。

**状态存在会话条目，不存仓库文件。** 两个第三方包都把状态写进项目目录，并信任别人提交进仓库的文件：pwguler 用 `.pi-loop/loops.json`，pi-cc-loop 在 `createdInProject` 缺失时 `ownsProject()` 直接返回 true。会话条目属于用户本机的会话记录，天然跟随分支与 fork。代价是循环不能跨会话共享。这与非目标一致。

**固定间隔从结束时刻起算，不按墙上时钟对齐。** 一轮跑 40 分钟、间隔 5 分钟时，对齐写法会在结束后立即连发；本设计保证两轮之间至少空一个间隔。代价是触发时刻会随每轮耗时漂移；需要准点用 cron。

**失败一律暂停，不重试。** Esc、未开工、连漏 `loop_next`、文件读不了都转入暂停并通知，由用户 `/loop resume`。自动重试会在鉴权过期、模型未配置时每轮重复失败、消耗额度。

**`auto` 漏调一次兜底，两次暂停。** 一次漏调多半是模型遗忘，按 20 分钟兜底能保住长跑任务。连续两次说明提示词或 skill 不配合，继续猜节奏没有依据。

**延迟越界报错，不夹紧。** `loop_next` 给 30 秒或 3 天时返回错误，让模型改值。静默夹紧会让模型以为节奏已按自己的意图生效。

**只在 TUI 调度。** print 模式一次性退出，rpc/json 由上层程序驱动，子 agent 会话共享扩展但不应自行派生循环。

## 6. 安装与回退

`scripts/install.js` 管理唯一的注册点 `<扩展目录>/pi-loop`，它是指向 `skills/pi-loop/lib` 的目录 symlink。pi 加载器会跟随扩展目录下指向目录的 symlink，并加载其中的 `index.js`。安装与卸载边界沿用 repo://docs/adr/0003-skill-owned-agent-hooks.md 第 2、4 节：写全局目录前取得用户授权；拒绝覆盖非 symlink；卸载只删指向本 Skill 的链接；删除 Skill 前先卸载。

状态格式变更时提升 `STATE_VERSION`。旧版本条目整份拒绝并提示，不做隐式迁移。

## 7. 验证

单元与状态机：`node --test skills/pi-loop/tests/*.test.js`，13 项通过。

消融：逐个注入下列错误实现，各被至少一条测试抓到，恢复后 13 项全过。

| 注入的错误 | 抓到它的测试文件 |
| --- | --- |
| 忽略 `loop_next` 给的时刻 | runtime |
| 会话忙或有排队消息时仍派发 | runtime |
| 恢复后立即补跑 | runtime |
| 暂停状态不落盘 | runtime |
| 去掉看门狗 | runtime |
| 固定间隔按墙上时钟对齐 | schedule、runtime |
| cron 返回当前分钟（指针重复） | schedule |
| 日与周同时受限时取交集 | schedule |

端到端（2026-10-25，pi 1.4.0 TUI，tmux 驱动，`gpt-6.1-sol`，`-ne -ns -nc` 隔离其他扩展、skill 与上下文文件）：

```bash
pi -ne -ns -nc -e skills/pi-loop/lib --skill <含 ping skill 的目录> \
   --session-dir /tmp/pi-loop-e2e/sessions --tui-mode regular
```

| 步骤 | 观察 |
| --- | --- |
| `/loop help`、`/loop 5x foo`、`/loop 1m /skill:nope 测试`、`/loop 1m /loop list` | 帮助正常；三条拒绝信息各自给出原因与改法 |
| `/loop auto --name=ping --max=2 …` | 立即跑第一轮，模型调用 `loop_next delay="60"`，状态行 `loop 1 · ping 42s`；60 秒后第二轮；随后停表“已跑满 --max 2 次” |
| `/loop 1m --name=sk --max=3 /skill:ping` | skill 展开后执行，回复 `PING-OK` |
| `/quit` 后用 `--session` 重新打开 | 提示“恢复 1 个循环：sk”，60 秒后按时触发 |
| `/loop 5m --name=esc …` 运行中按 Esc | 提示“esc 已暂停：本轮被 Esc 中断” |
| `pi -p "/loop 5m 检查"` | 被扩展接管，stdout 为空，stderr 一行说明只在 TUI 可用；json 模式 stdout 仍只有合法 JSON |
| 会话 JSONL | 每轮依次为 `dispatched` 状态条目、用户消息、`display: false` 的 guidance、回复、`idle` 状态条目 |

安装器：在临时 `PI_EXTENSIONS_DIR` 下验证 missing → install → installed → 重复 install 幂等 → uninstall；真实目录、指向别处的链接均拒绝改动；未知参数退出码 2。

## 8. 已知限制

- print 与 json 模式下 `/loop` 被扩展接管后写一行 stderr 说明原因，但退出码仍是 0：pi 把命令处理器的异常转成 `emitError` 吞掉，扩展无从影响退出码。脚本化调用会把拒绝当成成功。
- `agent_start` 按顺序认领：循环刚派发、用户恰好同时手动发消息时，开工确认可能认错轮次。影响仅限看门狗与结算归属。
- 恢复 `auto` 循环时没有 `loop_next` 时刻可用，按 20 分钟兜底；要立即跑用 `/loop run`。
