---
name: git-commit
description: Create narrow auditable local commits. Use when verified work must be staged and committed without absorbing unrelated changes.
---

# Git Commit

## Codex 委派

Codex 父会话调用本 skill 时，将本地提交交给一个内部 subagent，显式请求
`model: gpt-5.6-luna`、`reasoning_effort: high`；不新建 App task 或 worktree。
先核对宿主 spawn schema 与自定义角色覆盖；完整历史 fork 不支持模型覆盖时使用
`fork_turns: none`，传递本 skill 的绝对路径与完整提交任务。

父会话先明确已有的提交授权、目标 repo/worktree、允许提交的路径或 hunks、必须保留的
改动及验证命令/证据。Luna 负责下面的检查、语义拆分、staging、验证与本地 commit；
父会话及其他子代理在此期间停止写该 worktree 和 index。授权或范围不清时先澄清。

执行该提交的 Luna 子代理直接执行下节，不再次委派本 skill。启动失败或角色覆盖导致
模型不匹配时，报告受阻，不静默换模型。运行 model/effort 无宿主 readback 时记 Unknown，
不能以请求参数或模型自述证明配置生效。非 Codex runtime 沿原生方式执行下节。

Luna 回传 commit hash、提交路径、验证结果及剩余 dirty。父会话用 Git 读回核验提交内容
与范围，确认无关改动保留后再报告完成。修改本 skill 本身不构成提交授权。

## 本地提交

Create local commits only. Inspect `git status --short --branch` and every dirty
path before staging. Classify each path as in-scope or leave untouched.

Stage explicit paths or hunks for one semantic boundary. Inspect the cached
diff, run `git diff --cached --check`, and run the smallest check that proves
the staged change. Commit with a Conventional Commit subject and an audit body
covering problem, change, reason, verification, and risk.

Do not use broad staging in a mixed tree. Do not push, open a review item,
merge, or switch the source worktree's branch. After commit, report the hash
and prove unrelated dirt remains untouched.
