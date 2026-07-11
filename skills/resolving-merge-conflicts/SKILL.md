---
name: resolving-merge-conflicts
description: Resolve an in-progress merge or rebase conflict from proven product intent. Use only when Git reports an actual conflict.
metadata:
  dverity_class: reusable-dependency
  reads: []
---

# Resolving Merge Conflicts

Use this dependency only when Git reports an in-progress merge or rebase
conflict. Confirm the operation, list unmerged paths, and recover both sides'
product intent from current scope truth before editing.

Resolve the smallest conflict whose intent is proven, stage only that path,
then continue the existing Git operation and rerun focused checks. If intent is
ambiguous, abort or stop safely and report the blocker; never invent behavior
to make the operation finish.

Do not start a merge or rebase merely to invoke this Skill. Do not use it for a
clean target refresh, ordinary diff overlap, or speculative cleanup.
