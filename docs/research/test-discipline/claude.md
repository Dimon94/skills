# Claude Code：hook 输入与上下文注入探针

调查记录，观测日期：2026-10-16。范围：[票 #94](https://github.com/Dimon94/skills/issues/94)，对应 [Spec #93 第 7 节](https://github.com/Dimon94/skills/issues/93)。只记录 Claude Code，不定义 Skill 实现合同。

## 结论与适用范围

| 验收项 | 本次结论 | 证据位置 |
| --- | --- | --- |
| Write、Edit 输入与 cwd | 两者均有顶层 `cwd` 与 `tool_input.file_path`；具体形状见下文 | §Write、Edit 的真实输入 |
| PreToolUse additionalContext 的时机 | 模型在本次工具成功返回后首次复述新口令，不在本次写入前重新生成调用 | §PreToolUse 的时序 |
| SubagentStart additionalContext | 子 agent 自己复述了只由 hook 生成的口令 | §SubagentStart |
| MultiEdit 是否存在 | 本次本机默认工具清单没有 MultiEdit；其他配置下是否存在：Unknown | §MultiEdit |
| 是否推翻 #93 第 7 节 | 未发现冲突，不修改 spec，无新增确认项 | §与 Spec 的关系 |
| 隔离要求 | 脚本、配置、原始输出均在仓外；两次运行的全局 settings 内容不变 | §隔离与复验 |

`claude --version` 输出 `2.1.296 (Claude Code)`。请求 `--model sonnet --effort low`；两次 `system/init.model` 实际读回 `gpt-6-luna[1M]`，assistant 消息的 `model` 为 `gpt-6-luna`。本机模型映射经现有接入环境解析；后端真实身份为 Unknown，不把本次结果外推为 Anthropic 原生模型实测。

## 隔离与运行命令

原始工件根目录：`/tmp/claude-hook-94.pTsT2i`，下文记为 `$P`。macOS 将事件中的真实路径解析为 `/private/tmp/claude-hook-94.pTsT2i`。临时 git 仓为 `$P/repo`。

- `run.py`：只读现有 settings 中白名单内的认证、模型环境项，并通过子进程环境传入；不把凭据写入临时 settings、命令记录或本文。
- `CLAUDE_CONFIG_DIR=$P/config` 隔离运行状态；`--setting-sources ''` 排除 user/project/local settings。`--strict-mcp-config` 及空 `mcpServers` 排除已有 MCP；禁用 Skill 发现与会话持久化。内置插件仍出现在 init 中，不声称禁用了所有内置能力。
- `settings.json` 只注册探针。hook 记录 stdin、时间与目标文件状态，再回显随机口令；不拒绝、不改写工具参数。PostToolUse 只记录状态，不输出上下文。

本次实际执行：

```sh
P=/tmp/claude-hook-94.pTsT2i
python3 "$P/run.py" tools
python3 "$P/run.py" child
```

两次退出码均为 0；流末尾均为 `subtype=success`、`is_error=false`、`permission_denials=[]`。完整 argv 分别保存在 `$P/tools-command.json`、`$P/child-command.json`；提示词保存在同名前缀的 `*-prompt.txt`。认证值不在 argv 中。

`run.py tools` 的 Claude 命令如下。运行环境中的认证与模型映射由上述独立环境通道提供：

```sh
cd "$P/repo"
CLAUDE_CONFIG_DIR="$P/config" \
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
claude -p --settings "$P/settings.json" --setting-sources '' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --disable-slash-commands --no-session-persistence --no-chrome \
  --model sonnet --effort low --permission-mode dontAsk \
  --output-format stream-json --verbose --include-hook-events \
  --tools default --allowedTools Write,Edit,Read \
  -- "$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())' "$P/tools-prompt.txt")"
```

`child` 使用相同公共参数，将尾部改为 `--tools Task --allowedTools Task --agents '<定义>' --forward-subagent-text -- '<提示词>'`。自定义 `probe-child` 的定义为：

```json
{"description":"仅用于隔离口令回显探针","prompt":"只回复 CHILD_REPORT 以及上下文中真实出现的探针随机口令。不得读取文件或调用其他工具。","tools":[],"model":"sonnet"}
```

此定义作为 `{"probe-child": <定义>}` 传给 `--agents`。init 的工具名为 `Task`，实际 assistant `tool_use.name` 为 `Agent`，以原始流为准。

注册配置的关键片段（路径按本次临时目录展开）：

```json
{
  "hooks": {
    "PreToolUse": [{"matcher":"^(Write|Edit|MultiEdit)$","hooks":[{"type":"command","command":"python3 /tmp/claude-hook-94.pTsT2i/hook.py","timeout":5}]}],
    "PostToolUse": [{"matcher":"^(Write|Edit|MultiEdit)$","hooks":[{"type":"command","command":"python3 /tmp/claude-hook-94.pTsT2i/hook.py","timeout":5}]}],
    "SubagentStart": [{"hooks":[{"type":"command","command":"python3 /tmp/claude-hook-94.pTsT2i/hook.py","timeout":5}]}]
  }
}
```

hook 的输出核心如下；随机值在 hook 执行时才生成，不存在于初始提示词中：

```python
marker = name.upper() + '_' + secrets.token_hex(12)
output = {'hookSpecificOutput': {
    'hookEventName': name,
    'additionalContext': '探针随机口令：' + marker + '。下次生成回复时原样复述这条口令；不要读取探针文件。'
}}
print(json.dumps(output, ensure_ascii=False))
```

完整临时脚本只保存在 `$P/hook.py`、`$P/run.py`。原始 stdin 与探针输出保存在 `$P/events.jsonl`；Claude 流保存在 `$P/tools-stdout.jsonl`、`$P/child-stdout.jsonl`。重做实验应另建临时目录与空 git 仓，保留本次工件，不原地覆盖。

## Write、Edit 的真实输入

命令：`python3 "$P/run.py" tools`。提示词要求依次 Write 创建文件、回显口令、Read、Edit 替换、再次回显；禁止读取探针文件或委派。

以下是 `$P/events.jsonl` 中 PreToolUse 的原始字段摘录，只省略会话元数据，不重命名字段。

Write：

```json
{
  "cwd": "/private/tmp/claude-hook-94.pTsT2i/repo",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/private/tmp/claude-hook-94.pTsT2i/repo/sample.test.txt",
    "content": "FIRST_WRITE\n"
  }
}
```

Edit：

```json
{
  "cwd": "/private/tmp/claude-hook-94.pTsT2i/repo",
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/private/tmp/claude-hook-94.pTsT2i/repo/sample.test.txt",
    "old_string": "FIRST_WRITE",
    "new_string": "SECOND_EDIT",
    "replace_all": false
  }
}
```

结论：本次 `file_path` 为绝对路径；Write 使用 `content`，Edit 使用 `old_string`、`new_string`、`replace_all`。顶层 `cwd` 是临时 git 仓，不是探针脚本目录。没有观测到相对路径输入，不据此否定适配层解析相对路径的需求。

## PreToolUse 的时序

命令仍为 `python3 "$P/run.py" tools`。hook 在 PreToolUse 生成口令，在 PostToolUse 记录磁盘状态。两者用 `tool_use_id` 关联同一次调用。

`$P/events.jsonl` 的原始观测：

| 事件 | time_ns | file_exists | file_content | 新口令 |
| --- | --- | --- | --- | --- |
| PreToolUse Write | 1792120058235157000 | false | null | `PRETOOLUSE_a537a038017202977ce51755` |
| PostToolUse Write | 1792120058270019000 | true | `FIRST_WRITE\n` | 无 |
| PreToolUse Edit | 1792120066417346000 | true | `FIRST_WRITE\n` | `PRETOOLUSE_fd078ff6530b9726f2803579` |
| PostToolUse Edit | 1792120066448956000 | true | `SECOND_EDIT\n` | 无 |

`$P/tools-stdout.jsonl` 的顺序摘录：

```text
assistant: BEFORE_WRITE UNKNOWN
assistant tool_use: Write(content="FIRST_WRITE\n")
hook_response PreToolUse: additionalContext 含 PRETOOLUSE_a537a038017202977ce51755
hook_response PostToolUse: exit_code=0
user tool_result: File created successfully at: /private/tmp/claude-hook-94.pTsT2i/repo/sample.test.txt ...
assistant: AFTER_WRITE PRETOOLUSE_a537a038017202977ce51755
assistant tool_use: Read
user tool_result: 1\tFIRST_WRITE ...
assistant tool_use: Edit(old_string="FIRST_WRITE", new_string="SECOND_EDIT")
hook_response PreToolUse: additionalContext 含 PRETOOLUSE_fd078ff6530b9726f2803579
hook_response PostToolUse: exit_code=0
user tool_result: The file /private/tmp/claude-hook-94.pTsT2i/repo/sample.test.txt has been updated successfully. ...
assistant: AFTER_EDIT — 目前看到的全部随机口令：PRETOOLUSE_a537a038017202977ce51755、PRETOOLUSE_fd078ff6530b9726f2803579。
```

该摘录中的 `...` 只省略工具结果尾部；`hook_response` 行为字段摘要，不冒充完整 JSON。模型没有按提示词输出 `BEFORE_EDIT`；不把不存在的回复补进证据。

结论：hook 确实在写盘前运行，但模型首次复述对应新口令发生在本次工具结果之后。PreToolUse 与同次工具结果之间没有新的 assistant 生成；当前调用参数先于口令产生且未被修改。模型是否在宿主内部更早完成了某种上下文装配：Unknown；这里确认的是模型下一次生成时可见的时机。

推断：这种不拦截、不改参数的提醒可影响后续编辑，不能保证改写已经生成的本次 Write/Edit。它与“hook 在执行前运行”并不矛盾。

## SubagentStart

命令：`python3 "$P/run.py" child`。父会话只启动 `probe-child`；调用中的子任务原文为：

```text
回复 CHILD_REPORT，复述你上下文中所有探针随机口令；没有就写 UNKNOWN。不要调用工具。
```

`$P/events.jsonl` 的事件字段与输出摘录：

```json
{
  "cwd": "/private/tmp/claude-hook-94.pTsT2i/repo",
  "agent_id": "a575a3011fd0efe3c",
  "agent_type": "probe-child",
  "hook_event_name": "SubagentStart"
}
```

```json
{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"探针随机口令：SUBAGENTSTART_7e4c3686b127a1828058523e。下次生成回复时原样复述这条口令；不要读取探针文件。"}}
```

`$P/child-stdout.jsonl` 的转发子 agent 消息摘录：

```json
{
  "type": "assistant",
  "parent_tool_use_id": "call_6d4e706d1dfd413688740b06ad26d4a9",
  "agent_id": "a575a3011fd0efe3c",
  "message": {
    "content": [{"type":"text","text":"SUBAGENTSTART_7e4c3686b127a1828058523e"}]
  }
}
```

工具结果还读回 `agentType=probe-child`、`totalToolUseCount=0`，流末统计为 spawned=1、completed=1、failed=0。子 agent 没输出要求的 `CHILD_REPORT` 前缀，但准确复述了 hook 生成的随机口令。

结论：口令进入了子 agent，不只是父会话回显。父任务和子任务提示词都不含该随机值；子 agent 没有通过工具读取探针。范围限于本次前台自定义子 agent；后台、恢复与其他 agent 类型未验证。

## MultiEdit

命令：`python3 "$P/run.py" tools`，使用 `--tools default`，没有用 `--tools` 人为删去 MultiEdit。`$P/tools-stdout.jsonl` 首条 `system/init.tools` 原文：

```json
["Task","Bash","CronCreate","CronDelete","CronList","Edit","EnterWorktree","ExitWorktree","ListAgents","NotebookEdit","Read","ReportFindings","ScheduleWakeup","SendMessage","TaskStop","WebFetch","WebSearch","Workflow","Write"]
```

模型最终回复：`工具列表中没有 MultiEdit。`

结论：本次本机默认暴露的工具集没有 MultiEdit，且整个流未调用 MultiEdit。其他模型映射、功能开关或配置下是否还支持它：Unknown。不能将“未调用”单独当作“不存在”的证明；这里以 init 清单为边界，不建议据此自行修改 spec 的 matcher。

## 隔离与复验

`$P/tools-summary.json` 与 `$P/child-summary.json` 分别记录：

```text
tools: exit_code=0, global_settings_unchanged=true, project_claude_absent=true
child: exit_code=0, global_settings_unchanged=true, project_claude_absent=true
```

`run.py` 在每次运行前后读取 `~/.claude/settings.json` 字节并比较摘要；只输出比较结果。临时 git 仓没有生成 `.claude/`。本票仓内只新增本文，未将探针、配置或运行输出写入 `skills/`，也未修改现有项目 `.claude/`。没有安装 hook。

原始证据复验命令：

```sh
python3 "$P/check.py"
# PASS: Write/Edit shape, completed-result-before-echo, child-only echo, inventory, isolation, exits
python3 "$P/check.py" --negative-control
# 预期退出 1：AssertionError: child itself must echo SubagentStart marker
```

检查穿过真实 CLI 输出，关联 hook 的口令、工具结果顺序与子 agent 身份。负对照只在内存中将子 agent 回显替换为 UNKNOWN，不修改原始工件；同一检查失败，能拒绝“只有父会话看见口令”的错误结论。

临时目录不是永久依赖。清理后本文保留关键字段与时序，但完整流和复验脚本将不可用。没有新增自动化三端 E2E 或 Skill 测试；它们不属于此探针票。

## 与 Spec 的关系

对照 #93 第 7 节：`cwd`、`tool_input.file_path` 与两类 `hookSpecificOutput` 形状均得到本次运行支持；“PreToolUse 附加上下文在本次执行后才进入模型视野”的可观察含义也得到支持。MultiEdit 的跨配置存在性继续为 Unknown。未发现需要用户确认的冲突；不修改 #93、不写 tracker，交由 coordinator 消费证据。

本票只增加调查记录，不改模块、公开接口、参数或过程合同；L1–L6 均未命中。

## 官方一手资料

访问日期：2026-10-16。文档用于核对协议；上文版本、字段与时序结论以本机原始运行证据为准。

- [Hooks reference：PreToolUse](https://code.claude.com/docs/en/hooks#pretooluse)：事件在工具参数生成后、工具执行前触发；与模型下次生成何时看到上下文是两个问题。
- [Hooks reference：SubagentStart](https://code.claude.com/docs/en/hooks#subagentstart)：子 agent 启动事件及其上下文输出。
- [CLI reference](https://code.claude.com/docs/en/cli-reference)：`--settings`、`--setting-sources`、`--tools`、`--agents`、`--forward-subagent-text` 与流式输出参数；本机 `claude --help` 同时提供这些选项。
