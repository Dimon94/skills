---
name: test-discipline
description: 为项目建立或补齐测试规范，或用户主动要求写测试前做自检时使用。
---

# Test Discipline

用户明确要求建立或补齐项目测试规范时，执行「建档」。用户主动要求自检时，先读目标项目测试规范，再按「写前自检」核对实际测试。常规编辑由 hook 提醒；提醒已到达时直接处理，不重复加载全文。

## 写前自检

先读上方列出的项目测试规范；冲突时项目规范优先。判断只回答一个问题：

哪个具体错误实现会让哪条断言失败。写出来。

写不出来就改测试，或者不写它。需要逐项深查时读 repo://skills/test-review/references/test-heuristics.md。

断言观察公开入口上的业务结果，替身只放在外部边界。断言“没有发生”时，同一条测试要证明该发生的结果确实发生过。

## Claude 入口

运行 `node <本 Skill 绝对路径>/hooks/entry.cjs claude`，从 stdin 接收 Claude Code 事件 JSON，输出 `hookSpecificOutput.additionalContext`：

- `PreToolUse`：`Edit`、`Write`、`MultiEdit` 读取 `cwd` 与 `tool_input.file_path`；`Bash` 读取 `cwd` 与 `tool_input.command`，通过共享核心 `extractWriteTargets` 解析写入目标。命中测试或压测文件时注入；普通源码、只读命令与单纯跑测试不输出。一条命令只注入一次，列全命中文件，规范定位取首个命中文件的仓。
- `SubagentStart`：只读取 `cwd`，按会话工作目录注入规范定位与「写前自检」的绝对路径；测试编辑前读取，只读任务按审查要求核对，不展开自检正文。输出事件名为 `SubagentStart`，文本以 `[test-discipline]` 开头，不含“命中测试文件”行。

提醒从不拒绝或改写工具调用。设置 `TEST_DISCIPLINE_HOOK=0` 后入口不读 stdin、不输出，退出 0；其他输入与读取错误写入以 `test-discipline:` 开头的 stderr，退出 1。恢复方式：修正事件字段或恢复本文件的「写前自检」小节后重试。

已知限制：PreToolUse 的附加上下文在本次工具返回后进入模型视野，提醒作用于后续编辑；证据见 repo://docs/research/test-discipline/claude.md「PreToolUse 的时序」。本机默认工具清单未暴露 MultiEdit，其他配置下是否存在为 Unknown。Bash 只解析字面量写入目标，不识别变量路径、间接写入与代码生成；跳过 `*** Begin Patch` 至 `*** End Patch` 的补丁块，不执行命令。解析按文本规则，不是完整 shell 解析；以下组合有已知漏报或误报：heredoc 只归给所在行首命令，`;`、`&&` 之后的 `python3`/`node` 读入的 heredoc 漏报，`python3 -c … <<'PY'` 的 heredoc 数据会误报；Perl 只区分 `-i`、`-e`、`-f`，`-Mstrict` 等附着参数中的 `i` 会误报；`then`、`do`、`else` 等控制词之后的 `cp`、`rm` 漏报。

## Codex 入口

运行 `node <本 Skill 绝对路径>/hooks/entry.cjs codex`，从 stdin 接收事件 JSON：

- `PreToolUse`：仅处理 `apply_patch`，读取 `cwd` 与 `tool_input.command` 补丁全文。逐行解析 `*** Add File: `、`*** Update File: `、`*** Delete File: `、`*** Move to: ` 后的路径，保留路径中的空格，去掉行尾空白。一份补丁只输出一份提醒，去重后列出全部命中文件；跨仓时以首个命中文件的仓根查找规范，命中路径相对该仓根展示。
- `PostToolUse`：仅处理 `Bash`，读取 `cwd` 与 `tool_input.command` 命令文本，复用共享核心 `extractWriteTargets` 与既有测试文件判定。命中测试或压测文件时只注入一份提醒，去重后列全命中文件；普通命令不输出。解析边界同「Claude 入口」的 Bash 已知限制，提醒作用于工具调用结束后。
- `SubagentStart`：按 `cwd` 注入规范定位与条件导航，行为同「Claude 入口」，不输出“命中测试文件”行。

三种事件都只输出 `hookSpecificOutput.hookEventName` 与 `additionalContext`，不输出 `systemMessage` 或权限决定。关闭开关与错误退出合同同 Claude 入口。

**推断**：同版本源码的 `post_tool_use_input` 为 shell 构造 `tool_input: {"command": "<命令文本>"}`，本入口按此形状校验；形状不符时写 stderr、退出 1，永不退出 2。源码依据见 repo://docs/research/test-discipline/codex.md「9. shell 写入的 PostToolUse 源码合同」。

