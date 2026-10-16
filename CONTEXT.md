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
- **低价值测试**：保护价值抵不过运行、误报与维护成本的测试；含假绿测试、镜像测试与错配测试。
- **错配测试**：规模、环境或设施与项目当前阶段或真实运行条件不符，结论回答不了项目当前问题的测试。
- **测试规范索引**：目标项目根 AGENTS.md 中以 `测试规范：` 开头的一行，列出该项目测试规范的仓内路径。
- **基线测试规范**：项目没有测试规范时，按其语言建档生成的最小测试规范。

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

**低价值测试**
: 净保护价值为负的测试：它保护的需求、拒绝的错误实现或独有覆盖，抵不过运行、误报、阅读与维护成本。三类常见形态：**假绿测试**（相关错误实现仍能通过）、**镜像测试**（复制被测实现、字面量或映射充当预期）与**错配测试**。判断依据归目标项目测试规范与 repo://skills/test-review/references/test-heuristics.md；覆盖率或测试数量不单独决定价值。
: _Avoid_: 无意义测试、垃圾测试、多余测试（泛指）。

**错配测试**
: 低价值测试的一种：测试的规模、环境或设施与项目当前阶段或真实运行条件不符，结论回答不了项目当前的问题。子情况有三：**时机错配**（问题尚无证据需要回答，如刚启动就做 30 万点击压测）、**环境失真**（环境产出的结论无法预测真实运行，如本地单机模拟分布式）、**设施超配**（新增的测试设施无人维护或无人看结果）。环境失真与阶段无关，任何阶段都成立。项目阶段由目标项目自己声明和记忆，本词条不定义阶段。
: _Avoid_: 过度测试、超前测试、阶段错配测试（范围过窄）。

**测试规范索引**
: 目标项目根 AGENTS.md 中以 `测试规范：` 开头的单行，值为一个或多个以顿号分隔的 `repo://` 仓内路径。它是定位项目测试规范的首选入口；缺失时才回退到常见落点。路径必须落在仓内且文件存在，否则视为索引失效。
: _Avoid_: 测试规范指针（泛指）、规范配置文件。

**基线测试规范**
: 项目没有任何测试规范、且用户明确要求建档时生成的 `docs/agents/testing-standards.md`：一份与语言无关的通用正文，加上按项目语言识别出的语言节。它是项目自己的规范，生成后由该项目拥有和修改。
: _Avoid_: 默认规范、通用规范、测试模板（指生成结果时）。

## 待确认词汇

以下内容为 Unknown。项目形成真实需求时再补充：

- 本仓是否拆分为多个 skill 仓库。
- skill 的跨机器分发方式（除 symlink 外是否需要打包）。
- skill 的对外发布边界（是否公开、是否进 marketplace）。
