# Current System Map

Status: current

本文件描述当前可验证的仓库边界、模块所有权、依赖方向和验证入口。不要写目标愿景冒充现状。

## 当前事实

- 仓库：dverity（个人 skill 库）。
- 阶段：技能维护与迭代。本仓无产品交付阶段；延后加固清单归 repo://docs/deferred-hardening.md。
- 业务目标：Unknown。
- 技术栈：Markdown skill + bash/Node.js 契约脚本，无构建、无框架。
- 运行入口：`skills/<name>/SKILL.md` 由 agent 运行时（Claude Code / Codex / pi 等）读取；脚本由 SKILL.md 显式调用。
- 部署拓扑：无部署；`~/.agents/skills` 与 `~/.claude/skills` 经 symlink 消费本仓。
- 持久状态 owner：skill 文档与脚本本身；运行期状态归调用方项目。
- 外部系统：GitHub（Dimon94/skills 及 repo://skills/sync-upstream-skills/references/sources.json 声明的上游来源）。
- CI：GitHub Actions 当前未配置，状态为 absent。

当前模块清单：

| Module | Owns | Does not own | Public interface | Depends on | Verification |
| --- | --- | --- | --- | --- | --- |
| skills/avoid-overengineering | 手动调用的最简实现约束与交付前消融实验 | 不拥有全仓审计或自动触发 | SKILL.md | 无 | pi Skill 加载校验 + 人工审查 |
| skills/do-not-repeat-yourself | 复用判定与重复审计 | 不拥有具体实现选择 | SKILL.md | repo://docs/agents/coding-standards.md | 无独立测试，经人工审查 |
| skills/git-commit | 本地提交边界与范围核验 | 不拥有合并、推送 | SKILL.md | git CLI | Skill 校验与人工审查 |
| skills/git-rebase-main | 当前分支到本地 main 的 rebase 与快进 | 不拥有远程推送 | SKILL.md | git CLI；resolving-merge-conflicts（第三方 skill） | 无独立测试，经人工审查 |
| skills/git-push-pr | 推送已验证分支并建/更新唯一 GitHub PR | 不拥有审批、合并、issue 关闭 | SKILL.md | git CLI、gh CLI；git-commit、git-rebase-main | 无独立测试，经人工审查 |
| skills/gh-merge-pr | 单个 GitHub PR 的 current-head SubAgent Review、合并与落地读回 | 不拥有 Review 规则、产品修复、批量 PR、远程推送分支 | SKILL.md | gh CLI、git CLI；code-review（固定主审）；complexity-optimizer、thermo-nuclear-code-quality-review、better-interface、vercel-react-best-practices、supabase-postgres-best-practices（按证据专项）；resolving-merge-conflicts | Skill 校验与独立前向测试 |
| skills/{resolving-merge-conflicts,thermo-nuclear-code-quality-review,better-*,vercel-react-best-practices,supabase-postgres-best-practices,productionize-app-with-services,show-me} | 提供来源清单锁定的第三方套件 Skill 上游快照 | 不拥有上游行为演进或隐式本地 patch | 各自 SKILL.md | 上游 Git 仓库；sync-upstream-skills | 来源 hash + Skill 校验 |
| skills/code-review | Standards / Spec 双轴审查与 Codex 子审查模型策略（本仓自有） | 不拥有 Pipeline 证据 transport、实现或发布 | SKILL.md | caller 的固定证据与规范/spec | Skill 校验 + 独立双轴审查 |
| skills/sync-upstream-skills | 上游快照的来源、锁定状态、检查与显式更新 | 不拥有快照内 Review 规则、运行时链接或独立项目更新 | SKILL.md + scripts/sync-upstream-skills.js | git CLI、Node.js、references/sources.json | node:test + `--check` |
| skills/postmortem | 可复用失败教训的判定与落账 | 不拥有工作流状态、远程交付 | SKILL.md + scripts/postmortem-contract.js | Node.js | 契约脚本经单元测试（test 目录当前未迁入，待补） |
| scripts/link-skills.sh | 把 skills/ 链入 agent 目录并拒绝覆盖普通目录 | 不拥有 skill 内容 | CLI | bash | `bash -n` + 隔离 HOME 检查 |
| scripts/install-development-workflow.sh | 链接本仓 Skill，并为独立第三方项目获取 clone 与建立链接依赖 | 不安装整套 Review Skill 套件、Agent CLI、Herdr 或 Second Opinion | CLI | bash、git、python3、独立第三方 Skill 仓库 | `bash -n` + 隔离 HOME 的 offline install/check |

依赖方向：

    agent 运行时 -> symlink -> skills/<name>/SKILL.md -> 契约脚本 / 上游快照
    agent 运行时 -> symlink -> 独立单-Skill 项目 clone

## 链路

端到端链路：

    编辑 skills/ -> git commit -> 其他会话经 symlink 即时可见
    新增 skill -> scripts/link-skills.sh -> agent 目录出现新 symlink
    完整开发链路 -> scripts/install-development-workflow.sh -> 本仓快照 + 独立项目 clone + agent 目录 symlink

第三方 skill 链路：

    套件仓库选取路径 -> sync-upstream-skills -> skills/<name> 上游快照 -> symlink -> agent 目录
    独立单-Skill 项目 clone -> symlink -> agent 目录

## 不变量

任何实现不能破坏的根约束：

- 根目录（`~/.agents/skills`、`~/.claude/skills`）里指向本仓的条目必须是 symlink，不能是副本。
- 第三方套件只复制来源清单点名的单个 Skill，不安装整套套件。
- 每个上游快照必须匹配来源清单的 commit 与内容 hash；仓内漂移阻断自动更新。
- 独立单-Skill 项目保留上游 clone，经链接依赖接入。
- 每个 skill 只有一个 `SKILL.md` 作为公开合同；不建第二份说明文件。

## 更新触发

以下变化必须更新本文件：

- 新增或删除 skill、脚本。
- skill 公开入口、依赖方向或所有权变化。
- 链接机制、目标目录或外部系统变化。

难回退或存在真实取舍的决定同时写入 repo://docs/adr/。

## 验证

- skill 内容：由调用它的 agent 会话验证，无独立 CI。
- 链接：`scripts/link-skills.sh` 运行后 `ls -la ~/.agents/skills` 可见 symlink。
- 开发链路安装：使用隔离 HOME 与现有依赖 checkout 运行 `scripts/install-development-workflow.sh --offline`，再运行 `--check`。
- 上游快照：运行 `node skills/sync-upstream-skills/scripts/sync-upstream-skills.js --check`。
- 契约脚本：postmortem-contract.js 的单元测试当前未迁入本仓，状态为 Unknown；补测试后更新本行。

## PROTOCOL

根合同（本文件「当前事实」「链路」「不变量」）变化时同步：

- repo://CONTEXT.md（统一语言）。
- 根 repo://AGENTS.md（指针与触发）。
- 命中 skill 的 SKILL.md（L2）。
- 架构取舍写 repo://docs/adr/ 新 ADR，不改写已 accepted 的结论。
