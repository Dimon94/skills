# Codex hook 探针：事件、上下文与信任面

调查记录，2026-10-16。范围：[#95](https://github.com/Dimon94/skills/issues/95)，对应 [#93](https://github.com/Dimon94/skills/issues/93) 的 Implementation Decisions 第 8、16 节；第 9 项补充 [#109](https://github.com/Dimon94/skills/issues/109) 的 PostToolUse 源码合同。

**结论：本机无法在禁止写入 `~/.codex/` 的条件下启动 `codex exec`。运行态验收项保持 Unknown，交 #107 真机验收。** 同版本源码支持部分设计假设，但不替代真实 hook 输入、模型复述或交互式信任验证。本记录不修改 Spec，不授权安装。

## 环境与证据坐标

- CLI：`/Users/dimon/.local/bin/codex`，`codex --version` 输出 `codex-cli 0.162.1`。
- 实施基线：`82ee763493e08a3206b38a43079b8c41ae8b9847`；分支 `pi/issue-95`，开工工作区 clean。
- 父执行环境：`PI_PROVIDER=openai-codex`、`PI_MODEL=gpt-6.1-sol`、`PI_REASONING_LEVEL=high`。这是父会话 readback，不代表探针模型已运行。
- 仓外证据目录：`/tmp/issue95-codex.nQSUt9`。下文以 `$E` 指代。临时 git 仓为 `$E/repo-{direct,exit1,shell,disabled}`。
- 原始工件：`run.py`、`probe.py`、`protect.sb`、各模式的 `*.command.txt`、`*.stdout.jsonl`、`*.stderr.txt`、`*.result.json`。脚本和原始输出不入仓。
- 同版本官方源码：tag `rust-v0.162.1`，解析到 commit `092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`。源码下载存于 `$E/sources/`。

临时证据目录不是长期归档。下文保留关键命令、错误原文和源码定点，目录清理后不能从本文恢复完整运行环境。

## 隔离与启动结果

### 首轮启动：没有获得 hook 证据

首轮完整命令和输出位于 `$E/failed-initial/direct.{command.txt,stdout.jsonl,stderr.txt}`。关键参数：

```sh
codex exec --ignore-user-config --ignore-rules --ephemeral \
  --dangerously-bypass-hook-trust -s workspace-write --json --color never \
  -C "$E/repo-direct" -m gpt-5.4 -c 'model_reasoning_effort="low"' …
```

这里的省略号包含会话级 hook 定义、禁用既有 hook 的 overlay 和探针提示词；它不是可直接复跑的完整命令。完整参数以工件为准。

原始输出：

```text
session-flags: `hooks.state.\"/Users/dimon/.codex/hooks` is ignored.
Model metadata for `gpt-5.4` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.
The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.
AssertionError: 全局配置发生变化
```

原始 JSONL 包含 `thread.started`、`turn.started`、HTTP 400 与 `turn.failed`；没有模型工具调用或探针事件。首轮逐键 dotted override 被 CLI 错误拆分，不能证明既有 hook 已禁用。既有 hook 是否执行：Unknown。`--ignore-user-config` 也不能单独作为 hook 隔离保证；同版本 `config/src/loader/mod.rs` 的 `load_user_config_layer` 仍保留 User layer，`hooks/src/engine/discovery.rs` 的 `discover_handlers` 会读取该层的 `hooks.json`。

校验发现 `config.toml` 字节变化，`hooks.json` 未变。首轮前后的具体 SHA 未落盘，均为 Unknown；不能据此归因于探针进程。随后观测 `config.toml` mtime 为本地时间 11:08:26。coordinator 报告桌面 app-server（pid 7364）同时使用同一 home；并发写入是**推断**，不是已确认根因。没有回写或还原全局配置。

### 写保护启动：四种模式都停在初始化

coordinator 在本会话明确批准下面的进程级保护，并要求启动受阻的项保留 Unknown、交 #107；禁止 chmod、chflags 或回写还原。

`$E/protect.sb` 全文：

```scheme
(version 1)
(allow default)
(deny file-write* (subpath "/Users/dimon/.codex"))
```

写保护检查只尝试写模式打开，不截断、不写入：

```sh
E=/tmp/issue95-codex.nQSUt9
sandbox-exec -f "$E/protect.sb" python3 -c \
  'import os; os.open("/Users/dimon/.codex/config.toml",os.O_WRONLY)'
```

原始观测：退出码 `1`，`PermissionError: [Errno 1] Operation not permitted: '/Users/dimon/.codex/config.toml'`。

实际执行命令：

```sh
python3 "$E/run.py" direct
python3 "$E/run.py" exit1
python3 "$E/run.py" shell
python3 "$E/run.py" disabled
```

`run.py` 用 `subprocess` 调用 `sandbox-exec -f "$E/protect.sb" codex --no-daemon exec`，保留上述 exec 隔离参数；模型改为仅本次命令上的 `-m gpt-6.1-sol`，reasoning 为 `low`。每个完整命令分别保存为 `$E/<模式>.command.txt`。改正后的 overlay 用单个 `hooks.state={…}` TOML table 将既有全局 hook 逐项设为 `enabled=false`，只在会话中注册本探针；未编辑全局文件。其生效与 hook 触发仍未能验证，因为初始化更早失败。

四轮 stderr 均为：

```text
WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)
Reading additional input from stdin...
Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)
```

四轮 CLI 退出码均为 `1`，stdout 均为空，没有生成 `events.jsonl`，目标 `*.test.txt` 均未创建。这是 **CLI 初始化退出码**，不是 hook 退出码。具体初始化写入点为 Unknown；不能将它解释为 hook 阻断或模型拒绝。

四轮 `*.result.json` 分别保存配置前后 SHA-256；各轮前后均相等：

| 文件 | 写保护运行前、后的 SHA-256 |
| --- | --- |
| `~/.codex/config.toml` | `0bb154960d15f226f0bbbf59c22e14f94db16cf2b621c5539e716f5021119295` |
| `~/.codex/hooks.json` | `2d85b7ab5b1ddf3c4fcc3f0ed6492f609ea6430bf3184a0ab6f0d4d407dc8159` |

没有复制凭据，没有建立 auth 文件或其链接，没有放宽写保护。没有创建持久信任记录；写保护覆盖 `~/.codex/` 全树。该保护只约束本次子进程，不阻止桌面 app-server 或其他并发进程写入。

## Acceptance criteria 逐项结论

### 1. apply_patch 的 tool_name、cwd、tool_input.command

命令：`python3 "$E/run.py" direct`。提示模型仅用原生 `apply_patch` 创建 `direct.test.txt`。探针从 stdin 读取 JSON，预备记录完整输入、时间和编辑前文件列表。

原始观测：CLI 初始化失败；没有 hook stdin 可摘录。`tool_name`、`cwd` 和 `tool_input.command` 的**真实事件形状均为 Unknown**。

同版本源码证据：

- [`core/src/tools/hook_names.rs`，`HookToolName::apply_patch`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/core/src/tools/hook_names.rs#L28-L38)：canonical 名称为 `apply_patch`，`Write`、`Edit` 是 matcher aliases，不是 stdin 名称。
- [`core/src/tools/handlers/apply_patch.rs`，`apply_patch_payload_command` 与调用处](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/core/src/tools/handlers/apply_patch.rs#L276)：构造 `tool_input: {"command": …}`。
- [`hooks/src/events/pre_tool_use.rs`，`command_input_json`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/hooks/src/events/pre_tool_use.rs#L169-L191)：序列化 cwd、canonical tool_name 和 tool_input。

这些是源码合同，不是实际输入摘录。

### 2. additionalContext 随机口令与进入模型的时机

命令同第 1 项。探针预备在触发时用 `secrets.token_hex(12)` 生成口令，只经以下 stdout JSON 送入模型；提示词不含口令，也禁止模型读取探针或日志：

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"探针随机口令：<触发时生成>。请在工具结果之后复述此口令；不要读探针文件。"}}
```

