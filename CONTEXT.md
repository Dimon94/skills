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
- **Canonical source**：agent 运行时读取的本仓 `skills/` 树；包含本仓自有 Skill 与经来源清单锁定的上游快照。
- **上游快照**：从第三方套件选取单个 Skill 后写入 `skills/` 的锁定版本，由 repo://skills/sync-upstream-skills/references/sources.json 记录来源、commit 与内容 hash。
- **链接依赖**：agent 目录中指向本仓 Skill 或独立单-Skill 项目 clone 的 symlink。
- **第三方 skill**：行为所有权在外部项目的 Skill；套件成员使用上游快照，独立单-Skill 项目使用链接依赖。
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
: 本仓 `skills/` 树是 agent 运行时的唯一真相源。自有 Skill 由本仓拥有；上游快照由来源清单锁定。agent 目录里的同名条目只允许是指向对应 Canonical source 的 symlink。
: _Avoid_: 运行时副本、未登记副本、第二真相。

**上游快照**
: 第三方套件中被本仓 Skill 实际依赖的单个 Skill 目录。上游项目拥有原始行为；本仓来源清单拥有选取路径、锁定 commit 和内容 hash。快照只经 repo://skills/sync-upstream-skills/SKILL.md 检查和更新；仓内漂移会阻断覆盖。
: _Avoid_: 整套安装、隐式 fork、手工同步副本。

**链接依赖**
: `~/.agents/skills/<name>` 与 `~/.claude/skills/<name>` 是指向本仓 `skills/<name>` 或独立单-Skill 项目 clone 的 symlink。新增本仓 Skill 后重跑 repo://scripts/link-skills.sh；完整开发链路使用 repo://scripts/install-development-workflow.sh。
: _Avoid_: 运行时副本、目录覆盖。

**第三方 skill**
: 不归本仓所有行为的 Skill。第三方套件只选取真实依赖的成员作为上游快照；独立单-Skill 项目保留上游 clone，并用链接依赖接入。两类来源不能同时拥有同一个运行时名称。
: _Avoid_: 整套复制、来源不明副本、同名双轨。

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
