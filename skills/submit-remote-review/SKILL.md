---
name: submit-remote-review
description: Submit a named verified source for remote review. Use when explicit authority covers push and one review item, but not approval or landing.
metadata:
  dverity_class: workflow-entry
  reads:
    - ../../DVERITY.md
    - ../../lib/dverity/git-source.js
    - ../../lib/dverity/review-item-record.js
    - ../../lib/dverity/submit.js
    - ../dverity-simplify/SKILL.md
    - ../git-commit/SKILL.md
    - ../resolving-merge-conflicts/SKILL.md
---

# Submit Remote Review

Read every declared dependency before acting. Own only Submit through Review
Ready. Never approve, land, close an issue, or interpret a review verdict.

## Input gate

Require one named repository, source, live target, and explicit authority for
push plus create-or-update of at most one review item. Missing source or item
authority permits read-only discovery only.

Use `../../lib/dverity/git-source.js` to refresh and read the named Git source.
Require a fresh handoff with source/base/head/ahead commits, scope source,
spec and issue links, passing checks, base/head-bound local review, touched
paths, risks, closeout intent, and `remote_actions_performed: none`.

Refresh the live target and prove the named source is clean, not behind, and
ahead. Re-read the proof immediately before mutation. Dirty, no-ahead, stale,
incomplete, or moved-target evidence blocks with zero mutation.

## Submit

1. Run `dverity-simplify` and retain only confirmed, in-scope improvements.
2. Use `git-commit` if simplification changed files. If Git reports a real
   conflict while refreshing, use `resolving-merge-conflicts`; otherwise do
   not invoke it.
3. Read authenticated provider identity, capabilities, and same-source items.
   Anonymous or capability-missing truth blocks.
4. If exactly one same-source item exists, reuse it. More than one is a
   duplicate blocker. Never batch items.
5. Revalidate the source proof, push the one source, then create or update one
   item. Read the item back through the authenticated provider.

## Output

Return the sole provider-neutral record from
`../../lib/dverity/review-item-record.js`, mutation call audit, source proof,
and handoff. Submit leaves approvals, discussions, mergeability, CI, queue, and
current-head review fields unset; Merge owns those truths. A URL without exact
provider/repo/item/source/target/head/authenticated readback is not Review Ready.
