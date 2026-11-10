# Agent 开发链路

[English](README.md)

这套仓库把需求澄清、地图规划、规格拆票、自动调度和本地 Git 收口组合成一条可恢复的开发链路。`skills/` 是 Agent 读取的 Canonical source；第三方套件只收录工作流实际使用的上游快照，独立单-Skill 项目通过上游 clone 与 symlink 接入。

![开发链路流程图](docs/assets/development-workflow.zh-CN.svg)

## 任务分流

| 任务类型 | 链路 |
| --- | --- |
| 大型需求 | `to-epic` 把 Epic 切成 MMF → `to-spec` 为每个 MMF 写一份 Spec → `vertical-slicing` 把 MMF 切成 ticket → `ticket-sizing` 给每票拆分信号与 MMF 合计，用户据此决定照此执行或重切 → 超过拆分线的票走 `ticket-split-100k` → `to-tickets` 发布 → 实现；每个 MMF 一个 MR，一个上下文装得下的 MMF 不拆票 |
| 常规需求 | 模型写最小计划 → `grill-with-docs` 拷问计划 → `implement` |
| 小改动 | 直接 `implement`，由 `tdd` 按需决定是否先红后绿 |
| 重构或优化 | 使用 `improve-codebase-architecture` 或 `productionize-app-with-services` 二选一分析 → 按分析所得工作量重新判断需求规模 → 进入上面的大型或小型需求链路 |
| Bug | 独立 Worktree → `diagnosing-bugs` → `git-commit` → `git-rebase-main` |
| 理解既有代码 | `investigate` 做只读调研：机制问题路由到 `how`，动机问题叠加 `why`，方案决策给推荐与取舍表 |
| 评估改动影响面 | `blast-radius` 跑真实代码证明改动在 diff 之外会不会炸；影响面起雾时转 `wayfinder` |
| 项目缺少行为验证手段 | 每个项目跑一次 `create-verification-skill` 生成本地 `verify-<app>` skill；漂移后用 `maintain-verification-skill` 校正 |

重构和优化分析也是分流前置步骤，不是独立交付链。Push、PR 和远程合并始终需要单独授权。

PR 进入审查后，`gh-merge-pr` 先冻结一个 Review Packet，以 `code-review` 完成 Standards 与 Spec 主 Review；只有用户请求、changed paths 或主 Review finding 提供证据时，才增加专项 Review。Current-head Verdict 通过后，才能在新的独立授权下合并并完成 parity readback。

## 一次安装 Skill Bundle

```bash
git clone https://github.com/Dimon94/skills.git \
  "$HOME/.local/share/dimon-agent-workflow/skills"
cd "$HOME/.local/share/dimon-agent-workflow/skills"
./scripts/install-development-workflow.sh
./scripts/install-development-workflow.sh --check
```

脚本会 clone 或快进更新独立依赖仓库，并把本仓 Skill、精选上游快照和独立项目 Skill 链入 `~/.agents/skills` 与 `~/.claude/skills`。它拒绝覆盖同名普通目录；外部 checkout 有本地改动时会保留改动并跳过更新。

让 AI Agent 处理环境识别、运行时依赖和验证时，直接复制 [Agent 一次安装指南](docs/agent-bootstrap.md) 中的提示词。

## 依赖仓库

