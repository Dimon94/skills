# Hook 运维

用途：安装、检查、卸载或排查 test-discipline 提醒时读取。写前自检与建档流程归 [SKILL.md](../SKILL.md)。

## Claude 入口

运行 `node <本 Skill 绝对路径>/hooks/entry.cjs claude`，从 stdin 接收 Claude Code 事件 JSON，输出 `hookSpecificOutput.additionalContext`：

- `PreToolUse`：`Edit`、`Write`、`MultiEdit` 读取 `cwd` 与 `tool_input.file_path`；`Bash` 读取 `cwd` 与 `tool_input.command`，通过共享核心 `extractWriteTargets` 解析写入目标。命中测试或压测文件时注入；普通源码、只读命令与单纯跑测试不输出。一条命令只注入一次，列全命中文件，规范定位取首个命中文件的仓。
- `SubagentStart`：只读取 `cwd`，按会话工作目录注入规范定位与「写前自检」的绝对路径；测试依据不足时按需读取，已有上下文足够则继续当前任务；只读任务按审查要求核对，不展开自检正文。输出事件名为 `SubagentStart`，文本以 `[test-discipline]` 开头，不含“命中测试文件”行。

提醒从不拒绝或改写工具调用。设置 `TEST_DISCIPLINE_HOOK=0` 后入口不读 stdin、不输出，退出 0；其他输入与读取错误写入以 `test-discipline:` 开头的 stderr，退出 1。恢复方式：修正事件字段或恢复 ../SKILL.md 的「写前自检」小节后重试。

已知限制：PreToolUse 的附加上下文在本次工具返回后进入模型视野，提醒作用于后续编辑；证据见 repo://docs/research/test-discipline/claude.md「PreToolUse 的时序」。本机默认工具清单未暴露 MultiEdit，其他配置下是否存在为 Unknown。Bash 只解析字面量写入目标，不识别变量路径、间接写入与代码生成；跳过 `*** Begin Patch` 至 `*** End Patch` 的补丁块，不执行命令。解析按文本规则，不是完整 shell 解析；以下组合有已知漏报或误报：heredoc 只归给所在行首命令，`;`、`&&` 之后的 `python3`/`node` 读入的 heredoc 漏报，`python3 -c … <<'PY'` 的 heredoc 数据会误报；Perl 只区分 `-i`、`-e`、`-f`，`-Mstrict` 等附着参数中的 `i` 会误报；`then`、`do`、`else` 等控制词之后的 `cp`、`rm` 漏报。

## Codex 入口

运行 `node <本 Skill 绝对路径>/hooks/entry.cjs codex`，从 stdin 接收事件 JSON：

- `PreToolUse`：仅处理 `apply_patch`，读取 `cwd` 与 `tool_input.command` 补丁全文。逐行解析 `*** Add File: `、`*** Update File: `、`*** Delete File: `、`*** Move to: ` 后的路径，保留路径中的空格，去掉行尾空白。一份补丁只输出一份提醒，去重后列出全部命中文件；跨仓时以首个命中文件的仓根查找规范，命中路径相对该仓根展示。
- `PostToolUse`：仅处理 `Bash`，读取 `cwd` 与 `tool_input.command` 命令文本，复用共享核心 `extractWriteTargets` 与既有测试文件判定。命中测试或压测文件时只注入一份提醒，去重后列全命中文件；普通命令不输出。解析边界同「Claude 入口」的 Bash 已知限制，提醒作用于工具调用结束后。
- `SubagentStart`：按 `cwd` 注入规范定位与条件导航，行为同「Claude 入口」，不输出“命中测试文件”行。

三种事件都只输出 `hookSpecificOutput.hookEventName` 与 `additionalContext`，不输出 `systemMessage` 或权限决定。关闭开关与错误退出合同同 Claude 入口。

**推断**：同版本源码的 `post_tool_use_input` 为 shell 构造 `tool_input: {"command": "<命令文本>"}`，本入口按此形状校验；形状不符时写 stderr、退出 1，永不退出 2。源码依据见 repo://docs/research/test-discipline/codex.md「9. shell 写入的 PostToolUse 源码合同」。

