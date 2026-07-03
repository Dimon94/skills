# Fresh Session 边界

派发任何可执行工作前读取本文件。

## 默认 Fresh

- Wayfinder `Research`、`Prototype` 和可自动执行的 `Task` child issues：每个 child
  issue 一个 fresh `/wayfinder` child session。
- child 发现的 Wayfinder follow-up tickets：父线程重读 map issue 和 frontier query，
  然后派发下一批 fresh sessions；children 不打开后代线程。
- PRD synthesis：当 seams 已批准时，用 fresh `/to-prd` session 基于 map proof
  起草或发布；否则 child 返回 seam proposal，由父线程问用户。
- Issue splitting：基于已批准 PRD，用 fresh `/to-issues` session 起草或发布；
  如果 split 尚未批准，父线程先问用户再发布。
- Implementation：每个 tracker issue 一个 fresh `/implement` child session。
- Integrated review：父线程集成后，在可用时使用 fresh read-only `/code-review`
  或 repo-native review child。
- Remote CI/CD 或 review-agent fixes：把每个需要改代码的 fix 转成 tracker issue，
  或父线程明确批准的 micro-issue，再派发 fresh `/implement` child。
- 有争议的 review-agent comments：如果 verdict 不明显，用 fresh read-only child
  收集证据，然后父线程发布 PR/MR rebuttal/adaptation note。

## 父线程持有

- Human judgement gates 和 user questions。
- 判断哪个 child batch 可以安全派发。
- `create_thread`、`automation_update` 和 child coordinate records。
- Wayfinder frontier query、selection 和下一轮 dispatch。
- Integration branch cherry-picks、conflict resolution，以及 PR/MR push/open/update。
- PR/MR comments、review-agent rebuttals，以及 final remote-gate completion。
- 创建 worktree 或需要分支时，只在目标 worktree 目录内创建/切换分支；不要切换
  主目录/source worktree 的分支。

## 应该停止

不要为 live user grilling、未解决的 product choices、不清晰的 issue splits、
重叠 mutable resources、缺失 source truth，或任何无法从持久真相源验证验收标准的
work item 创建 child thread。

## 最小 Child Prompt

PRD、issue-splitting、review 和 evidence-gathering children 使用
`GATE_CHILD_DISPATCH_PACKET.md`。

## 未注册 Worktree Targeting

如果 source artifacts 位于 `list_projects` 无法 target 的 worktree，就在最近的已注册
project 创建 child。这件事本身不是 user stop。map/ticket issue 仍通过 tracker 坐标
读写。

记录两组坐标：

- Execution target：用于创建线程的已注册 project/worktree。
- External coordinates：tracker map/ticket issue URLs、source worktree 里的 proof 和
  artifact paths。

除非 packet 明确列出 write target，否则 external coordinates 都是只读。对 discovery
tickets，唯一允许的 external writes 是 tracker map/ticket issues 和列出的 artifact
paths。用一行向用户报告这个 fallback；当 thread tools 可用时，不要以手动
copy-paste instructions 结束。
