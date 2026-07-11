# Dverity

> Truth before main.

This document is the single complete contract for the Dverity Truth-to-Main
product chain. Other current documentation and Skills may point here or define
their local responsibility, but must not restate the full chain.

<!-- dverity:truth-to-main ["Repair","Verified Local","Submit","Review Ready","Merge","Verified Remote Main"] -->
<!-- dverity:repair-terminal Verified Local -->
<!-- dverity:wayfinder-entry Submit -->
<!-- dverity:remote-promotion explicit -->

```text
Repair
  -> Verified Local
  -> Submit
  -> Review Ready
  -> Merge
  -> Verified Remote Main
```

## Contract

### Repair

`dverity-repair` owns diagnosis, repair, and regression evidence. Its default
terminal is Verified Local. A repair request does not grant push, review-item,
approval, merge, issue-close, or remote-main authority.

### Verified Local

Verified Local means the repair and its regression proof are current for the
named local head. Remote promotion requires explicit authority. A named,
clean, verified, ahead Wayfinder integration branch enters Dverity at Submit;
Wayfinder does not enter through Repair or take ownership of later phases.

### Submit

`submit-remote-review` owns source scope, clean-ahead proof, push, and creating
or updating exactly one named review item. It may not approve or land the item.

### Review Ready

Review Ready binds provider, repository, review item, source, target, and head.
Pending, unknown, stale, anonymous, or incomplete provider truth is not ready.

### Merge

`merge-remote-review` consumes an authenticated provider-native review item.
Independent Review is a fresh, read-only, head-bound Merge mode, not a fourth
workflow entry. A material head change invalidates the prior verdict.

### Verified Remote Main

Verified Remote Main requires authenticated landing readback plus remote target,
tracking ref, local target, active worktree, post-merge checks, and direct issue
closeout readback. Provider `merged` state alone is insufficient.

## Authority and failure

Each mutation is limited to its explicit named scope. Missing authority,
freshness, evidence, provider truth, or product intent fails closed. Confirmed
defects reroute to Repair; feature or requirement gaps reroute to the external
Wayfinder/executor. Ambiguous conflicts remain blocked.

The machine-owned acceptance catalog and generated acceptance packet validate
this contract. They do not replace repository Skill source, provider truth, or
install ownership truth.
