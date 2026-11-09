# 大块读取交给子代理，同一棵树同一时刻一个写者

Status: accepted

Related: 取代 repo://docs/adr/0013-worktree-per-write-task.md 边界节“不导入 `principle-guard-the-context-window`”一条；repo://skills/principle-guard-the-context-window/SKILL.md；repo://skills/dimon-mode/SKILL.md 子代理节；repo://skills/dimon-mode/playbooks/session-pickup.md；repo://docs/agents/git-branching.md 第 7 条“一票一写者”

## Context

旧规则“用户没要求就不拉子代理，单线做完”落在四处：`AGENTS.md` `<workflow>`、dimon-mode 子代理节、session-pickup 第 2 步、ADR 0013 边界节。ADR 0013 据此不导入 `principle-guard-the-context-window`：该叶子的 description 要求把大块内容交给子代理，与旧规则冲突。

2026-11-09 用户取消旧规则：“我的没要求就不拉子代理的规则可以去掉”。冲突消失。

来源：pstack（cursor/plugins@6b03002）。`skills/poteto-mode/SKILL.md:94,100` 让子代理写代码，产物由主线自己审、自己总结；`skills/poteto-mode/playbooks/orchestrate.md:9` 一个分支只有一个写者；`skills/figure-it-out/SKILL.md:31`、`skills/swarm/SKILL.md:23` 只在并行写时给每个 worker 单独的树。锁定版叶子正文只剩“按阶段定量，限定范围”一条，其余由上游 08bd59b 删去，规则主要在 description。

## Decision

### 1. 导入叶子，规则由索引行承载

按锁定 commit 导入 `principle-guard-the-context-window`。`AGENTS.md` `<principle_index>` 写全触发和规则：大输出、长文件、反复读、扇出规划时，大块交给子代理，主线只留摘要。

### 2. 子代理在当前任务的树里执行

隔离单位是票：一票一会话一棵树。子代理不另开树。同一时刻只有一个写者：并行的子代理只读；要写文件的子代理串行跑，它写时主线不写。需要并行写时拆成票，各走各的树。

被否决：每个写文件的子代理各开一棵树。这是 pstack 对并行写的要求，票内串行写不需要；本机的并行写已经由拆票承载。

### 3. 主线自己审子代理的产物

拉了子代理，主线自己审它的产物，写自己的总结，不转述。叶子没有这条，删了 agent 会原样转交报告。

### 4. 旧规则的四处落点同时改

`AGENTS.md` `<workflow>` 删去“不默认并行拉起多个 agent”，保留“一个任务先做完，再决定是否拆分”；dimon-mode 子代理节按第 2、3 节重写；session-pickup 第 2 步改为长记录交给子代理读；ADR 0013 状态行标注本 ADR 取代的那一条。

## Consequences

### 正面

- 长日志、长会话记录和调研扇出不再挤占主线上下文。
- 并发写的约束由“一票一写者”统一表达，不靠“不拉子代理”间接保证。

### 负面 / 成本

- 子代理的模型按用户配置执行，额度消耗增加；Skill 不写模型。
- 票内不做 arena 式并行写，比 pstack 严。

### 边界

- 不改 `docs/agents/git-branching.md`；它的“并行 agent 只读，写入用独立 worktree”管跨票并行。
- 不改 project-template：`template/AGENTS.md:64` 已允许只读调查并行。
- 回退：删除叶子与索引行，四处落点改回旧文，ADR 0013 状态行去掉标注。
