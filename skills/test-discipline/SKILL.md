---
name: test-discipline
description: 用户主动要求写测试前做自检时使用。
---

# Test Discipline

用户主动要求自检时，先读目标项目测试规范，再逐条回答「写前自检」。答不上的项按本节末尾动作处理。常规编辑由 hook 提醒，避免重复注入。

## 写前自检

先读上方列出的项目测试规范；它与本节冲突时，项目规范优先。
新增、修改或删除测试前逐条回答，答不上的那条就是不写的理由：
1. 它验证哪个已接受的需求或具体缺陷？
2. 去掉它，现有测试是否就发现不了这次回归？
3. 点名一个会让断言失败的错误实现。
4. 预期值来自哪份独立依据（需求示例、手算、标准向量），而不是复制被测实现？
5. 它穿过真实公开入口、观察业务结果，而不是镜像字面量、映射或内部结构？
6. 它是否比被测实现更复杂？是则缩测试或缩装置。
阶段相称（防错配测试）：
7. 这项测试回答的问题，项目现在有证据需要回答吗？
8. 规模、并发、数据量来自哪份已观测或已承诺的事实？
9. 这个环境产出的结论能预测真实运行吗？
10. 为它新增的设施，现在有人维护、有人看结果吗？
任一项答不上：不写这项测试，回到当前验收所需的最小检查。
按二八原则，把测试留给主要业务价值与高影响风险。

## Claude 入口

运行 `node <本 Skill 绝对路径>/hooks/entry.cjs claude`，从 stdin 接收 Claude Code 事件 JSON，输出 `hookSpecificOutput.additionalContext`：

- `PreToolUse`：仅处理 `Edit`、`Write`、`MultiEdit`，读取 `cwd` 与 `tool_input.file_path`。命中测试或压测文件时注入；普通源码不输出。
- `SubagentStart`：只读取 `cwd`，按会话工作目录注入规范定位与写前自检。输出事件名为 `SubagentStart`，文本以 `[test-discipline]` 开头，不含“命中测试文件”行。

提醒从不拒绝或改写工具调用。设置 `TEST_DISCIPLINE_HOOK=0` 后入口不读 stdin、不输出，退出 0；其他输入与读取错误写入以 `test-discipline:` 开头的 stderr，退出 1。恢复方式：修正事件字段或恢复本文件的「写前自检」小节后重试。

已知限制：PreToolUse 的附加上下文在本次工具返回后进入模型视野，提醒作用于后续编辑；证据见 repo://docs/research/test-discipline/claude.md「PreToolUse 的时序」。本机默认工具清单未暴露 MultiEdit，其他配置下是否存在为 Unknown。入口不处理 shell 写文件。

## 项目测试规范定位

hook 优先读取仓根 AGENTS.md 首条行首为 `测试规范：` 的索引行，按 `、` 分隔并逐项校验 `repo://` 路径。有合法项时只列合法项；失效项只列原值与首个原因，不作为规范路径。没有合法项才检查常见落点，两步皆空时提示“无项目测试规范”。校验与落点顺序归 repo://skills/test-discipline/hooks/core.cjs 的 `indexFailure`、`projectContext`。

无论规范是否存在，都列出从被编辑文件所在目录到仓根之间最近的 AGENTS.md；子 agent 从 `cwd` 起查找。仓根通过向上寻找 `.git` 目录或文件确定，找不到时使用事件 `cwd`。hook 只提供规范路径，不复制规范正文。

## 成员与验证

- `hooks/core.cjs`：拥有测试与压测文件判定、仓根定位、测试规范索引校验与回退、最近 AGENTS.md 查找、小节读取与注入文本组装。无状态，只读本地文件，不访问网络、不启动子进程。
- `hooks/entry.cjs`：拥有 Claude 事件校验、stdin/stdout 与失败映射。
- `tests/hook.test.cjs`：穿过真实 CLI，使用临时 git 仓验证缝 1。运行 `node --test skills/test-discipline/tests/hook.test.cjs`。
- 深层原则归 repo://skills/test-review/references/test-heuristics.md；hook 按自身真实位置推导绝对路径，目标不存在时省略该行。

本 Skill 不拥有项目阶段、规范建档、用户全局配置或 hook 安装。调用方自行注册入口；本入口不写任何配置。

## Pi 入口

用 `pi -e <本 Skill 绝对路径>/hooks/pi.js` 加载 ESM 扩展。扩展通过真实文件路径创建 `createRequire`，复用 `hooks/core.cjs`；模块解析证据见 repo://docs/research/test-discipline/pi.md「模块解析」。

只处理主会话成功的 `edit`、`write` 工具结果。命中测试或压测文件时，在原 `content` 后追加写前自检与规范定位；带 `structuredContent` 时原样回传。普通源码、失败结果和带 `parentToolCallId` 的嵌套调用返回 undefined，保持原结果。

`TEST_DISCIPLINE_HOOK=0` 在扩展加载时关闭提醒；运行中修改开关需重新加载扩展。处理异常时只发以 `test-discipline:` 开头的 error 级通知，不改工具结果；按通知修正事件路径或恢复「写前自检」小节后重试。

已知缺口：Pi 子 agent 与嵌套工具调用不覆盖，包括 codemode 内部的 edit/write。提醒在编辑成功后进入模型视野，作用于后续编辑；不处理 shell 写文件。

验证：`tests/pi.test.cjs` 穿过扩展注册的 `tool_result` 入口，使用临时仓与隔离进程验证缝 2。运行 `node --test skills/test-discipline/tests/pi.test.cjs`。本入口不负责安装或写入用户全局配置。