原始观测：hook 未运行，没有随机口令或模型复述。**进入模型的时机为 Unknown**，不能声称模型能在同一次编辑前重新考虑输入。源码 [`core/src/hook_runtime.rs`，`run_pre_tool_use_hooks`、`record_additional_contexts`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/core/src/hook_runtime.rs#L183) 显示上下文记录路径，但不能替代本次模型时序观测。

### 3. hook 退出码 1：是否阻断、界面是否显示

命令：`python3 "$E/run.py" exit1`。探针该模式预备向 stderr 写 `issue95-probe: exit 1 stderr marker`，然后 `sys.exit(1)`。

原始观测：初始化失败；上述标记未出现。**hook 是否阻断工具、exec 是否显示 hook 错误均为 Unknown**。本次未启动 TUI，交互界面展示也为 Unknown。

源码 [`hooks/src/events/pre_tool_use.rs`，`parse_completed`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/hooks/src/events/pre_tool_use.rs#L200-L309) 的一般非零分支记录 `Failed` 和 `hook exited with code {exit_code}`，不设置 `should_block=true`；退出码 2 有独立控制分支。**推断**：该版本的退出码 1 不直接阻断工具。错误文本最终如何展示仍需真机验证，尤其不能保证自定义 stderr 原文会显示。

### 4. 是否需要额外功能开关

命令：`codex features list`、`codex exec --help`；对照 `python3 "$E/run.py" direct` 与 `python3 "$E/run.py" disabled`（后者追加 `--disable hooks`）。

原始观测：功能列表有 `hooks  stable  true`；help 有 `--dangerously-bypass-hook-trust`。启用默认值与禁用对照均在初始化失败，故**成功触发 hook 是否还需其他开关为 Unknown**。功能列表不是触发成功证据。

同版本 [`features/src/lib.rs`，`Feature::CodexHooks`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/features/src/lib.rs#L1296-L1301) 定义 `stage: Stable`、`default_enabled: true`。免信任开关和 hooks 功能开关不是一回事。

### 5. shell 调用补丁时的 tool_name

命令：`python3 "$E/run.py" shell`。提示模型只经 shell 工具执行以下命令，禁止直接调用原生补丁工具：

```sh
apply_patch <<'PATCH'
*** Begin Patch
*** Add File: shell.test.txt
+shell
*** End Patch
PATCH
```

原始观测：没有 shell 调用、补丁事件或目标文件。**shell 调用是否仍以 `tool_name=apply_patch` 触发为 Unknown**。不能从原生工具名称或 matcher alias 外推 shell 路径。

### 6. 只改脚本、不改 hook 定义后是否重新信任

实际前置命令：`python3 "$E/run.py" direct`。它无法安全启动，因此没有进入持久信任、脚本修改、再次启动的对照；没有执行任何信任写入。`--dangerously-bypass-hook-trust` 即使成功，也不能证明正常信任缓存的行为。

原始观测：无信任对照。**是否要求重新信任为 Unknown**。

同版本源码 [`hooks/src/engine/discovery.rs`，`NormalizedHookIdentity`、`hook_hash`、`hook_trust_status`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/hooks/src/engine/discovery.rs#L768-L813) 的关键片段：

```rust
struct NormalizedHookIdentity {
    event_name: &'static str,
    #[serde(flatten)]
    group: MatcherGroup,
}
// hook_hash 中：
group.hooks = vec![normalized_handler.clone()];
version_for_toml(&value)
```

此哈希计算输入是规范化的事件与配置，不读取命令所指脚本的字节。**推断**：保持定义不变、只修改脚本不会改变该处信任哈希，支持 #93 第 16 节的信任面推断。尚未用正常信任流程核实，不升级为实测结论。

### 7. 是否推翻 #93 第 8、16 节

核对命令：读取上述同版本源码和四轮 `*.result.json`、`*.stderr.txt`，逐项对照本节。

原始观测：未取得任何成功 hook 事件。**没有足够运行证据推翻第 8 或第 16 节**；也没有证据把它们全部确认。保留 additionalContext 时机、shell 补丁路径、退出码显示和持久信任对照为 Unknown。没有修改 Spec 或 tracker。coordinator 已要求将这些未验证路径交 #107，而不是放宽隔离。

### 8. 不改用户 Codex 配置

命令：`run.py` 在每轮启动前后计算 `config.toml`、`hooks.json` 的 SHA-256；写保护命令与结果见「隔离与启动结果」。

原始观测：首轮出现无法归因的 `config.toml` 变化，不能宣称整段调查期间全局文件始终未变；首轮前后 SHA 的留存缺口保持 Unknown。写保护四轮均前后一致。没有主动编辑、还原全局配置或信任记录，没有复制凭据。保护范围内未能启动时明确停止，未以修改全局配置换取证据。

### 9. shell 写入的 PostToolUse 源码合同

源码核对沿用上文锁定的官方 commit，不启动真实 Codex。关键定点：

- [`core/src/tools/handlers/unified_exec.rs`，`post_unified_exec_tool_use_payload`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/core/src/tools/handlers/unified_exec.rs#L81-L98)：只构造 PostToolUse payload，使用 `HookToolName::bash()`，输入取自工具结果的 `post_tool_use_input`；该文件没有 PreToolUse payload。
- [`core/src/tools/context.rs`，`ExecCommandToolOutput::post_tool_use_input`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/core/src/tools/context.rs#L432-L436)：将 `hook_command` 序列化为 `{"command": command}`，不是 `exec_command` 原始参数中的 `cmd`。
- [`hooks/src/events/post_tool_use.rs`，`command_input_json` 与 `parse_completed`](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/hooks/src/events/post_tool_use.rs#L150-L283)：stdin 保留 `cwd`、canonical `tool_name` 与 `tool_input`；退出 0 时接受 `hookSpecificOutput.additionalContext`，退出 1 记为 Failed，退出 2 的独立分支可阻断。

**推断**：Codex shell 事件形如 `{"hook_event_name":"PostToolUse","tool_name":"Bash","cwd":"<绝对路径>","tool_input":{"command":"<命令文本>"}}`。这不是实测输入。入口按此形状校验，提醒只用 additionalContext；不输出 systemMessage 或权限决定，永不退出 2。公开入口合同归 repo://skills/test-discipline/SKILL.md「Codex 入口」。

缝 1 用临时仓与合成 stdin 事件验证提醒、静默与输入错误；缝 3 用临时 HOME 加三端路径覆盖验证注册、漂移修复与卸载。它们不能证明真实 shell 是否以 Bash 触发、codemode 内嵌套 exec_command 是否触发、真实 tool_input 字段或模型收到提醒的时机；这些运行态仍为 **Unknown**，交 #107。新增 PostToolUse 组改变信任定义，用户需在 `/hooks` 重新信任；仅修改脚本的信任推断与限制仍见第 6 项。
