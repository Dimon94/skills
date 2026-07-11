# Dverity Artifact Contract

The complete workflow contract is [DVERITY.md](../../DVERITY.md). This guide
only defines filesystem artifact ownership.

## Product artifacts

- `skills/` — canonical source for exactly nine Skills.
- `.dverity/managed-skills.json` — one install-root ownership manifest.
- `.agents/skills` and `.claude/skills` — exact-set managed projections.
- generated acceptance packet — read-only roll-up derived from the canonical
  acceptance catalog and current evidence.

## Human evidence

- `docs/postmortems/` — confirmed reusable failure lessons when a real trigger exists.
- `docs/research/` — source-backed research created by `dverity-research`.

Directory names never prove ownership. Unknown, drifted, or manifest-external
files are preserved and reported rather than adopted or deleted.
