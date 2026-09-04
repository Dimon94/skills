---
name: git-commit
description: Create narrow auditable local commits. Use when verified work must be staged and committed without absorbing unrelated changes.
---

# Git Commit

Create local commits only. Inspect `git status --short --branch` and every dirty
path before staging. Classify each path as in-scope or leave untouched.

Stage explicit paths or hunks for one semantic boundary. Inspect the cached
diff, run `git diff --cached --check`, and run the smallest check that proves
the staged change. Commit with a Conventional Commit subject and an audit body
covering problem, change, reason, verification, and risk.

Do not use broad staging in a mixed tree. Do not push, open a review item,
merge, or switch the source worktree's branch. After commit, report the hash
and prove unrelated dirt remains untouched.