在新提醒末尾追加 `[test-discipline:files] <JSON 绝对路径数组>`，只列本次命中的测试文件。`transcript_path` 有值时，`hooks/codex.cjs` 流式读取完整 JSONL 记录，只认 `response_item` / `message` / `developer` / `input_text` 中以真实提醒开头并带该标记的路径；同一绝对路径已提醒则静默，多文件调用仍提醒其余文件。用户与工具引用、旧版无标记提醒不参与去重。路径经 `path.resolve` 规范化，跨仓同名文件分别处理。

`transcript_path` 缺省或为 null 时照常提醒；有值时必须为绝对普通文件路径。坏路径、读取失败、完整坏记录与非法路径标记写 stderr、退出 1；正在写入的末尾未结束行留待下次读取。入口只读 transcript，不写状态文件；每次读取成本随日志长度增长。并发调用在提醒持久化前仍可能重复，symlink 别名不合并。

被动日志已观察到 codemode 内 `tools.apply_patch` 对应的 developer 提醒；#107 历史真机探针已证明 shell 重定向的 PostToolUse 提醒可见、单纯跑测试不注入。证据与版本边界见 repo://docs/research/test-discipline/codex.md「10. 真实日志与 transcript 去重」。Codex 0.165.0 的真实提醒、同文件去重和模型复述已通过，见 repo://docs/research/test-discipline/2026-11-03-live.md「方法与结果」。完整原始 stdin、并发持久化时序、退出码 1 的界面显示和跨版本信任仍为 Unknown；不能保证同一次编辑前模型已读到提醒。

### Codex 信任面

安装成功后，用户须在 `/hooks` 中信任 test-discipline 条目；新增 `PostToolUse` 组需重新信任。安装器不修改 `config.toml` 或信任记录。**推断**：Codex 的信任哈希绑定 hook 定义，而不绑定脚本内容；定义不变时，修改本仓脚本可能无需重新信任。因此能修改本仓脚本的人可能获得 agent 进程中的代码执行能力。信任持久性与仅修改脚本是否要求重新信任仍为 Unknown，由 #107 核实。更新 hook 时审查脚本内容，不能只检查已有信任状态；取舍与回退归 repo://docs/adr/0003-skill-owned-agent-hooks.md。

## Pi 入口

按「安装」注册 symlink 后由 Pi 自动发现 ESM 扩展；也可用 `pi -e <本 Skill 绝对路径>/hooks/pi.js` 单次加载。扩展通过真实文件路径创建 `createRequire`，复用 `hooks/core.cjs`；模块解析证据见 repo://docs/research/test-discipline/pi.md「模块解析」。

只处理当前 Pi 进程中 `isError === false` 且不带 `parentToolCallId` 的 `edit`、`write`、`bash`、`codemode` 工具结果；pi-subagents 独立进程加载扩展后也走此入口。`edit/write` 读取 `input.path`，`bash` 读取 `input.command`，`codemode` 读取 `input.code`。命令与代码文本统一交给共享核心 `extractWriteTargets`；codemode 显式选择代码扫描，覆盖 `tools.edit/write({path})` 与 `tools.bash({command})` 的字面量参数。JS 注释、字符串与模板正文不作为 shell 命令；只有 `tools.bash` 的字面量 command 进入 shell 分支，模板插值不识别。

命中测试或压测文件时，在原 `content` 后追加一份写前自检与规范定位；多个命中去重后列全，规范定位取首个命中文件的仓。同一运行时内每个测试文件只在首次成功命中时提醒，重复编辑不再追加；`session_compact` 与 `session_tree` 清空已提醒集合，会话替换重建运行时后自然清空。该集合只存内存，不写文件、不跨会话；Claude 入口不去重，Codex 去重归「Codex 入口」。带 `structuredContent` 时原样回传。普通源码、只读命令、单纯跑测试、失败结果和带 `parentToolCallId` 的嵌套调用返回 undefined，保持原结果。

`TEST_DISCIPLINE_HOOK=0` 在扩展加载时关闭提醒；运行中修改开关需重新加载扩展。处理异常时只发以 `test-discipline:` 开头的 error 级通知，不改工具结果；按通知修正事件输入或恢复「写前自检」小节后重试。

