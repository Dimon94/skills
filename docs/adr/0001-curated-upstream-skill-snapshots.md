# 精选上游 Skill 快照

Status: accepted

Related: repo://skills/gh-merge-pr/SKILL.md、repo://skills/sync-upstream-skills/SKILL.md

## Context

`gh-merge-pr` 依赖多个第三方 Review Skill。部分 Skill 位于大型套件；让使用者安装整套
仓库会扩大运行时 Skill 面，并增加名称冲突。`complexity-optimizer` 则由独立单-Skill
项目发布，不存在该问题。现有 agent 目录还可能包含本地改造，静默覆盖会造成数据丢失。

## Decision

### 1. 套件成员使用上游快照

本仓只选取实际依赖的套件成员，写入 `skills/<name>`。来源、ref、锁定 commit 和内容
hash 由 repo://skills/sync-upstream-skills/references/sources.json 拥有。运行时只链接这些
快照，不安装整套上游仓库。

### 2. 独立项目使用链接依赖

独立单-Skill 项目保留上游 clone。repo://scripts/install-development-workflow.sh 获取并
校验 clone，再把其中的 Skill 目录链接到 agent 运行时；不复制进本仓。

### 3. 更新显式且 fail-close

`sync-upstream-skills` 默认只读比较选取路径。用户明确要求更新后才写入。仓内内容与锁定
hash 不一致时整次更新停止，避免覆盖本地改造。长期本地改造必须脱离来源清单，成为本仓
自有 Skill。

不采用自动定时覆盖：它无法在上游权限、工具调用或 frontmatter 变化时完成可信审查。

## Consequences

### 正面

- 使用者只获得当前工作流需要的 Skill。
- 每个快照可追溯到精确上游 commit 和内容 hash。
- 独立项目仍可直接跟随自己的 Git 历史。

### 负面 / 成本

- 上游更新需要显式同步与 diff 审查。
- 仓库体积包含所选 Skill 的支持文件。
- 快照不能承载隐式本地 patch。

### 边界

本决定只裁决第三方 Skill 的分发和更新。`gh-merge-pr` 仍只拥有 Review 路由，不复制各
Review Skill 的内部规则。新增来源、改变同步策略或允许 patch layer 时必须新建 ADR
supersede 本记录。
