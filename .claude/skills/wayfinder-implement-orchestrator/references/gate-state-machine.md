# 门禁状态机

在 `SKILL.md` 第 2 步之后读取本文件。

## 门禁

| Gate | 真相源 | 通过条件 | 何时停下问用户 |
| --- | --- | --- | --- |
| `discovery` | Wayfinder map issue 和 child issue frontier | 必要 research/prototype/task child issues 已 closed，resolution comments 和必要 linked artifacts 存在 | 任何未解决的 product、architecture、access 或 risk choice |
| `proof` | Closed child issue resolutions 加 linked artifacts | 证据支持 PRD，且没有隐藏假设 | proof 缺失、冲突或 stale |
| `prd` | 已发布 PRD issue/doc | 已捕获用户批准的 seams 和 scope；旧 tracker candidate overlap 已记录但未误判为 duplicate | Seam approval、scope tradeoff、精确 duplicate、或 tracker failure |
| `issues` | 已发布 tracker issues | 已批准 vertical slices 有真实 issue IDs、read-back bodies 和 dependencies；duplicate 只按当前 PRD 父项判断 | Split/merge/dependency judgement、当前 PRD 下的 duplicate、或 partial publish |
| `dispatch` | Tracker issues | Ready issues 没有 blocking dependencies 或 mutable-resource conflicts | issue set 模糊、files/resources 重叠、缺少 base branch |
| `collect` | 5 分钟 automation wake-up、child thread readback | 每个 child 报告 status、commit if changed、checks、dirty state、touched files | child blocked/off-scope 或缺少 final report |
| `integrate` | integration branch 上的 Git commits | child commit 已检查、clean、in-scope，且 integration 后 focused checks 通过 | conflict、scope drift、failed check |
| `remote-review` | GitHub PR 或 GitLab MR、CI/CD status、review-agent comments | PR/MR 链接 PRD/issues/child threads/commits/checks/risks，CI/CD 通过，且 review Agent 说 PR/MR can pass | Push/open PR/MR 权限不清晰、CI/CD 失败、valid/Unknown review rejection，或未解决的 review-Agent mistake |

## 流程

```text
discovery -> proof -> prd -> issues -> dispatch -> collect -> integrate -> remote-review
```

不要跳过门禁。如果某个门禁无法证明，要么运行最小缺失前置步骤，要么停下来让用户判断。

## Discovery Tickets

Research、prototype 和 task child issues 属于 `/wayfinder`，不属于 `/implement`。
通过 `wayfinder-frontier-loop.md` 执行它们。ticket resolved 后，把 answer 写成
resolution comment，close ticket，把 artifact link 留在 ticket，并给 map
Decisions-so-far 追加 title link + gist；不要把完整 answer 或 artifact 复制进 map。

如果 frontier query 返回未阻塞且未 claimed 的 `wayfinder:research`、
`wayfinder:prototype` 或可自动执行的 `wayfinder:task` child issues，且表格没有要求
停下问用户，就在同一轮派发这些 tickets。不要以“让用户复制粘贴 child prompts”结束。

## Implementation Batch

只有当 batch 内每个 issue 都满足以下条件时，才派发 batch：

- 已发布到 tracker；
- 没有 dependency 阻塞，或 prerequisites 已满足；
- 大小适合一个 fresh `/implement` session；
- 在 files、migrations、locks、external resources 或 release ordering 上与 sibling
  独立；
- 足够清晰，acceptance criteria 不需要父线程聊天记忆也能验证。

如果任何条件是 `Unknown`，把该 issue 从 batch 移除，或询问用户。在同一个 dispatch
turn 中为剩余每个 issue 创建一个 `/implement` child，然后用一个 heartbeat 监控整个
batch。

## Tracker 去重

宽关键词搜索只能发现候选，不能单独阻止发布。精确 duplicate 必须同时匹配当前批准
PRD/slice、父子关系或 source 坐标、acceptance/禁止范围和门禁类型。历史迁移项、旧父
PRD 下的实现 issue、低 IID 旧项、closed/stale 项，或只覆盖部分术语的宽 PRD，都记录为
candidate overlap；除非用户明确选择复用/更新，否则不要把它们当成当前链路的完成产物。

## 上下文预算

派发后，不要让父线程持续推理循环保持打开。使用 `child-monitoring.md` 里的 5 分钟
reminder；每次 wake-up 只读取判断 child 是 still running、blocked，还是 ready for
the next gate 所需的紧凑状态。