已知缺口：去重按规范化的绝对路径，不合并 symlink 别名；带 `parentToolCallId` 的嵌套结果不直接追加；codemode 内部写入依靠当前进程 `input.code` 的字面量解析，不依靠嵌套结果。变量路径、非字面量 command、间接写入与代码生成不识别；shell 解析边界同「Claude 入口」的已知限制。codemode 扫描不区分正则字面量与注释：同一行内含 `//` 的正则（如 `/\//`）之后的调用会漏报。提醒在工具成功后进入模型视野，作用于后续编辑；bash/codemode 与 pi-subagents 独立进程的已知观测见 repo://docs/research/test-discipline/pi.md「真实会话补充」。本机新会话的五步正负对照与去重结果见 repo://docs/research/test-discipline/2026-11-03-live.md「方法与结果」；其余调用形态仍由 #107 验收。

验证：`tests/pi.test.cjs` 穿过扩展注册的 `tool_result` 入口，使用临时仓与隔离进程验证缝 2。运行 `node --test skills/test-discipline/tests/pi.test.cjs`。本入口不负责安装或写入用户全局配置。

## 安装

安装职责以本节为准：`scripts/install-hooks.cjs` 拥有目标表内的 hook 注册、状态检查与卸载；Claude/Codex 入口仍只读。先检查，获得用户对目标配置写入的明确授权后再安装或卸载：

```sh
node skills/test-discipline/scripts/install-hooks.cjs --check
node skills/test-discipline/scripts/install-hooks.cjs
node skills/test-discipline/scripts/install-hooks.cjs --uninstall
```

目标表 `targets` 包含 Claude、Codex 与 Pi。`CLAUDE_SETTINGS` 覆盖 Claude 的 `~/.claude/settings.json`；`CODEX_HOOKS` 覆盖 Codex 的 `~/.codex/hooks.json`。Claude 与 Codex 都注册 PreToolUse 与 SubagentStart；Codex 另注册 matcher 为 `Bash` 的 PostToolUse 组。`PI_EXTENSIONS_DIR` 覆盖 Pi 扩展目录，默认为 `~/.pi/agent/extensions`；安装器在其中创建 `test-discipline.js` symlink，指向本仓 `hooks/pi.js`。参数与事件合同归 repo://skills/test-discipline/scripts/install-hooks.cjs 的安装边界。Codex 安装成功后提示去 `/hooks` 信任，并说明新增 PostToolUse 组需重新信任；不写 `config.toml` 或信任记录。

检查逐端输出 `installed`、`missing` 或 `drift`，不写文件；全部 installed 时退出 0，否则退出 1。仓库移动、Claude matcher 仍为旧值 `Edit|Write|MultiEdit`，或 Codex 缺少 PostToolUse/Bash 注册组时，检查报告 drift；获得配置写入授权后重新安装即可修正。安装保留其他配置及 hook 条目，变化前备份原文件到 `<原文件>.test-discipline.bak-<YYYYMMDDHHMMSS>`，再原子替换；内容不变时不写。原文件不存在时直接创建。Pi 检查将不存在的链接报告为 missing，指向当前扩展为 installed，其余为 drift；安装遇到非 symlink 目标时退出 1，保留原文件，移走冲突文件后再重试。Pi 链接变化前备份链接本身，再原子替换。JSON 或配置结构非法时退出 1，不写文件；修正报错路径后重试。

`--uninstall` 对目标表内所有目标生效，成功输出 `uninstalled`，退出 0。只移除本 Skill 的条目与因此清空的 matcher 组，保留混合组内他人 hook、原有空组、事件键与其他配置。JSON 沿用条目识别、变化前备份和原子替换；Pi 只备份并删除解析后指向本仓当前扩展的 symlink，保留其他链接和非 symlink 目标。目标不存在或已卸载时不写文件，也不产生备份。多端 hook 的取舍、信任面与完整回退归 repo://docs/adr/0003-skill-owned-agent-hooks.md。

安装测试归 `tests/install.test.cjs`，通过真实 CLI 读回配置。验证一律使用临时 HOME 加 `CLAUDE_SETTINGS`、`CODEX_HOOKS`、`PI_EXTENSIONS_DIR` 覆盖；运行 `node --test skills/test-discipline/tests/install.test.cjs`。恢复时，先核对备份与其他工具的后续改动，再由用户批准恢复；不要直接覆盖后续配置。
