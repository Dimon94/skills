---
name: dverity-research
description: Gather evidence for Dverity repair decisions. Use when a repair hypothesis or boundary needs primary-source proof before mutation.
metadata:
  dverity_class: reusable-dependency
  reads: []
  resources:
    - scripts/research-contract.js
---

# Dverity Research

`dverity-research` is a sidecar for a real Evidence Gap. It is not a default
Repair phase, implementation plan, task breakdown, or substitute for a red
reproduction.

Pass the Local Grounding Gate first:

- current goal and exact unknown;
- project root, branch, commit, and dirty state;
- relevant current code, tests, docs, ADRs, issue truth, and recent history;
- the fact that local evidence cannot answer.

Research in this order: current project evidence, matching prior research,
then current primary or authoritative external sources. Treat prior research as
a lead until its code coordinates, links, versions, and assumptions are
revalidated.

Use `scripts/research-contract.js#decideResearch` to select:

- no Evidence Gap: return without research or writes;
- ungrounded Evidence Gap: blocked;
- grounded transient question: consult and return the answer without a file;
- grounded reusable Evidence Gap with approved persistence: record.

Durable records live under:

```text
docs/research/<lowercase-kebab-slug>.md
```

Call `scripts/research-contract.js#recordResearch` only when the decision says
`record: true`. A durable entry starts with its reference materials, separates
facts from inference, gives each recommendation an evidence grade, and lists
remaining gaps. The normal Repair path neither depends on nor eagerly creates
`docs/research/`.
