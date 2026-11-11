---
name: gh-merge-pr
description: 审查并合并单个 GitHub PR，读回落地结果、关闭对应 Issue、删除源分支并回收临时工作树。用于 current-head Review 或完整合入收尾；仅 Review 保持只读，裸分支转交 git-push-pr。
---

# GH Merge PR

负责一个 GitHub PR 从 current-head Review 到完整收尾。Review 只允许读取远端、
准备隔离 checkout 和生成报告。用户明确要求合并该 PR 时，执行落地及收尾；沿用会话中
已有授权，范围与完成条件归 [收尾合同](../git-rebase-main/references/closeout.md)。

## 1. 绑定 Review Packet

读取 PR 身份、目标分支、head SHA、提交、diff、正文、关联 Spec、仓库标准、检查、
评审状态和未解决讨论：

```bash
gh pr view <n> --json number,title,body,url,headRefOid,headRefName,headRepository,headRepositoryOwner,isCrossRepository,baseRefName,state,isDraft,mergeable,reviewDecision,statusCheckRollup,closingIssuesReferences
```

Fetch base 与 PR head，在隔离 checkout 中记录固定的三点 diff 命令和 commit list。
所有 Review SubAgent 必须收到同一个 Review Packet；缺失 PR 身份、不可解析的 base/head
或空 diff 立即阻断。head SHA 变化时重建 Packet，Review 结论不直接沿用。记录主工作区、
源分支与远端、本次创建的 Review 工作树和任务工作树，供收尾定位。

完成标准：Packet 能唯一标识 repo、PR、base、head、diff、Spec 与标准来源，收尾对象可定位。

## Review 轮次

本 PR 的 Review 最多 3 轮，定义归 `code-review`；一轮包含主审和命中的专项。调用方已有相同 base 与 head 的 Review 结果时直接引用，不重跑。

head 变化时，修复提交按 `code-review` 的复审范围占下一轮。干净的 merge 不占轮：Packet 重建后沿用结论。改变语义的冲突解决占一轮；预算用尽时靠测试验证，并在报告里注明。R3 后仍有 blocker 时返回 `REVIEW_EXHAUSTED` 和未解决项，不进入落地。

## 2. 固定主 Review

启动一个只读 SubAgent，让它对 Review Packet 调用 `code-review`。`code-review` 拥有
Standards 与 Spec 两轴及其内部 SubAgent 编排；本 Skill 只提供 fixed point、完整 diff、
commit list、Spec 和标准来源，不复制它的审查规则。

Standards 来源必须覆盖仓库的 Coding 与 Architecture 规则。Spec 缺失时沿用
`code-review` 的缺失处理，不伪造需求。主 Review 结束后再判断专项 Review，避免后续步骤
稀释固定主审。

完成标准：Standards 与 Spec 均有结果，或 Spec 明确报告 `no spec available`。

## 3. 按证据启动专项 Review

只在第 1 轮运行专项。只根据用户请求、Spec、changed paths 和主 Review finding 选择专项。
每个命中的 Skill 绑定同一 Review Packet；除标“用户调用”的以外，各用一个独立只读 SubAgent：

| Skill | 触发证据 |
| --- | --- |
| `complexity-optimizer` | 明确性能目标，或 diff 命中嵌套扫描、N+1、渲染重算、大数据或热点路径；只审 diff 与直接调用链 |
| `thermo-nuclear-code-quality-review`（用户调用） | 用户明确要求严格可维护性审查，或主 Review 发现重大结构风险 |
| `better-interface` | 用户明确要求完整界面 Review；其内部领域编排仍由该 Skill 拥有 |
| `vercel-react-best-practices` | diff 改变 React/Next.js 渲染、数据获取或 bundle 行为 |
| `supabase-postgres-best-practices` | diff 改变 Postgres/Supabase 查询、schema、RLS 或连接配置 |
| `blast-radius` | diff 命中共享库/公开接口、DB schema、wire format、feature flag 或跨语言数据读者；用户明确要求爆炸半径分析；或主 Review 发现小 diff 外部影响不明 |

标“用户调用”的专项模型调不了，不进 SubAgent：命中时交出 Review Packet，请用户运行对应的
`/名字`，等它的报告回来再进入第 4 步。

只读约束指不修改产品文件；`blast-radius` 允许执行取证脚本与测试来证明安全事实，
产出只能是报告与证据，不得 stage、commit 或改动产品代码。

