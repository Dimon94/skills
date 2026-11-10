---
name: git-rebase-main
description: 将已完成的任务分支合回本地 main，并关闭对应 Issue、删除任务分支、回收临时工作树。用于本地 rebase、合回主分支与收尾；不推送目标分支。仅更新待发 PR 的分支时直接 rebase。
---

# Git Rebase Main

以线性历史把当前任务合入本地 `main`，再完成收尾。代码集成只在本地执行；Issue 与远端
源分支按 [收尾合同](references/closeout.md) 处理，目标分支不 fetch、不 push。

## 1. 绑定任务

记录仓库、源分支与 HEAD、主工作区、`main` 所在工作树、直接 Issue、验收标准，以及本次
可回收的任务工作树。按 [收尾合同](references/closeout.md) 第 1 步固定远端源 HEAD；
用 `git worktree list --porcelain` 核对路径与分支。源分支为 detached HEAD 或 Issue
对应关系不明时先补齐身份。Issue 确实不存在则记 `none`，不为收尾建票。

完成标准：每个收尾对象都有明确身份与归属；授权范围沿用收尾合同。

## 2. 提交任务改动

本 Skill 只从任务分支合入。当前分支是 `main`，或 `main` 工作树有本任务的改动时，先按
`git-worktree` 第 2 节把改动搬进任务树，之后在任务树里执行本 Skill。

任务树有改动时调用 `git-commit`，只提交已验证且属于本任务的路径。无关改动
保留原位；它们阻止 rebase 或回收时报告 `BLOCKED`，不用提交或清理它们来凑 clean。

完成标准：当前分支是任务分支，待合入改动已在任务分支提交，最小验证通过，源分支与 HEAD 已记录。

## 3. 核对 main 工作树

`main` 工作树里其他作者或其他任务的改动按 `git-worktree` 第 2 节留在原位并报告给用户；
它们阻止第 5 步快进时报告 `BLOCKED`。

完成标准：`main` 工作树不含本任务改动，`main` 的基点已固定，集成不吸收无关改动。

## 4. Rebase

执行 `git rebase main`。真实冲突调用 `resolving-merge-conflicts`；冲突处理中保持任务现场，
不自行 `--abort`。Rebase 后重跑该任务的最小验证并记录新的源分支 HEAD。

完成标准：rebase 完成，验证通过，`main` 是源分支 HEAD 的祖先。

## 5. 快进 main

- `main` 已在工作树检出：在该树执行 `git merge --ff-only <source-head>`，使用已验证的固定 SHA。
- `main` 未在任何树检出：核对旧 `main` 是源 HEAD 的祖先，再用
  `git update-ref refs/heads/main <source-head> <old-main-head>` 推进；回到主工作区检出 `main`。

快进或旧 SHA 核对失败时报告 `BLOCKED`，保留现场。

完成标准：本地 `main` 包含已验证的源 HEAD，主工作区位于 `main`。

## 6. 验证并收尾

在 `main` 上运行最小 post-merge check。通过后执行 [收尾合同](references/closeout.md)
的全部步骤：关闭直接 Issue，回收任务工作树，删除源分支，逐项读回。

完成标准：`main` 验证通过，收尾合同返回 `COMPLETE`。

## 7. 报告

报告新 `main` HEAD、合入提交、任务改动的提交位置，以及收尾合同要求的逐项结果。
合入成功但仍有待关闭或待清理对象时报告 `BLOCKED`，列出恢复动作。
