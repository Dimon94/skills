# PR/MR 收尾清单

只有当所有必要 issue children 已 terminal，或已明确 out of scope 时才读取本文件。

## Child Result Audit

- 用 `read_thread` 读取每个 child thread；不要只相信 notification。
- 确认 final report 字段：issue、status、worktree、branch、commit、verification、
  dirty state、touched files、blockers、recommendation。
- 集成前检查每个 commit：`git show --stat --oneline <hash>` 和 focused diff。
- 拒绝包含无关文件、缺失验证、dirty worktree，或把 blocker 包装成 success 的 commits。

## Integration Audit

- 只把已验证 child commits cherry-pick 或以其他方式集成到 integration branch。
- 每集成一个 child 后，运行该 issue 的 focused verification。
- batch 完成后，运行能证明 PRD 的最小 whole-change check。
- remote submission 前运行 `/code-review` 或 repo-native review gate。
- 如果 review gate 要并行 sub-agents，优先用 `spawn_agent`。
- 如果指定 `agent_type`，不要同时做 full-history/context fork。使用 no-context spawn
  或 `fork_context: false`，并显式传入完整 review 包：base commit、integrated diff、
  PRD/issues、验证结果、只读要求和输出格式。
- 如果工具只支持 full-history `fork_thread`，不要指定 `agent_type`；如果无法形成有效
  sub-agent 调用，就在本线程运行同等的 Standards 和 Spec diff review，并把 fallback
  记录到 PR/MR evidence。

## Summary PR/MR Body

包含：

- PRD link。
- 已实现 issue links。
- Child thread IDs。
- Integrated commits。
- Verification commands and results。
- 被 blocked 或 skipped 的 issues，以及原因。
- 已知 residual risk。

如果用户尚未授权 remote action，push/open/update 前先问。

## Remote Pass Gate

- 根据 remote host 选择正确对象：GitHub 用 PR，GitLab 用 MR。
- 打开或更新 PR/MR 后，从 tracker 或 host API 读取 remote CI/CD status。
- 读取 PR/MR comments，确认 automated review Agent verdict。
- `pending`、missing、failed 或 ambiguous CI/CD 都不算完成。
- review-agent requests、failures 或 absent verdict 都不算完成。
- 只有 CI/CD 通过，且 review Agent 明确说 PR/MR can pass，才算完成。

## Review-Agent Mistake

对每个 blocking review-agent comment：

1. 基于 code、tests、artifacts 和 PR/MR diff evidence，把它分类为 `valid`、`invalid`
   或 `Unknown`。
2. 如果是 `valid`，完成前先修复或派发 follow-up issue。
3. 如果是 `Unknown`，询问用户或收集最小缺失证据。
4. 如果是 `invalid`，在 PR/MR 里用简短反驳和直接证据回复。
5. 在 PR/MR 里留下 adaptation note，记录为什么可能触发该 review，以及未来
   review-agent behavior 应如何改变。

对 invalid review 使用这个中文评论形状：

```text
Review-agent 反驳：
- 评论：<link 或简短引用该 claim>
- 结论：invalid
- 证据：<file/test/artifact/API result>
- 原因：<为什么该 claim 不适用>

Review-agent 适配记录：
- 可能触发原因：<pattern, missing context, stale assumption, or heuristic>
- 期望后续行为：<review Agent 应该学习的具体规则>
```

不要因为已经反驳就把 PR/MR 标为完成。完成仍要求 passing review-agent verdict，或用户
明确指示带着 unresolved remote-gate risk 停止。
