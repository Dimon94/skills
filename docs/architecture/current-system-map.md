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
- 外部系统：GitHub（Dimon94/skills，issue 与 remote 托管）。
- CI：GitHub Actions 当前未配置，状态为 absent。

当前模块清单：

| Module | Owns | Does not own | Public interface | Depends on | Verification |
| --- | --- | --- | --- | --- | --- |
| skills/do-not-repeat-yourself | 复用判定与重复审计 | 不拥有具体实现选择 | SKILL.md | repo://docs/agents/coding-standards.md | 无独立测试，经人工审查 |
| skills/git-commit | 本地提交边界与术语收割 | 不拥有合并、推送 | SKILL.md | git CLI | 无独立测试，经人工审查 |
| skills/git-rebase-main | 当前分支到本地 main 的 rebase 与快进 | 不拥有远程推送 | SKILL.md | git CLI；resolving-merge-conflicts（第三方 skill） | 无独立测试，经人工审查 |
| skills/git-push-pr | 推送已验证分支并建/更新唯一 GitHub PR | 不拥有审批、合并、issue 关闭 | SKILL.md | git CLI、gh CLI；git-commit、git-rebase-main | 无独立测试，经人工审查 |
| skills/gh-merge-pr | 单个 GitHub PR 的 current-head 审查、合并与落地读回 | 不拥有产品修复、批量 PR、远程推送分支 | SKILL.md | gh CLI、git CLI；code-review（第三方 skill）、resolving-merge-conflicts（第三方 skill） | 无独立测试，经人工审查 |
| skills/postmortem | 可复用失败教训的判定与落账 | 不拥有工作流状态、远程交付 | SKILL.md + scripts/postmortem-contract.js | Node.js | 契约脚本经单元测试（test 目录当前未迁入，待补） |
| scripts/link-skills.sh | 把 skills/ 链入 agent 目录 | 不拥有 skill 内容 | CLI | bash | 手动跑一次验证 symlink |
| scripts/install-development-workflow.sh | 获取开发链路依赖仓库并建立链接依赖 | 不安装 Agent CLI、Herdr 或配置 Second Opinion | CLI | bash、git、python3、第三方 Skill 仓库 | `bash -n` + 隔离 HOME 的 offline install/check |

依赖方向：

    agent 运行时 -> symlink -> skills/<name>/SKILL.md -> 契约脚本 / 第三方 skill

## 链路

端到端链路：

    编辑 skills/ -> git commit -> 其他会话经 symlink 即时可见
    新增 skill -> scripts/link-skills.sh -> agent 目录出现新 symlink
    完整开发链路 -> scripts/install-development-workflow.sh -> 上游 clone + agent 目录 symlink

第三方 skill 链路：

    上游仓库 clone -> symlink -> agent 目录

## 不变量

任何实现不能破坏的根约束：

- 根目录（`~/.agents/skills`、`~/.claude/skills`）里指向本仓的条目必须是 symlink，不能是副本。
- 第三方 skill 不复制进本仓 `skills/`。
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
- 契约脚本：postmortem-contract.js 的单元测试当前未迁入本仓，状态为 Unknown；补测试后更新本行。

## PROTOCOL

根合同（本文件「当前事实」「链路」「不变量」）变化时同步：

- repo://CONTEXT.md（统一语言）。
- 根 repo://AGENTS.md（指针与触发）。
- 命中 skill 的 SKILL.md（L2）。
- 架构取舍写 repo://docs/adr/ 新 ADR，不改写已 accepted 的结论。
