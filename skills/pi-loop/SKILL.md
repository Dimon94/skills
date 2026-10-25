---
name: pi-loop
description: 在 pi 里按节奏重复跑同一条提示词或 skill（/loop）。用户要在 pi 中定时轮询、按间隔或 cron 重复任务、让 issue-sweep 这类 skill 自定节奏持续跑，或安装、排查、卸载 pi-loop 扩展时使用。
---

# pi-loop

pi 没有内置 `/loop`。本 Skill 自带一个 pi 扩展，提供 `/loop` 命令与 `loop_next`、`loop_status` 两个工具。循环状态存在当前会话记录里，不写仓库文件。

## 安装

安装会在 `~/.pi/agent/extensions/pi-loop` 建一个指向本 Skill `lib/` 的 symlink，pi 启动时会执行这份代码。先取得用户明确授权，再运行：

```bash
node skills/pi-loop/scripts/install.js            # 安装
node skills/pi-loop/scripts/install.js --check    # 只读检查：installed / missing / drift
node skills/pi-loop/scripts/install.js --uninstall
```

`PI_EXTENSIONS_DIR` 可覆盖扩展目录。安装或卸载后，在 pi 里运行 `/reload`。删除本 Skill 前先卸载。

## 用法

`/loop` 只能由用户在 pi 交互会话（TUI）里输入。模型不能新建循环。用户想重复做某件事时，给出对应命令，由用户自己输入：

| 场景 | 命令 |
| --- | --- |
| 模型自定节奏地持续扫票 | `/loop auto /skill:issue-sweep wip=2` |
| 每 5 分钟看一次 CI，最多 12 次 | `/loop 5m --max=12 检查 CI 状态，失败就报原因` |
| 工作日 9 点出日报 | `/loop cron 0 9 * * 1-5 @docs/daily-prompt.md` |
| 查看、暂停、恢复、立即跑、停止 | `/loop list` · `/loop pause <名>` · `/loop resume <名>` · `/loop run <名>` · `/loop stop <名>` |

完整语法运行 `/loop help`。

## 在循环轮次里

循环触发的每一轮，扩展都会在上下文里注入一条以 `[pi-loop]` 开头的说明。照它执行：

- `auto` 循环：本轮结束前必须调用一次 `loop_next`。还要继续就给 `delay`，纯数字按秒，范围 60 到 86400，也接受 `15m`、`2h`。事情已经做完、不用再查，就给 `reason`，写一句理由。
- 固定间隔与 cron 循环：不要调用 `loop_next`。
- 本轮做不完时，交代进度后结束本轮。下一轮会重新收到同一条提示词，不要在一轮里自己睡眠或轮询。

## 排查

先调用 `loop_status`，或让用户运行 `/loop list`。两者都会列出每个循环的状态与最近 5 条事件。

循环遇到下列情况会暂停，不会自己恢复。原因修好后，由用户运行 `/loop resume <名>`：

| 暂停原因 | 处理 |
| --- | --- |
| 本轮被 Esc 中断 | 确认要继续再恢复 |
| 消息发出 30 秒内没有开工 | 检查模型、鉴权，或斜杠提示词是否被别的命令吃掉 |
| 连续 2 轮没调 `loop_next` | 检查 skill 是否要求调用；必要时改用固定间隔 |
| 提示词文件读不了 | 文件需存在、非空、不超过 64KB |

其他边界：

- 只在 TUI 会话里调度。print、json、rpc 模式与子 agent 会话不恢复也不触发循环。非 TUI 模式输入 `/loop` 会收到一行 stderr 说明，但退出码仍为 0。
- 同一会话同一时刻只跑一轮。会话忙或有排队消息时让路，空闲后再跑。
- 停机期间错过的轮次不补跑。重新打开同一会话后，中断的那一轮从打开时刻起算一个周期，未到点的循环保持原时刻。
- 循环跟着会话与分支走。`/tree` 切到别的分支后，以那条分支上记录的循环为准。
- 未写 `--until` 的循环 7 天后自动停止。
