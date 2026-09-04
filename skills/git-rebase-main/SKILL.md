---
name: git-rebase-main
description: Land a finished branch on local main with linear history — commit pending work, commit main's own dirt first, rebase onto main, fast-forward main. Use when the user asks to rebase/merge/合回主分支 into local main after work is committed. Local only, never touches remotes.
---

# Git Rebase Main

Land the current branch on local `main` with linear history. Local only:
never push, never fetch, never delete the branch afterward.

## 1. Commit pending work here

If the current worktree is dirty, commit it per the `git-commit` skill.

## 2. Already on main → done

If the current branch is `main`, that commit was the landing. Report and stop.

## 3. Commit main's own dirt first

Locate main's worktree with `git worktree list --porcelain`. If `main` is
checked out somewhere and that worktree is dirty, commit it there per the
`git-commit` skill — before the rebase, because that commit advances `main`
and the branch must rebase onto the advanced head.

## 4. Rebase onto main

`git rebase main`. On conflict, apply the `resolving-merge-conflicts` skill;
never `--abort`.

## 5. Advance main to the rebased head

- `main` checked out in a worktree → run `git merge --ff-only <branch>` there.
- `main` not checked out anywhere → run `git branch -f main <branch>` here.

If the merge is not fast-forward, stop and report. Do not force anything.

## 6. Report

New `main` head, commits landed, where dirt was committed (if any), and that
the source branch was left intact.
