---
name: wayfinder-implement-orchestrator
version: 1.0.0
description: Orchestrate tracker-backed Wayfinder maps through PRD, issues, issue-level implement threads, and one summary PR/MR.
disable-model-invocation: true
skill_class: user-entry
route_family: main
reads:
  - references/gate-state-machine.md
  - references/fresh-session-boundaries.md
  - references/wayfinder-frontier-loop.md
  - references/child-monitoring.md
  - references/remote-closeout-checklist.md
  - assets/GATE_CHILD_DISPATCH_PACKET.md
  - assets/WAYFINDER_TICKET_DISPATCH_PACKET.md
  - assets/WAYFINDER_GRILLING_DISPATCH_PACKET.md
  - assets/ISSUE_IMPLEMENT_DISPATCH_PACKET.md
  - ../cc-diagnose/references/toc-thinking-processes.md
writes: []
---

# Wayfinder Implement Orchestrator

只有当用户用 tracker 上的 wayfinder map issue、需要变成 shared map 的松散想法，
或已批准的 PRD/issues 集合调用时，才使用本 skill。它只负责编排链路；不替代
`/wayfinder`、`/to-prd`、`/to-issues` 或 `/implement`。

## 启动

1. 读取或创建最小 wayfinder map issue、离工作最近的 repo instructions、
   `docs/agents/issue-tracker.md` 的 Wayfinding operations，以及任何已引用的
   research/prototype artifacts。完成标准：map issue 坐标、tracker 表达 child
   issues/blocking/frontier 的方式、每个当前真相源坐标都已知道或标为 `Unknown`，
   每个未阻塞且未 claimed 的 discovery child issue 都已知道。
2. 加载 `references/gate-state-machine.md`。完成标准：已识别当前门禁、真相源和
   下一门禁。
3. 如果当前 map/gate 涉及根因、因果、冲突、隐藏假设或不确定影响，加载
   `../cc-diagnose/references/toc-thinking-processes.md`。完成标准：当前门禁已有
   TOC 记录，或缺失的 CRT 边、Conflict Cloud 假设、Injection 证据、PRT 障碍、
   NBR 风险被标成 frontier / user stop / `Unknown`。
4. 加载 `references/fresh-session-boundaries.md`。完成标准：每个可执行 work item
   都已分类为 fresh child、parent-owned gate 或 user stop。
5. 如果要派发 PRD、issue 拆分、review 或 evidence-gathering gate child，加载
   `assets/GATE_CHILD_DISPATCH_PACKET.md`。完成标准：可以不依赖聊天记忆填写一个
   gate packet。
6. 如果要派发 discovery child issues，加载
   `references/wayfinder-frontier-loop.md` 和
   `assets/WAYFINDER_TICKET_DISPATCH_PACKET.md`。完成标准：可以不依赖聊天记忆为每个
   child issue 填写一个 packet。
7. 如果下一个 discovery child issue 是 `wayfinder:grilling` 或需要实时判断，加载
   `assets/WAYFINDER_GRILLING_DISPATCH_PACKET.md`。完成标准：一个 copy-paste
   prompt 能让用户在 fresh thread 跑完整拷问会话，并把结果带回父线程。
8. 如果要派发 implementation issues，加载
   `assets/ISSUE_IMPLEMENT_DISPATCH_PACKET.md`。完成标准：可以不依赖聊天记忆为每个
   issue 填写一个 packet。
9. 如果 child threads 正在运行，加载 `references/child-monitoring.md`。完成标准：
   每个 child 都通过 startup probe，然后存在 5 分钟 automation reminder；如果缺少
   automation 支持，就报告手动检查坐标。
10. 如果要收尾 summary PR/MR，加载 `references/remote-closeout-checklist.md`。完成标准：
   所有 child results、commits、checks、issue links、CI/CD 和 review-agent verdicts
   都已映射。

## 规则

- 所有面向用户、子线程、heartbeat、handoff 和 PR/MR comment 的自然语言都用中文。
  skill 名、tool 名、状态枚举、路径、分支名、commit hash 和代码字面量保持原样。
- 每个门禁只保留一个真相源：discovery 用 `wayfinder:map` issue 和它的 child
  issues，product scope 用 PRD issue，implementation slices 用 tracker issues，
  execution 用 child thread readback 加 Git commits，final review 用 PR/MR。
