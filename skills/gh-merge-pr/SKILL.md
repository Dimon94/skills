---
name: gh-merge-pr
description: 审查并在独立授权后合并一个 GitHub PR。用于单 PR 的 current-head SubAgent Review、按证据调用专项 Review、落地与 parity readback；裸分支或缺失 PR 转交 git-push-pr。
---

# GH Merge PR

负责一个 GitHub PR 从 current-head Review 到落地读回。Review 只允许读取远端、
准备隔离 checkout 和生成报告；合并与 issue closeout 分别需要点名目标的新授权。

## 1. 绑定 Review Packet

读取 PR 身份、目标分支、head SHA、提交、diff、正文、关联 Spec、仓库标准、检查、
评审状态和未解决讨论：

```bash
gh pr view <n> --json number,title,body,url,headRefOid,headRefName,baseRefName,state,isDraft,mergeable,reviewDecision,statusCheckRollup
```

Fetch base 与 PR head，在隔离 checkout 中记录固定的三点 diff 命令和 commit list。
所有 Review SubAgent 必须收到同一个 Review Packet；缺失 PR 身份、不可解析的 base/head
或空 diff 立即阻断。head SHA 变化会使整个 Packet 及其 Review 结果失效。

完成标准：Packet 能唯一标识 repo、PR、base、head、diff、Spec 与标准来源。

## 2. 固定主 Review

启动一个只读 SubAgent，让它对 Review Packet 调用 `code-review`。`code-review` 拥有
Standards 与 Spec 两轴及其内部 SubAgent 编排；本 Skill 只提供 fixed point、完整 diff、
commit list、Spec 和标准来源，不复制它的审查规则。

Standards 来源必须覆盖仓库的 Coding 与 Architecture 规则。Spec 缺失时沿用
`code-review` 的缺失处理，不伪造需求。主 Review 结束后再判断专项 Review，避免后续步骤
稀释固定主审。

完成标准：Standards 与 Spec 均有结果，或 Spec 明确报告 `no spec available`。

## 3. 按证据启动专项 Review

只根据用户请求、Spec、changed paths 和主 Review finding 选择专项。每个命中的 Skill
使用独立只读 SubAgent，并绑定同一 Review Packet：

| Skill | 触发证据 |
| --- | --- |
| `complexity-optimizer` | 明确性能目标，或 diff 命中嵌套扫描、N+1、渲染重算、大数据或热点路径；只审 diff 与直接调用链 |
| `thermo-nuclear-code-quality-review` | 用户明确要求严格可维护性审查，或主 Review 发现重大结构风险 |
| `better-interface` | 用户明确要求完整界面 Review；其内部领域编排仍由该 Skill 拥有 |
| `vercel-react-best-practices` | diff 改变 React/Next.js 渲染、数据获取或 bundle 行为 |
| `supabase-postgres-best-practices` | diff 改变 Postgres/Supabase 查询、schema、RLS 或连接配置 |
| `blast-radius` | diff 命中共享库/公开接口、DB schema、wire format、feature flag 或跨语言数据读者；用户明确要求爆炸半径分析；或主 Review 发现小 diff 外部影响不明 |

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

任一状态 pending、unknown、failed 或不一致都返回 `BLOCKED` 和恢复动作。Review 阶段不
修改产品文件，不 stage、commit、push、approve、merge 或变更 issue。

完成标准：Verdict 绑定 current head，且每个 blocker、gap 和 provider gate 都有证据。

## 5. 落地

落地需要新授权点名 PR 与目标分支。

1. 重读 head SHA；变化则回到第 1 步。
2. 使用用户指定的策略执行 `gh pr merge <n>`；未指定时使用 `--merge`。
3. branch protection 或 merge queue 拒绝时保持 `BLOCKED`；只有用户明确授权才可使用
   `--admin` 绕过保护。

完成标准：Provider 返回 `MERGED` 与 merge SHA。

## 6. Parity readback

分别读回并确认：

- PR 为 `MERGED` 且具有 merge SHA；
- `git fetch origin <target>` 后 remote target 包含 merge SHA；
- 本地 `main` 通过 `git pull --ff-only` 到达相同 SHA，active worktree 保持 clean；
- 最小 post-merge check 通过。

任一 SHA 缺失或不一致都保持 `BLOCKED`，即使 Provider 已显示 merged。

完成标准：Provider、remote target、本地 target 与 active worktree parity 成立。

## 7. Issue closeout

只处理 PR 正文以 `Closes #n` 点名且 close authority 覆盖的 direct issue。Parent、sibling、
blocker 和其他关联 issue 只读回，不递归关闭。每次变更后再次读回 closed state。

完成标准：每个获授权 direct issue 都有 mutation 与 closed-state readback；其他 issue 未变。

## 8. 报告

报告 Review Packet 的 base/head、主 Review、专项选择及原因、Verdict、merge SHA、parity
证据、closed issues、未运行检查和剩余风险。

Review finding 中的已确认产品缺陷转调试流程；需求或产品意图缺口转新 issue。本 Skill
不修复产品代码。发生真实 merge/rebase conflict 时调用 `resolving-merge-conflicts`。
