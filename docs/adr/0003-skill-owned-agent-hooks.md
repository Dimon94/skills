# Skill 自带多端 agent hook

Status: accepted

Related: [#93](https://github.com/Dimon94/skills/issues/93)、[#101](https://github.com/Dimon94/skills/issues/101)、repo://skills/test-discipline/SKILL.md「安装」、repo://docs/research/test-discipline/codex.md

## Context

`test-discipline` 需要在 agent 编辑测试与压测文件时提醒写前自检。只靠用户主动加载 Skill，无法覆盖常规编辑。Claude Code、Codex 与 Pi 的事件协议不同，但文件判定、规范定位和提醒文本属于同一 Skill。

用户全局配置由多个工具共写。注册 hook 会让 agent 执行本仓代码，不能把普通 Skill 链接等同于 hook 安装授权。Codex 探针未能在禁止写入用户配置的条件下启动，运行态信任行为为 Unknown；证据见 repo://docs/research/test-discipline/codex.md「6. 只改脚本、不改 hook 定义后是否重新信任」。

## Decision

### 1. hook 随 Skill 交付，协议适配复用共享核心

`test-discipline` 拥有 hook、共享核心和安装脚本。写前自检正文只归 SKILL.md「写前自检」，适配层读取它，不复制规则。agent 运行时通过链接依赖消费 Canonical source。

不新增独立的 hook 模块类型：它会把同一 Skill 的规则与触发方式拆成两个 owner。不采用 Claude/Codex 插件：插件引入额外分发与注册合同，且不能统一覆盖 Pi。多端差异留在 Skill 内的适配层。

### 2. 安装脚本只管理本 Skill 的注册

通过 repo://skills/test-discipline/scripts/install-hooks.cjs 的 `targets` 定义实际注册目标；无参数安装、`--check` 只读、`--uninstall` 卸载。写用户全局配置前单独取得用户明确授权，不因加载 Skill 自动安装。

不采用手动粘贴配置：多方共写下，手工合并难以保证保序、幂等、备份和卸载边界。安装脚本复用同一条目识别与写入路径，只改变自己认领的条目；参数、错误和备份合同归该脚本的「安装边界」。不修改 Codex `config.toml` 或 hook 信任记录；Codex 信任由用户在 `/hooks` 中处理。

### 3. 信任执行代码，而不只信任配置定义

**推断**：Codex 信任记录不绑定脚本内容。探针对照的同版本源码在 `NormalizedHookIdentity`、`hook_hash` 中使用规范化事件与 hook 定义计算哈希，不读取命令指向的脚本字节。定义不变而脚本改变，可能无需重新信任；能修改本仓脚本的人也就可能获得 agent 进程中的代码执行能力。源码定点与证据限制见 repo://docs/research/test-discipline/codex.md「6. 只改脚本、不改 hook 定义后是否重新信任」。

上述结论不是实测。正常信任流程是否要求重新信任仍为 Unknown，由 [#107](https://github.com/Dimon94/skills/issues/107) 真机验收核实。更新本仓 hook 时必须审查代码变更，不能以已有信任状态代替内容审查。条目识别只用于管理注册，不是代码完整性校验。

### 4. 先卸载注册，再删除 Skill

回退先在原 Skill 仍可执行时运行 `node skills/test-discipline/scripts/install-hooks.cjs --uninstall`。它只清理目标表内本 Skill 的条目与因此清空的组，变化前备份，保留他人配置。随后运行 `--check` 确认对应目标为 `missing`；此时退出码 1 是缺失状态，不是卸载失败。

需要完整移除时，再由用户明确批准删除 `skills/test-discipline` 目录，并核对、移除只指向该目录的链接依赖；repo://scripts/link-skills.sh 不清理失效链接。同步 L1 模块表并重跑该脚本，刷新其余 Skill 的链接依赖。Codex 注册与 Pi symlink 的接入分别归 [#102](https://github.com/Dimon94/skills/issues/102)、[#104](https://github.com/Dimon94/skills/issues/104)；Pi 卸载只允许删除指向本仓扩展的 symlink，不删除他人文件。尚未接入的目标不算已完成卸载验证。

备份保留为恢复点，不自动删除。恢复原配置前核对备份和其他工具的后续写入，获得用户授权后再恢复，避免覆盖后续改动。

### 5. 解析字面量写入目标，覆盖 shell 与 codemode

[#93 范围修订](https://github.com/Dimon94/skills/issues/93) 将 shell 写测试文件纳入提醒面。共享核心 `extractWriteTargets` 拥有命令文本的写入目标提取；各端适配层复用它与既有 `buildContext`，不复制测试文件判定。解析不执行命令、不读写状态、不启动子进程；补丁块交给既有补丁路径解析，避免重复注入。

Claude `PreToolUse` 的 `Bash` 从 `tool_input.command` 提取目标，安装 matcher 加入 `Bash`；旧 matcher 由 `--check` 报 drift，用户授权后重装修复。多文件沿用一次注入与首个命中仓规范定位。识别边界是字面量路径，不识别变量路径、间接写入与代码生成；具体形态归 repo://skills/test-discipline/hooks/core.cjs 的 `extractWriteTargets` 与缝 1 测试。

否决方案 B（调用前后 git 快照比对）：它要求启动子进程、存状态，并为每次 shell 增加开销，破坏现有只读、无状态合同。若 #107 真机验收发现间接写入的漏报，再另开票评估，不在解析器中补状态机制。回退保留本记录第 4 节的授权与卸载顺序。

## Consequences

### 正面

- Skill、hook 与共享规则保持同一 owner，多端协议差异不复制判定逻辑。
- 注册、检查与卸载通过同一 CLI 管理，回退不要求手工编辑配置。
- 写入用户全局配置与信任执行代码的授权边界明确。

### 负面 / 成本

- hook 注册扩大本仓代码的执行面；仓库更新需要内容审查。
- 适配层仍需逐端验证，单元测试不能证明真实 agent 的上下文时序或信任行为。
- 卸载不撤销已执行的 hook 效果，也不自动清除备份或宿主信任记录。

### 边界

本决定冻结 Skill 自带多端 hook 的交付形态、注册所有权与回退顺序，不授权本次写入用户全局配置。实际支持目标以 `targets` 为准；三端真实运行验证归 #107，Pi 子 agent 与嵌套调用缺口归 repo://skills/test-discipline/SKILL.md「Pi 入口」。

在本仓以 Skill 为模块、无需插件分发的前提下，否决方案为终审。引入独立 hook owner、插件分发或改变信任与回退边界时，新建 ADR supersede 本记录；运行证据推翻信任推断时，保留本记录并以新 ADR 记录裁决。
