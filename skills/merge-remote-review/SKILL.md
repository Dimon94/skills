---
name: merge-remote-review
description: Review and land one authenticated provider-native review item. Use when current-head review, landing, closeout, and remote-main parity are in scope.
metadata:
  dverity_class: workflow-entry
  reads:
    - ../../DVERITY.md
---

# Merge Remote Review

Read `../../DVERITY.md` and own only Merge through Verified Remote Main. The
entry accepts one authenticated provider-native review item. A bare branch,
remote task, missing item, anonymous record, or incomplete item identity routes
to `submit-remote-review`; none may enter landing directly.

## Independent Review

Use `lib/dverity/merge.js#reviewMergeItem` to read the named item through its
provider adapter and run Independent Review. Both calls are explicitly
read-only. The returned immutable provider-neutral record reuses
`lib/dverity/review-item-record.js` and binds provider, repo, item, current head,
fresh task session, selected facets, findings, and verdict.

Never expose Independent Review as another Skill. Never accept an approval
word, an old task session, or missing current approvals, discussions,
mergeability, queue/protection, or CI truth as a current-head verdict. A changed
head makes the stored verdict stale and requires a fresh review by default.

## Semantic no-op carry-forward

Use `lib/dverity/merge.js#carryForwardReview` only when complete structured
evidence binds the old and new series. The function runs the read-only Git
commands itself from the named repo and SHAs, invokes a new-head validation
runner, and refuses caller-supplied equivalence booleans. It proves all of the
following:

- every `git range-diff` entry is `=`;
- stable patch IDs, final trees, and touched paths are equivalent;
- validation ran and passed against the new head;
- no conflict resolution, content change, generated change, bug fix, or
  unknown diff exists.

Carry-forward creates a new immutable record with a fresh task session and a
`carried_from` head. It never edits the old review or merely changes its head.
Any missing or material evidence routes to fresh Independent Review.

## Conflict and product-work reroutes

Use `lib/dverity/merge.js#routeMergeWork`. Invoke
`resolving-merge-conflicts` only for an actual conflict whose product intent is
proven. Ambiguous intent remains blocked. The function reuses
`dverity-repair/scripts/repair-contract.js#routeRepairWork`: confirmed defects
route to `dverity-repair`; feature, requirement, and product-intent gaps route
to the external Wayfinder/executor.

These decisions are read-only. Merge must not repair product code, implement a
feature, push, approve, land, or close an issue while establishing review
freshness. Later landing requires separate named mutation authority and the
remaining local contract in `DVERITY.md`.

## Landing and provider parity

Use `lib/dverity/landing.js` only after the current-head review passes and a
fresh authority names one provider item, target, source, and direct issue set.
Its GitHub and GitLab adapters map provider fields into the existing neutral
review-item record; they do not own another lifecycle or review state machine.

Queue or merge-train `required` may request the named provider mutation.
`pending`, `enqueued`, missing, unknown, or failed truth is blocked and never a
successful landing. After the provider accepts the mutation, read back the
provider item and merge SHA, remote target, tracking ref, local target, active
worktree, and post-merge checks independently. A dirty or diverged active
worktree, non-terminal checks, or any missing or mismatched SHA leaves Merge
blocked even when the provider says the item is merged.

## Issue closeout

Closeout consumes the exact intent handed through Submit but runs only after
landing and parity readback. Only issues explicitly classified as `direct` and
named by fresh close authority may use `close-after-merge`. Parent, sibling,
blocker, partial, and other related items are read back as `related-only` and
must never be closed recursively. Read every direct issue before mutation and
again afterward; missing closed-state readback leaves the result blocked.
