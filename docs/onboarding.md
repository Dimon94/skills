# 多 Agent 协同上手指南

读者：用多个 agent 协同交付需求的开发者，以及替他执行的 agent。按顺序做下面 5 步；每步做到完成条件再往下走。

## 两个仓库各管什么

- **my-skills（本仓）管编排的精度和执行时的原则。** 需求先切成 MMF，每个 MMF 写一份 Spec，再切成带依赖边的 ticket。执行到关键决策点时，宿主 Skill 会读取对应的原则叶子。
- **delivery-pipeline 管自动调度。** 它是可选的。不装它，也能用本仓走完从切票到合回 main 的整条链路。

原则会不会进入执行，取决于运行时目录里那个名字实际链接到哪个来源。执行器按名字调用 `tdd`、`code-review` 这些 Skill。名字链接到本仓，本仓的原则就会触发；链接到别处，就不会。

## 1. 装好，并确认每个名字只有一个来源

按 [README.zh-CN.md](../README.zh-CN.md)「一次安装 Skill Bundle」安装，然后运行：

```bash
./scripts/install-development-workflow.sh --check
readlink -f ~/.agents/skills/tdd ~/.agents/skills/code-review ~/.agents/skills/ticket-sizing
```

每个 Skill 名字只能有一个来源。上游仓库只按名字挑选需要的 Skill 单独链接，不整包安装。比如整包装 mattpocock-skills 时，它自带的 `tdd`、`code-review`、`implement`、`to-spec`、`retro` 会和本仓同名。每个名字的来源以 `scripts/install-development-workflow.sh` 里的 `link_named_skill` 调用为准。

完成条件：`--check` 退出码为 0；上面三个名字都解析到本仓的 `skills/`。

## 2. 把需求切成 Spec 和 ticket

先按需求大小选入口。任务分流表在 [README.zh-CN.md](../README.zh-CN.md)「任务分流」。大需求按阻塞位置选入口，规则见 [skills/dimon-mode/SKILL.md](../skills/dimon-mode/SKILL.md)「任务路由」。

大需求的主线：`/to-epic` 把需求切成 MMF → 每个 MMF 用 `/to-spec` 写一份 Spec → `/vertical-slicing` 把它切成 ticket，并调用 `ticket-sizing` 报告票数和拆分信号合计 → 用户从照此执行、重切、转例外模式三项中选一项 → `/to-tickets` 把票发布到 tracker。单位的定义见 [GLOSSARY.md](../GLOSSARY.md) 的 Epic、MMF、Spec、ticket 词条。

这条链上多数入口只能由用户调用：SKILL.md frontmatter 写了 `disable-model-invocation: true` 的 Skill，模型调用不了。agent 规划时要先说明哪几步需要用户输入 `/名字`，轮到这一步时，交出现有产物，点名要用户运行的命令，然后停下。查看哪些 Skill 只能由用户调用：

```bash
grep -l '^disable-model-invocation: true' ~/.agents/skills/*/SKILL.md
```

完成条件：每个 MMF 有一份 Spec；它的 ticket 已经发布，依赖边已连好；用户已看过票数和拆分信号合计，并做出了选择。

## 3. 选执行器

三种执行器都可选，区别在于执行时会经过哪些宿主 Skill。每个宿主 Skill 读取哪个原则叶子，以 [README.zh-CN.md](../README.zh-CN.md)「原则叶子」表为准，下表不再重复列出。

| 执行器 | 怎么启动 | 并发 | 会经过的本仓宿主 Skill |
| --- | --- | --- | --- |
| `implement` | 用户输入 `/implement`，交给它 Spec 或票 | 单线；大块读取交给子代理 | `implement`、`tdd`、`code-review` |
| `implement-spec` | 需要先按名字单独链接（本仓 installer 不装它），并已运行 `/setup-matt-pocock-skills` | 按依赖图的 frontier 并行；每张票开一个后台子代理 | `tdd`、`code-review` |
| delivery-pipeline | 安装它，再运行 `delivery-pipeline-setup` 配置 worker；按环境选 transport 壳 | 自动调度、集成和审查 | 取决于 worker 实际调用的 Skill，查法见表下命令 |

查 delivery-pipeline 的 worker 会按名字调用哪些本仓 Skill：

```bash
rg -n -e tdd -e implement -e code-review "$(dirname "$(readlink -f ~/.agents/skills/delivery-pipeline)")"
```

选 `implement-spec` 就绕开了 `implement`，`implement` 宿主的原则叶子（「原则叶子」表中宿主为 `implement` 的各行）都不会触发。需要这些原则时选 `implement`。

完成条件：执行器已选定；`readlink -f` 确认它会调用的每个宿主 Skill 都解析到本仓。

## 4. 并行写入：一票一树一写者

规则以 [docs/agents/git-branching.md](agents/git-branching.md) 为准，操作命令以 [skills/git-worktree/SKILL.md](../skills/git-worktree/SKILL.md) 为准。多 agent 场景下有三点要落实：

- 每个 MMF 开一条 MR 分支，作为集成分支。ticket 都留在这条分支内，MMF 整体只合入 main 一次（[ADR 0015](adr/0015-mmf-delivery-unit.md)）。
- 每张票建自己的树，起点是这条集成分支：`worktree.sh new <type>/<scope> <集成分支>`。
- 只读的子代理（调研、审查）不用建树。需要写文件的子代理，必须有自己的树。

依赖未满足的票，等前置票合入集成分支之后再开工。两张票只是改同一个 Module 的实现，属于合并冲突风险，不算依赖，判断规则见 [skills/vertical-slicing/SKILL.md](../skills/vertical-slicing/SKILL.md) 第 5 步。

完成条件：`worktree.sh ls` 中每张在做的票恰好对应一棵树和一个分支；主目录仍在 main 上，没有未提交的改动。

## 5. 审查、合回 main、回收

所有票都合入集成分支后，对集成分支跑 `code-review`。修完问题后，按 [skills/git-rebase-main/SKILL.md](../skills/git-rebase-main/SKILL.md) 把它合回 main。之后在主目录运行 `worktree.sh gc --apply`，回收工作树。push 和 PR 需要另外取得授权，流程见 `git-push-pr`。

完成条件：main 上只多出已经验证过的提交；`worktree.sh gc` 报告没有可回收的树。
