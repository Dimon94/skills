---
name: git-commit
description: Create narrow auditable local commits. Use when verified work must be staged and committed without absorbing unrelated changes.
---

# Git Commit

Create local commits only. One semantic boundary per commit; scope stops at
the commit — no push, review item, merge, or branch switch.

```text
git status --short --branch
for each dirty path
  in-scope  → stage explicit paths or hunks
  untouched → leave alone
inspect cached diff; run git diff --cached --check
gate: passing build, or smallest test red → green
  gate fails → stop, no commit
commit with this shape:

<type>(<scope>): <imperative subject, ≤72 chars>

Problem:  what was wrong or missing
Change:   what this commit does
Reason:   why this approach over the alternative
Verify:   the check run and its result
Risk:     what could still break or was not covered
```

Filled example:

```text
fix(auth): reject expired tokens at the middleware boundary

Problem:  expired tokens passed middleware and failed deep in handlers
Change:   validate exp claim once in authMiddleware, return 401 there
Reason:   one guard at the boundary beats a guard in every handler
Verify:   pnpm test auth — 12 passed, including new expiry case
Risk:     clients with clock skew may see earlier 401s
```

After commit, report the hash and the pre-commit `git status` output showing
unrelated dirt untouched.
