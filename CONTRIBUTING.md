# Contributing to Dverity

[中文版](./CONTRIBUTING.zh-CN.md) | [English](./CONTRIBUTING.md)

Keep each change bounded and evidence-backed. The complete product contract is
owned by [DVERITY.md](./DVERITY.md); contributor docs describe repository work,
not another lifecycle.

## Setup

```bash
git clone https://github.com/Dimon94/dverity.git
cd dverity
npm ci
npm test -- --runInBand
npm run verify:publish
```

## Repository ownership

- `skills/` is the only canonical Skill source.
- `.agents/skills` and `.claude/skills` are install projections, never source.
- `lib/dverity/` owns lifecycle and validation behavior.
- `bin/dverity.js` is the only executable entry.
- `DVERITY.md` is the only complete product-chain contract.
- `docs/` contains local guidance and immutable historical records.

The physical Skill set must remain exactly the nine root directories already
owned by `skills/`. A new internal gate, mode, validator, or runbook is not a
reason to create another Skill.

## Change discipline

1. Start with the smallest public test seam that proves the behavior.
2. Run the focused test red, implement only enough to make it green, then run
   the full suite.
3. Preserve CHANGELOG, ADR, task, postmortem, research, tag, and other durable
   historical content unless the work explicitly owns a new append-only record.
4. Keep provider and registry mutation behind explicit named authority.
5. Update current documentation when a public command, Skill responsibility,
   install contract, or security boundary changes.

## Useful checks

```bash
npm test -- --runInBand
npm run verify:publish
npm pack --dry-run
git diff --check
```

Open focused issues and pull requests at
[Dimon94/dverity](https://github.com/Dimon94/dverity). Security reports follow
[SECURITY.md](./SECURITY.md).
