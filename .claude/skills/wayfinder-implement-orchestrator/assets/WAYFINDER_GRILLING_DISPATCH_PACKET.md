# Wayfinder Grilling 会话派发包

当 wayfinder map issue 走到未阻塞的 `wayfinder:grilling` child issue，或任何需要实时用户判断的
discovery child issue 时，填写这个 packet。一个 grilling child issue 对应一个用户运行的
fresh thread，承载完整拷问会话；不要每个问题开一个线程。

```text
项目：
父编排线程：
Wayfinder map issue：
Ticket issue：
Ticket title：
Ticket label：wayfinder:grilling
基线分支：
基线提交：
拷问目标：
需要解决的决策分支：
-

路由：
- 使用该 map issue 和 ticket issue 调用 /wayfinder。
- 只解决这个 child issue。
- 把 /grilling 作为一个连续会话使用；当术语需要钉住时使用 /domain-modeling。
- 一次只问一个问题并等待用户反馈，然后继续问下一个依赖问题，直到这个 ticket
  resolved 或 blocked。
- 每个问题都给出你的推荐答案。
- 不要在第一个回答之后就返回父线程。
- 如果某个问题可以通过探索代码库或已链接 artifacts 回答，就先探索，不要问用户。

真相源：
- Map issue：<title/link>
- Ticket issue：<title/link>
- Wayfinding operations：docs/agents/issue-tracker.md | local-markdown fallback
- 既有产物：
-

允许范围：
- 这个 ticket issue 的 body/comments/labels/close state
- Map issue 的 Decisions-so-far 和 Fog index 行
- 如果 /domain-modeling 需要，可以修改 domain glossary 或 ADR 文件
- 禁止范围：

执行规则：
- 需要分支时，只在本 worktree 目录内创建/切换；不要切换主目录/source worktree 的分支。
- 如果 ticket 仍 open 且未 claimed，先设置 `wayfinder:claimed` 并读回确认；如果已被
  别的 session claimed，停止并报告 blocker。
- resolved 后，把 answer 写成 ticket 的 resolution comment，close ticket，并给
  map Decisions-so-far 追加 title link + gist；不要把完整 answer 粘贴进 map。

返回父线程：
- 只有当整个 grilling ticket resolved 或 blocked 后，才发现
  `send_message_to_thread`。
- 如果可用，把下面的紧凑父线程 handoff 发给父编排线程。
- 如果不可用，把紧凑父线程 handoff 放进 final answer，供用户粘贴回父线程。

Final report：
Ticket：
状态：resolved | blocked
线程：
Worktree：
分支：
Commit：<hash subject> | none
父线程 handoff：sent | unavailable | failed <reason>
Tracker 变更：
-
Docs 变更：
-
新增或解除阻塞的 child issues：
-
Wayfinder Next steps：
-
阻塞：
-
下一门禁建议：proof | more-discovery | ask-user | blocked

父线程 handoff message：
Ticket：
状态：
线程：
Tracker 变更：
Docs 变更：
新增或解除阻塞的 child issues：
阻塞：
下一门禁建议：
```
