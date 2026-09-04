---
name: git-push-pr
description: Push a verified branch and create or update exactly one GitHub pull request. Use when the user asks to 推送远程/建 PR/更新 PR and grants push authority. Read-only without explicit authority; never approves, merges, or closes issues.
---

# Git Push PR

Push the current branch and bind it to exactly one GitHub PR. Push and PR
mutation require explicit authority for this branch; without it, run the
checks below read-only and report what would happen.

## 1. Prove the branch

- Worktree is clean. Dirty → commit per `git-commit` first, or stop.
- Fetch the target (`git fetch origin <target>`), then prove the branch is
  ahead of `origin/<target>` and not behind it (behind → route to
  `git-rebase-main` or rebase onto the fetched target first).
- The smallest verification for the diff has run. Unverified work does not
  get pushed.

## 2. Check existing PRs

`gh pr list --head <branch> --json number,state,headRefName`.

- Zero → create in step 3.
- Exactly one → update it (title/body refresh if the branch's story changed).
- More than one open for the same branch → stop, report the duplicate.
  Never batch-create.

## 3. Push and bind

1. `git push -u origin <branch>`. Non-fast-forward rejection → stop and
   report; never force-push without explicit rewrite authority.
2. Create (`gh pr create`) or update (`gh pr edit`) the one PR. Body states
   problem, change, verification; link issues with `Closes #n` only for
   issues this PR directly resolves.
3. Read back `gh pr view --json url,headRefOid,state` and confirm the PR head
   matches the local commit just pushed.

## 4. Report

PR URL, branch, pushed head SHA, and that approval/merge was left untouched.

## Boundaries

- No `gh pr merge`, no approval, no issue close — those belong to
  `gh-merge-pr`.
- Remote-write authority covers this branch and this one PR only.
