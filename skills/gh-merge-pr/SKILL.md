---
name: gh-merge-pr
description: Review and merge one GitHub pull request with head-bound freshness, then verify landing parity. Use when the user asks to 审查/合并 PR. Review is read-only by default; merging and issue closeout each require separate explicit authority.
---

# GH Merge PR

Consume one GitHub PR: review its current head, land it, and read back
parity. A bare branch or missing PR routes to `git-push-pr`; nothing enters
landing without a current-head review.

## 1. Bind the item

`gh pr view <n> --json number,headRefOid,headRefName,baseRefName,state,mergeable,reviewDecision,statusCheckRollup,url`.

Record the head SHA. Everything below is bound to that exact SHA; a head
change invalidates the verdict and the review restarts.

## 2. Current-head review

- Checkout or fetch the PR head; review the diff against the base per the
  `code-review` skill (Coding + Architecture + Spec axes).
- Provider state is evidence, not verdict: `reviewDecision`, failing or
  pending checks, and unresolved discussions must each be read, never
  assumed. Pending/unknown/failing checks block landing.
- This step is strictly read-only: no repair commits, no approve, no merge,
  no issue mutation while establishing freshness.

## 3. Land

Requires fresh authority naming this PR and its target.

1. Re-read the head SHA; mismatch → back to step 2.
2. `gh pr merge <n>` with the merge strategy the user named (default
   `--merge`; `--squash`/`--rebase` only when asked).
3. Branch protection or merge queue rejection → stop and report; never
   `--admin` past protection without explicit authority.

## 4. Parity readback

Independently confirm, each by readback:

- PR state is `MERGED` with a merge SHA.
- `git fetch origin <target>`; remote target contains the merge SHA.
- Local `main` fast-forwards to it (`git pull --ff-only`) and the active
  worktree is clean.
- The smallest post-merge check passes.

Any missing or mismatched SHA leaves the result blocked even when the
provider says merged.

## 5. Issue closeout

Only issues the PR body names as `Closes #n` and that close authority covers
may close. Parent/sibling/blocker issues are read back as related-only and
never closed recursively. Verify each issue's closed state by readback after
mutation.

## 6. Report

Merge SHA, parity evidence per item, closed issues, and remaining risks.

## Boundaries

- Review findings in the PR's scope are reported; product defects route to
  the debugging loop, feature gaps route to a new issue — Merge never fixes
  product code itself.
- On conflict during any local rebase, apply `resolving-merge-conflicts`.