- 用 TOC 记录判断复杂门禁：discovery 找缺失 CRT 边和 Conflict Cloud 假设，PRD
  写清 what to change / what to change to / how to cause change，issues 拆成
  Injection / prerequisite / transition step，integration 用 FRT/NBR 查合并负分支。
- Wayfinder map 是 index，不是 store。决策细节留在 resolved child issue 的
  resolution comment 和 linked artifacts；map 的 Decisions-so-far 只追加一行
  title link 加 gist。
- 面向人读的 map/ticket 引用用 issue title link；裸 id/number/url 只作为坐标。
- 只在判断门禁问用户：未解决的 discovery choice、PRD seam approval、issue split
  approval、模糊 dispatch batch、integration 失败、未授权 remote action、有效的
  review-agent rejection，或 `Unknown` review-agent rejection。
- Summary PR/MR 打开不等于完成。只有 remote CI/CD 通过，且远程 review Agent 评论说
  PR/MR can pass，才算完成。
- 如果 review Agent 错了，在 PR/MR 评论里用证据反驳，然后再留一条记录解释为什么
  可能触发该 review，以及 review Agent 应该学习什么。
- 不要持续读取 child threads。派发后创建 5 分钟 reminder automation，停止主动循环，
  只在 wake-up 或 child handoff 时检查进度。
- 未阻塞且未 claimed 的 discovery frontier 是可执行工作，不是用户 prompt。除非有
  停止条件或缺少工具阻止派发，否则自动创建 child threads。
- Discovery child issue 必须回答一个具体 TOC 缺口：CRT 因果边、Conflict Cloud
  假设、Injection 证据、PRT 障碍或 NBR 风险。Loose topic 先改写成缺口，再派发。
- 如果 source worktree 不是可创建线程的 project target，使用
  `references/fresh-session-boundaries.md` 里的 fallback，并只报告一次。
- 创建 worktree 或在某个 worktree 内工作时，不要切换主目录/source worktree 的
  分支。需要新分支时，只在目标 worktree 目录内创建/切换该分支。
- 只有 `create_thread` 不够。进入监控前，读取每个 child 一次，确认它已经从 dispatch
  prompt 启动；空线程或 interrupted 线程不算已派发。
- bounded execution 优先用 fresh sessions。父线程拥有 gates、user questions、
  integration、remote comments 和 PR/MR authority。
- 只把 issue-level `/implement` 工作派发为 child Codex threads。一个 issue 一个
  fresh session。不要把 loose TODOs、layers、workstreams 或 research/prototype
  tickets 当作 implementation children 派发。
- 如果多个 implementation issues 属于同一可派发 batch，先创建所有 child threads，
  再创建 heartbeat；不要串行化彼此独立的 issues。
- Codex thread tools 可用时就使用：发现 `create_thread`、
  `list_threads`、`read_thread`、`send_message_to_thread` 和
  `automation_update`；如果不可用，带着手动 child-session 坐标停止，不要假装已经
  并行派发。
- 不要调用或复制 cc-dev workflow。它的 child-thread mechanics 只作参考；本 skill
  有自己的 gates，且没有 `task.md` contract。

## 最小示例

用户说：

```text
使用 $wayfinder-implement-orchestrator 处理 <wayfinder map issue URL>。
先跑 research/prototype/task tickets，再进入 PRD/issues，然后并行派发 issue-level
/implement threads，最后汇总到一个 summary PR/MR。
```

执行：

1. 运行 wayfinder frontier loop：查询 open、未阻塞且未 claimed 的 discovery child
   issues，派发成 fresh `/wayfinder` sessions；每轮结束重读 map issue 和 frontier；
   重复直到 map 有足够证据进入 PRD，或需要用户判断。
2. 如果 map 暴露人为 product 或 architecture choice，停止；否则运行 proof gate。
3. 在边界清晰时使用 fresh PRD synthesis session；遇到 `/to-prd` 需要的 seam
   approval 时回到父线程停止；然后发布 PRD。
4. 在边界清晰时使用 fresh issue-splitting session；遇到 issue split approval
   时回到父线程停止；然后按依赖顺序发布 issues。
5. 对 ready issues 并行派发，每个 `/implement` child thread 一个填好的 issue
   packet。
6. 创建 5 分钟 child-progress reminder；wake-up 时读取 terminal child reports，
   集成已验证 commits，运行 focused 和 whole-change checks，打开或更新一个 summary
   PR/MR，然后等待 CI/CD 和 review-agent approval。