适配依据同版本源码，未完成真实 Codex 验证：`additionalContext` 进入模型的时机、shell 调用补丁是否仍触发 `apply_patch`、shell 是否真以 `Bash` 触发、codemode 内嵌套 `exec_command` 是否触发及真实 `tool_input` 字段均为 Unknown。**推断**：hook 退出码 1 不直接阻断工具；错误在 exec/TUI 中如何显示仍为 Unknown。不能保证同一次编辑前模型已读到提醒。上述运行态由 [#107](https://github.com/Dimon94/skills/issues/107) 真机验收核实，证据归 repo://docs/research/test-discipline/codex.md。

### Codex 信任面

安装成功后，用户须在 `/hooks` 中信任 test-discipline 条目；新增 `PostToolUse` 组需重新信任。安装器不修改 `config.toml` 或信任记录。**推断**：Codex 的信任哈希绑定 hook 定义，而不绑定脚本内容；定义不变时，修改本仓脚本可能无需重新信任。因此能修改本仓脚本的人可能获得 agent 进程中的代码执行能力。信任持久性与仅修改脚本是否要求重新信任仍为 Unknown，由 #107 核实。更新 hook 时审查脚本内容，不能只检查已有信任状态；取舍与回退归 repo://docs/adr/0003-skill-owned-agent-hooks.md。

## 项目测试规范定位

hook 优先读取仓根 AGENTS.md 首条行首为 `测试规范：` 的索引行，按 `、` 分隔并逐项校验 `repo://` 路径。有合法项时只列合法项；失效项只列原值与首个原因，不作为规范路径。没有合法项才检查常见落点，两步皆空时提示“无项目测试规范”。校验与落点顺序归 repo://skills/test-discipline/hooks/core.cjs 的 `indexFailure`、`projectContext`。

无论规范是否存在，都列出从被编辑文件所在目录到仓根之间最近的 AGENTS.md；子 agent 从 `cwd` 起查找。仓根通过向上寻找 `.git` 目录或文件确定，找不到时使用事件 `cwd`。hook 只提供规范路径，不复制规范正文。

## 建档

仅在用户明确要求为项目建立或补齐测试规范时执行；执行其他任务不建档。建档由 agent 手动完成，不生成执行脚本。

### 五步流程

先按下列步骤确定写入清单，再写文件；第 5 步是全部写入的前置检查。

1. 按「项目测试规范定位」查找。找到合法规范且已有测试规范索引时，报告“已有测试规范”并结束。
2. 没有索引但找到常见落点时，只在根 AGENTS.md 末尾追加一行 `测试规范：repo://<路径一>、repo://<路径二>`，按查找顺序列全找到的规范，不生成第二份规范。
3. 什么都没找到时，按下方规则识别语言，读取 [通用正文模板](references/baseline-testing-standards.md) 和命中的语言节模板，填写并生成 `docs/agents/testing-standards.md`；在根 AGENTS.md 末尾追加 `测试规范：repo://docs/agents/testing-standards.md`。生成结果归目标项目所有，由该项目维护。
4. 根目录没有 AGENTS.md 时，新建一个，只含本次索引行。仅在此分支且 CLAUDE.md 不存在时新建 CLAUDE.md，内容为 `@AGENTS.md`；已有 CLAUDE.md 保持不变，并在完成报告中提示用户。
5. 新建目标文件已存在时不覆盖，报告冲突后停止，保留原文件。已有 AGENTS.md 只允许步骤 2、3 的末尾追加；已有首条索引却无合法项时，报告失效原因并停止，不追加一条 hook 读不到的第二索引。

查找优先使用根 AGENTS.md 首条索引；合法项必须带 `repo://` 前缀、不是绝对路径、解析后仍在仓内且指向普通文件，symlink 也不能越界。无合法项时的常见落点按顺序为：`docs/agents/quality-standards.md`、`docs/agents/ui-e2e.md`、`TESTING.md`、`CONTRIBUTING.md`、`CODING_STANDARDS.md`。只检查存在性，不解析内容；规范已有合法索引时不追加常见落点。

### 语言识别与填写

扫描仓根及其下两层目录（根目录深度为 0），排除 `node_modules`、`vendor`、`.git`、`dist`、`build`，不跟随仓外 symlink。按目录与语言归并命中；同目录的多个 Python manifest 只生成一个 Python 节。每处命中都生成语言节并标明仓内目录，多语言仓逐节填写。

| 识别文件 | 语言节模板 | 填写依据 |
| --- | --- | --- |
| `package.json` | [TS/JS](references/typescript-javascript.md) | `scripts.test` 与 CI 测试步骤；沿用现有命名，无现例用 `*.test.ts` |
| `pyproject.toml`、`requirements*.txt` | [Python](references/python.md) | CI 测试步骤与 `[tool.pytest]` 配置；命名 `test_*.py` |
| `go.mod` | [Go](references/go.md) | CI 测试步骤；没有时针对被改包运行 `go test <包路径>`，不写全量 `./...`；命名 `*_test.go` |

命令必须来自 manifest 或 CI 的真实条目，注明执行目录和来源坐标；找不到时写 Unknown，不把 pytest 配置当作可执行命令。Go 无 CI 时使用模板规定的针对被改包命令。隔离手段仅填写项目已有运行时或已安装框架支持的能力，建档不安装测试依赖。其他语言只写一行“<语言>：语言节 Unknown”；未识别出语言时写“项目语言：Unknown”。

### 完成报告

列出写入文件、每个语言节的命令来源坐标（文件与字段或行号）、全部 Unknown 项，以及保留已有 CLAUDE.md 的提示。未写入时报告已有规范或具体冲突。不 stage，不 commit。

## 成员与验证

- `hooks/core.cjs`：通过 `extractWriteTargets(command)` 导出按文本顺序去重的字面量写入目标，供各端适配层交给 `buildContext`；拥有补丁路径解析、测试与压测文件判定、仓根定位、测试规范索引校验与回退、最近 AGENTS.md 查找、小节读取与注入文本组装。无状态，只读本地文件，不访问网络、不启动子进程。
- `hooks/entry.cjs`：拥有 Claude/Codex 事件校验、stdin/stdout 与失败映射。
- `tests/hook.test.cjs`：穿过真实 CLI，使用临时 git 仓验证缝 1。运行 `node --test skills/test-discipline/tests/hook.test.cjs`。
- `references/baseline-testing-standards.md`：基线测试规范通用正文；其余三个模板提供 TS/JS、Python、Go 语言节。建档时读取并填写，验证采用临时 git 仓手动演练：已有规范只补索引、无规范生成基线；演练不 stage、不 commit。
- 深层原则归 repo://skills/test-review/references/test-heuristics.md；hook 按自身真实位置推导绝对路径，目标不存在时省略该行。

本 Skill 拥有建档流程与模板，以及 `scripts/install-hooks.cjs` 的 hook 注册与检查；不拥有项目阶段、生成后项目规范的后续维护或用户全局配置的其余内容。各 hook 入口只读，不写任何配置。

## Pi 入口

按「安装」注册 symlink 后由 Pi 自动发现 ESM 扩展；也可用 `pi -e <本 Skill 绝对路径>/hooks/pi.js` 单次加载。扩展通过真实文件路径创建 `createRequire`，复用 `hooks/core.cjs`；模块解析证据见 repo://docs/research/test-discipline/pi.md「模块解析」。

只处理主会话 `isError === false` 的 `edit`、`write`、`bash`、`codemode` 工具结果：`edit/write` 读取 `input.path`，`bash` 读取 `input.command`，`codemode` 读取 `input.code`。命令与代码文本统一交给共享核心 `extractWriteTargets`；codemode 显式选择代码扫描，覆盖 `tools.edit/write({path})` 与 `tools.bash({command})` 的字面量参数。JS 注释、字符串与模板正文不作为 shell 命令；只有 `tools.bash` 的字面量 command 进入 shell 分支，模板插值不识别。

命中测试或压测文件时，在原 `content` 后追加一份写前自检与规范定位；多个命中去重后列全，规范定位取首个命中文件的仓。同一运行时内每个测试文件只在首次成功命中时提醒，重复编辑不再追加；`session_compact` 与 `session_tree` 清空已提醒集合，会话替换重建运行时后自然清空。该集合只存内存，不写文件、不跨会话；Claude 与 Codex 入口单进程运行，不做去重。带 `structuredContent` 时原样回传。普通源码、只读命令、单纯跑测试、失败结果和带 `parentToolCallId` 的嵌套调用返回 undefined，保持原结果。

`TEST_DISCIPLINE_HOOK=0` 在扩展加载时关闭提醒；运行中修改开关需重新加载扩展。处理异常时只发以 `test-discipline:` 开头的 error 级通知，不改工具结果；按通知修正事件输入或恢复「写前自检」小节后重试。

已知缺口：去重只按绝对路径字面量，同一文件换 symlink 或相对路径写法会再提醒一次；Pi 子 agent 与嵌套工具结果不覆盖；codemode 内部写入依靠主会话 `input.code` 的字面量解析，不依靠嵌套结果。变量路径、非字面量 command、间接写入与代码生成不识别；shell 解析边界同「Claude 入口」的已知限制。codemode 扫描不区分正则字面量与注释：同一行内含 `//` 的正则（如 `/\//`）之后的调用会漏报。提醒在工具成功后进入模型视野，作用于后续编辑；bash/codemode 的真机可见性仍由 #107 验收。

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
