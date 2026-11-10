# 每个写任务一棵工作树，暂停落成 wip 提交

Status: accepted（边界节“不导入 principle-guard-the-context-window”被 0014 取代）

Related: repo://docs/agents/git-branching.md；repo://skills/git-worktree/SKILL.md；repo://skills/dimon-mode/playbooks/pause-safely.md；repo://skills/dimon-mode/playbooks/session-pickup.md；repo://skills/principle-separate-before-serializing-shared-state/SKILL.md

## Context

旧规则：单会话改动直接写在主目录的 main 上，只有 herdr 分派并行任务时才一票一树。实际用法是多个需求同时在做：一个会话写到一半被另一个需求打断，或几个 agent 同时在本机跑。改动都落在主目录时，它们混在同一个工作树里，提交边界只能靠事后挑路径，暂停时也没有地方安放半成品。

pstack 的 pause-safely 剧本要求暂停时在当前分支提交 `wip:`，恢复说明写到会话外；session-pickup 要求接手时读记录、不重做。两者都假设任务有自己的分支。在 main 上暂停，就只能往 main 提交半成品或留下脏目录。

建树的代价是磁盘和内存：每棵树重装依赖、长期不删就会堆积。

## Decision

### 1. 每个写任务一棵树，主目录只做集成

改任何文件前用 `git-worktree` 的 `worktree.sh new` 建树，一行文档也不例外；herdr 分派只是其中一种来源。主目录只 checkout main、只合入。主目录出现未提交改动即违规，用 `git diff` 补丁搬进新树，不用 stash（stash 跨工作树共享，会泄漏到别的任务）。

依据 `principle-separate-before-serializing-shared-state`：并发的写者先分开（各一棵树），再在合入点串行（一次合一棵）。

否决“小改留在 main”的例外：例外要求每次判断大小，判断错一次就回到混写；一行改动建树的成本由下一节的复用压到最低。

### 2. 用脚本安全回收并复用依赖

`worktree.sh` 拥有建、列、收三件事：工作树数量不限，`node_modules`、`.env`、`.venv` 软链 main，`new` 之前自动回收已并入 main、干净、有过提交且无进程占用的树。回收从不 `--force`。并发任务按需建树，资源占用通过依赖复用和及时回收控制。

否决手写 `git worktree add` 加文档纪律：清理条件有四条，靠记忆执行会漏，漏的结果是删掉在用的树或留下垃圾树。

### 3. 暂停落成任务分支上的 wip 提交

用户说“暂停”即授权在任务分支上提交一个 `wip:`；恢复说明写进提交正文，随分支走，不写 `/tmp`。不 push、不碰 main。接手读 `worktree.sh ls` 和 `git log main..<branch>`。

否决恢复说明写 `/tmp/<slug>-resume.md`（pstack 原文）：重启会丢，也和分支脱钩。

### 4. link-skills 只能从主目录运行

`scripts/link-skills.sh` 按脚本所在路径决定链接目标。在任务树里运行，运行时链接会指向一棵随后被删的树。脚本检测到自己在任务树里时直接失败。

## Consequences

### 正面

- 并行需求互不污染，提交边界由树天然给出。
- 暂停和接手有固定落点：分支和它的 wip 正文。
- 并发任务按需建树，依赖不重装，已完成的树及时回收。

### 负面 / 成本

- 每次写任务多一步 `new`，合完多一步 `gc --apply`。
- 改了 lockfile 的任务要手动断软链重装。
- `gc` 不清理 `prunable` 旧记录和未合入的旧分支，它们要人工决定。

### 边界

- 本 ADR 取代 git-branching 旧版“单会话直接写 main、仅 herdr 分派建树”的规则；该规则此前没有 ADR。
- 不裁决远端分支删除、PR 流程（归 git-push-pr、gh-merge-pr）。
- 不导入 `principle-guard-the-context-window`：锁定 commit 下它只有一条要点，且 description 要求把大块内容交给子代理，与“用户没要求就不拉子代理”冲突；session-pickup 剧本改为读尾部加 grep 决策点。
- 回退：删除 `skills/git-worktree`、两个剧本和路由行，git-branching 与 AGENTS.md `<branching>` 改回旧文。