| 仓库 | 链路职责 | 独立安装 |
| --- | --- | --- |
| [Dimon94/skills](https://github.com/Dimon94/skills) | `implement`、`tdd`、`code-review` 与 `git-commit`、`git-rebase-main` 等本地交付 Skill | [`scripts/link-skills.sh`](scripts/link-skills.sh) |
| [mattpocock/skills](https://github.com/mattpocock/skills) | Research、Grilling、架构分析、Wayfinder、Spec 与 Tickets | [Installation](https://github.com/mattpocock/skills#installation-30-second-setup) |
| [swyxio/skills](https://github.com/swyxio/skills) | 精选 `productionize-app-with-services` 上游快照的来源 | 由本仓安装脚本一并安装 |
| [cursor/plugins](https://github.com/cursor/plugins) | `thermo-nuclear-code-quality-review` 快照及改写的 `how`、`why`、`blast-radius`、`investigate` 与 verification 一对的上游来源 | 由本仓安装脚本一并安装 |
| [humanlayer/skills](https://github.com/humanlayer/skills) | 精选 `show-me` 上游快照的来源 | 由本仓安装脚本一并安装 |
| [Kappaemme-git/codex-complexity-optimizer](https://github.com/Kappaemme-git/codex-complexity-optimizer) | 独立的 `complexity-optimizer` Skill | 本仓安装脚本直接关联 |
| [Dimon94/delivery-pipeline](https://github.com/Dimon94/delivery-pipeline) | 从 Map 或 Spec 接管自动调度、集成、测试与 Review | [Install](https://github.com/Dimon94/delivery-pipeline#install) |
| [Dimon94/brainstorming-only](https://github.com/Dimon94/brainstorming-only) | `brainstorming-only` 与 `office-hours-only` | [Quick Install](https://github.com/Dimon94/brainstorming-only#quick-install) |
| [fireworks-tech-graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) | 生成和校验架构图、流程图与技术图 | [Installation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph#installation) |
| [Second Opinion](https://github.com/Dimon94/codex-with-chatgpt) | 可选的高阶方案讨论与独立审查 | [One-paste install](https://github.com/Dimon94/codex-with-chatgpt#one-paste-install--一段话安装) |
| [Herdr](https://github.com/thinkerisme/herdr) | `delivery-pipeline` 的终端多 Agent 调度运行时 | [Install](https://herdr.dev/install) |

`delivery-pipeline` 还需要至少一个已安装的 Worker CLI：pi、Codex CLI 或 Claude CLI。Codex App 使用原生 Task/Worktree 时不依赖 Herdr。

## 仓库边界

- `AGENTS.md`：本仓工作的总合同。
- `CONTEXT.md`：统一语言与 canonical term。
- `docs/architecture/current-system-map.md`：模块、依赖与验证入口。
- `skills/`：本仓自有 Skill 与精选上游快照的 Canonical source。
- `scripts/link-skills.sh`：链接 `skills/` 中的自有 Skill 与上游快照。
- `scripts/install-development-workflow.sh`：安装完整开发链路 Skill Bundle。
- `skills/sync-upstream-skills/references/sources.json`：上游快照的来源、路径、commit 与内容 hash。
- `skills/sync-upstream-skills/references/adapted-sources.md`：改写自上游的自有 Skill 的出处与基于 commit。

运行 `$sync-upstream-skills` 检查精选快照；明确要求更新后才写入。独立单-Skill 项目仍更新对应上游 clone，symlink 会立即读取新内容。

## 原则叶子

`skills/principle-*` 是 pstack 原则快照，由 `sources.json` 的 `cursor-pstack` 来源锁定。宿主 Skill 和 docs 在对应决策点指向叶子，不复制正文。见 `docs/adr/0009-principle-leaves-and-index.md`。`dimon-mode` 是只能显式调用的工作方式入口，列出全部叶子（`docs/adr/0010-dimon-mode-entry.md`）。

| 叶子 | 宿主 |
| --- | --- |
| `principle-model-the-domain` | `to-spec`（Implementation Decisions） |
| `principle-redesign-from-first-principles` | `to-spec`（Implementation Decisions） |
| `principle-fix-root-causes` | `docs/agents/debugging.md` §4 |
| `principle-separate-before-serializing-shared-state` | `vertical-slicing`（第 5 步连依赖边） |
| `principle-migrate-callers-then-delete-legacy-apis` | `vertical-slicing`（第 4 步补结构片；例外模式见 `references/release-per-ticket.md` 检查 6） |
| `principle-laziness-protocol` | `implement`（第 2 步先做减法） |
| `principle-subtract-before-you-add` | `implement`（第 2 步先做减法） |
| `principle-minimize-reader-load` | `implement`（第 4 步对账前消融） |
| `principle-test-behavior-not-implementation` | `tdd`（第 3 步断言扛得过只改内部） |
| `principle-prove-it-works` | `implement`（第 3 步完成条件，结果读自真产物） |

新增叶子同改四处：`cursor-pstack` 来源、`dimon-mode` 原则节、AGENTS.md 的 `<principle_index>`、本表。只在有宿主引用时引入叶子。
