# dverity Context

本文件保存项目统一语言：已经确认的概念、边界和避免使用的同义词。

当前项目是个人 skill 库。业务目标、用户角色、外部系统和关键状态为 Unknown 的项目字段不存在；本文件只承载 skill 库自身的 canonical term。

## 使用规则

- 本文件按两遍读。开工只读「使用规则」与「词汇索引」；当前任务涉及的词条，按索引锚点或 `grep -n '^\*\*'` 定位后单独读入。
- 代码、测试、issue、ADR 和文档使用本文件的 canonical term。
- 一个概念只保留一个 canonical term。
- 新概念入门依次判断：代码和运行状态是否已表达该概念；需求或 accepted ADR 是否确认边界；它是否只是现有概念的同义词。前两项有证据且第三项为否时，才新增词条。
- 需要区分近义词时，写清边界和 Avoid 列表。
- 不确定的定义标为 Unknown。
- 工程词汇（Module、Interface、Seam、Adapter、Ownership 等）的 canonical 定义归 repo://docs/agents/architecture-standards.md 第 2 节。

## 词汇索引

每个已确认词条一行：canonical term + 一句话定义。完整定义、边界和 Avoid 列表见「词条详情」同名锚点。

- **Skill**：一个 `skills/<name>/` 目录，以 SKILL.md 为公开合同，可能携带 scripts/、references/、agents/ 等支持文件。
- **SKILL.md**：skill 的唯一公开合同与入口；frontmatter 的 name/description 决定发现与触发。
- **Canonical source**：本仓 `skills/` 树；任何 agent 运行时目录里的同名条目只是指向它的 symlink。
- **链接依赖**：`~/.agents/skills` 与 `~/.claude/skills` 中指向本仓或第三方 clone 的 symlink，由 repo://scripts/link-skills.sh 建立。
- **第三方 skill**：不归本仓所有的 skill（如 mattpocock/skills 的条目）；唯一真相源是它自己的上游 clone，不复制进本仓。
- **契约脚本**：skill 内被 SKILL.md 显式引用、承担确定性判定或写入的脚本（如 postmortem-contract.js）。
- **ADR**：难回退或有真实取舍的决定记录，归 repo://docs/adr/。

## 词条详情

**Skill**
: 一个 `skills/<name>/` 目录，是本仓的最小交付单元。Skill 拥有且只拥有自己目录下的内容；跨 skill 复用通过指针，不复制内容。
: _Avoid_: workflow entry、plugin、command、子模块。

**SKILL.md**
: skill 目录下的唯一公开合同。frontmatter 的 `name` 与 `description` 决定 agent 能否发现并触发它；正文承载触发条件、步骤和边界。L2 模块地图的职责由它承担。
: _Avoid_: README.md（skill 内不写第二份说明）。

**Canonical source**
: 本仓 `skills/` 树是唯一真相源。根目录或其他机器上的同名 skill 若是指向本仓的 symlink，则只是投影；若不是 symlink，则是漂移，必须修。
: _Avoid_: 副本、拷贝、同步版。

**链接依赖**
: `~/.agents/skills/<name>` 与 `~/.claude/skills/<name>` 是指向 `skills/<name>` 的 symlink。新增 skill 后必须重跑 repo://scripts/link-skills.sh；内容改动经 symlink 即时生效，无需重跑。
: _Avoid_: 安装、部署、发布 skill。

**第三方 skill**
: 不归本仓所有的 skill。接入方式：在 `~/003Tech` 或同等级目录保留其上游仓库 clone，再用 symlink 链入 agent 目录；跟进上游只在上游 clone 里 `git pull`。
: _Avoid_: vendored skill、复制进本仓、fork 进 skills/。

**契约脚本**
: 被 SKILL.md 显式引用、承担确定性判定或写入的脚本。它是 skill 的实现细节，变更按 repo://docs/agents/layer-contracts.md 的 L4 对待。
: _Avoid_: 工具脚本、辅助脚本（泛指）。

**ADR**
: 难回退或有真实取舍的决定记录，归 repo://docs/adr/。普通实现选择由代码、测试和最近的 AGENTS.md 说明。
: _Avoid_: 设计文档、决策日志、备忘。

## 待确认词汇

以下内容为 Unknown。项目形成真实需求时再补充：

- 本仓是否拆分为多个 skill 仓库。
- skill 的跨机器分发方式（除 symlink 外是否需要打包）。
- skill 的对外发布边界（是否公开、是否进 marketplace）。
