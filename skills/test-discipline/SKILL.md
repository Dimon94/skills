---
name: test-discipline
description: 用户要求建立或补齐项目测试规范，或明确点名 test-discipline 自检时使用。常规写测试由 hook 提醒。
---

# Test Discipline

用户明确要求建立或补齐项目测试规范时，执行「建档」。用户明确点名 test-discipline 自检时，先读目标项目测试规范，再按「写前自检」核对实际测试。常规编辑由 hook 提醒；提醒已到达时直接处理，不重复加载全文。

## 写前自检

实现优先。把绝大部分时间和精力用于完成当前功能，沿现有实现与明确需求走最短路径。外部输入在边界校验一次，内部直接复用已校验数据和既有合同；不为假想风险添加防御性分支、兜底或预防性操作。

验证够用即停。复用已读的项目规范和仍有效的检查结果；只有相关代码、输入或环境变化，出现新失败，或尚有具体疑点时才追加验证。当前验收通过就继续交付，不重复核对完整性，也不扩展检查范围。

测试只补当前需求的关键缺口。先复用现有测试；确需新增时，只判断哪个具体错误实现会让哪条断言失败，无需逐条书面作答。断言通过公开入口观察业务结果，替身放在外部边界。具体测试质量有争议时，再读下方深层说明。

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
- `hooks/entry.cjs`：拥有 Claude/Codex 事件校验、stdin/stdout 与失败映射；`hooks/codex.cjs` 只读 transcript，按绝对路径去重 Codex 提醒。
- `tests/hook.test.cjs`：穿过真实 CLI，使用临时 git 仓验证缝 1。运行 `node --test skills/test-discipline/tests/hook.test.cjs`。
- `references/baseline-testing-standards.md`：基线测试规范通用正文；其余三个模板提供 TS/JS、Python、Go 语言节。建档时读取并填写，验证采用临时 git 仓手动演练：已有规范只补索引、无规范生成基线；演练不 stage、不 commit。
- 深层原则归 repo://skills/test-review/references/test-heuristics.md；hook 按自身真实位置推导绝对路径，目标不存在时省略该行。

本 Skill 拥有建档流程与模板，以及 `scripts/install-hooks.cjs` 的 hook 注册与检查；不拥有项目阶段、生成后项目规范的后续维护或用户全局配置的其余内容。各 hook 入口只读，不写任何配置。


## Hook 运维

安装、检查、卸载、修改事件适配或排查提醒时，读 [Hook 运维](references/hooks.md)。该文件拥有 Claude、Codex、Pi 的入口与安装合同；日常写测试直接处理已到达的提醒。