PR 若来自 `productionize-app-with-services`，把它的计划、Quality Bar、迁移审计和验证证据
作为 Spec 输入；Review 阶段只消费这些证据。

未命中时记录 `Specialist Review: none`。命中但 Skill 不可用时记录 Review gap；所选专项
未完成前不得进入落地。

完成标准：每个触发证据都有一个所选 Skill 或明确 Review gap，没有无证据的专项调用。

## 4. 汇总 current-head Verdict

保留主 Review 的 Standards/Spec 分离结果，并把每个专项报告放在独立小节。不要让专项
结论覆盖主 Review，也不要把不同轴重新排序成一个分数。

Provider 状态只作证据：`reviewDecision`、检查、mergeability 和未解决讨论必须分别读取。
以下条件全部成立才得到 `REVIEWED`：

- 主 Review 完成且无未解决 blocker；
- 每个所选专项完成且无未解决 blocker；
- 必需检查终态成功，讨论已解决，PR 可合并；
- PR head 仍等于 Review Packet 的 head SHA。
- P2 已在 tracker 查重登记，或已列为待登记项报告给用户；P2、P3 不触发下一轮。

任一状态 pending、unknown、failed 或不一致都返回 `BLOCKED` 和恢复动作。Review 阶段不
修改产品文件，不 stage、commit、push、approve、merge 或变更 issue。

完成标准：Verdict 绑定 current head，且每个 blocker、gap 和 provider gate 都有证据。

## 5. 落地

落地需要用户明确要求合并该 PR，目标分支以 Packet 为准；已有授权继续有效。
仅 Review 的请求在第 4 步报告后停止。

1. 重读 head SHA；变化则回到第 1 步。
2. 使用用户指定的策略执行 `gh pr merge <n> --match-head-commit <reviewed-head>`；未指定时
   使用 `--merge`。分支与工作树统一在第 7 步清理，此处不加 `--delete-branch`。
3. branch protection 或 merge queue 拒绝时保持 `BLOCKED`；只有用户明确授权才可使用
   `--admin` 绕过保护。

完成标准：Provider 读回 `MERGED` 与 merge SHA；进入 merge queue 或启用 auto-merge 仍为
等待状态，尚不关闭 Issue 或删除源分支。

## 6. Parity readback

分别读回并确认：

- PR 为 `MERGED` 且具有 merge SHA；
- `git fetch origin <target>` 后 remote target 包含 merge SHA；
- 在目标分支的工作树通过 `git pull --ff-only` 同步到读回的 remote target HEAD，保持 clean；
  `main` 只有在它就是目标分支时才同步，主工作区的既有无关改动按收尾合同保留并报告；
- 最小 post-merge check 通过。

`--ff-only` 因本地 `<target>` 有远端没有的提交而失败时，先运行 `git cherry -v origin/<target> <target>`
分类。全是 `-` 行（补丁已在远端）：把本地 `<target>` 对齐远端后继续。有 `+` 行：列出这些提交的
标题，问用户“先保存到 `hold/local-<target>-<date>-<sha>` 再对齐，还是保留现场”，问题里写明分类结果。

任一 SHA 缺失或不一致都保持 `BLOCKED`，即使 Provider 已显示 merged。

完成标准：Provider、remote target、本地 target 与 active worktree parity 成立。

## 7. Issue、分支与工作树收尾

执行 [收尾合同](../git-rebase-main/references/closeout.md) 的全部步骤。输入同一 Packet 的
已审 head、PR merge SHA、parity 与 post-merge check 证据，以及第 1 步记录的对象清单。

完成标准：合同返回 `COMPLETE`；直接 Issue 均已关闭，源分支与本次临时工作树均有清理
读回或明确不适用 / 保留依据。只有 `MERGED` 或 parity 成功不能代替收尾完成。

## 8. 报告

报告 Review Packet 的 base/head、主 Review、专项选择及原因、Verdict、merge SHA、parity
证据、收尾合同的逐项结果、未运行检查和剩余风险。`REVIEWED`、`MERGED` 与收尾 `COMPLETE`
分别报告；已合并但收尾未完成仍报告 `BLOCKED` 和恢复动作。

Review finding 中的已确认产品缺陷转调试流程；需求或产品意图缺口转新 issue。本 Skill
不修复产品代码。发生真实 merge/rebase conflict 时调用 `resolving-merge-conflicts`。
