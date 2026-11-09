---
name: git-worktree
description: 为每个写任务建独立工作树，并在暂停、接手、主工作树脏了或收尾时管理这些树。用于改任何仓库文件之前、用户说“暂停”、接手上一段会话，以及清理工作树时；同时用 WT_MAX 上限、软链复用和自动回收控制磁盘与内存。
---

# Git Worktree

主工作树只做集成：checkout `main`，不直接写。每个写任务（一行文档也算）在自己的树和分支里做。树的建、看、收都走本 Skill 目录下的 `scripts/worktree.sh`，不手写 `git worktree add`。

```bash
WT="<本 Skill 目录>/scripts/worktree.sh"
cd "$(bash "$WT" new feat/<scope>)"   # 建树，打印路径；可加第二参数作起点
bash "$WT" ls                          # 在做清单：branch ahead dirty procs last path
bash "$WT" gc                          # 只报告；gc --apply 才回收
```

## 1. 写之前建树

改文件前在仓库任一工作树内运行 `new <type>/<scope>`，type 取 `fix`、`feat`、`research`、`chore`、`docs`，之后的读写、测试、提交都在打印出的路径里做。

起点默认是集成基准：本地 `main` 没有自己的提交且有上游时取上游（如 `origin/main`），否则取 `main`。经 PR/MR 合入的项目先 `git fetch`，再建树。集成分支下的子任务把集成分支作为第二参数传入。

- `new` 先回收可证明安全的树，再查上限。退出码 3 表示已有 `WT_MAX` 棵活跃树（默认 4）：stderr 里有在做清单，先把其中一棵收尾或暂停，不调高上限绕过。
- 退出码 4 表示分支已存在：那是一棵在做或暂停的树，去接手它，不另起同名任务。
- 新树里 `node_modules`、`.env`、`.venv` 是指向主工作树的软链，不重装、不复制。本任务改了 lockfile 或依赖版本时，删掉该软链再在本树安装。

完成条件：当前目录是新树，`git branch --show-current` 是任务分支。

## 2. 主工作树脏了

主工作树出现未提交改动就是违规，先盘点再搬走，不 stash（stash 在所有工作树间共享）：

1. `git -C <main> status --short` 列出每个路径，逐个判断归属；不属于当前任务的改动不动，报告给用户。
2. 属于当前任务的：在主工作树 `git diff --binary -- <paths> > /tmp/<scope>.patch`，未跟踪文件先 `git add -N` 让它进 diff。
3. `new` 建树，在树里 `git apply /tmp/<scope>.patch`，确认 `git diff --stat` 与原改动一致。
4. 回主工作树 `git restore --staged --worktree -- <paths>`，再删掉搬走的未跟踪文件。

完成条件：主工作树 `git status --short` 不含已搬走的路径，新树含全部改动。

## 3. 暂停

只在用户明确说暂停时执行。“继续”“我去睡了你接着做”不是暂停。

1. 停在安全边界：做完或退回当前这一步，不开新步骤。
2. 不做不可逆动作：不 push、不建 PR、不碰 `main`。
3. 在任务分支上提交一个 `wip: <scope>`，包括坏掉的树。“暂停”本身授权这一次提交，只限本分支。
4. 恢复说明写进这个提交的正文，不写到 `/tmp` 或会话里：目标、做到哪、已验证什么、下一步第一个动作、关键文件、坑。

回复写：停在哪一步、已落盘的提交与树是否干净、恢复时第一个动作。这是暂停，不是交付报告。

## 4. 接手

用 `ls` 找到任务树，再读：

```bash
git log --format='%h %s%n%b' main..<branch>   # wip 正文就是恢复说明
git -C <path> status --short
```

wip 正文和提交历史是权威输入，不从头重做已完成的部分。接着做之前，先在真实产物上核一遍继承来的“已通过”。树里有 wip 提交时，交付前把它和后续改动整理成语义提交。

## 5. 收尾与回收

一次只合一棵树。本地集成的项目用 `git-rebase-main` 合回 `main`；经 PR/MR 合入的项目在平台合并后，主工作树 `git fetch` 并 `git merge --ff-only` 跟上上游。合完后在主工作树运行 `gc --apply`。

`gc` 只删同时满足这四条的树和分支：没有未提交改动（软链不算）、有过提交、已并入集成基准、没有进程把工作目录放在树里。已并入包括 squash 合入和逐个 rebase 合入：补丁已在基准里就算。其余写明原因保留：`dirty`、`empty`、`unmerged`、`in-use:N`。它从不 `--force`。`prunable` 行是目录已不在的旧记录，只报告；清理它们要单独决定。

废弃的任务不会被自动回收：确认不要后，按用户授权删除树和分支。
