# Dverity

Dverity is an evidence-first delivery toolkit whose promise is
`Truth before main.` The complete product contract is owned only by
[DVERITY.md](./DVERITY.md).

## Language

### Truth-to-Main
The single Dverity product contract. Other files may point to it or define one
local responsibility, but may not restate the complete chain.

### Workflow Entry
A user-invoked Skill that owns one bounded phase. Dverity has exactly three:
`dverity-repair`, `submit-remote-review`, and `merge-remote-review`.

### Reusable Dependency Skill
A Skill used by a workflow entry without owning a parallel product lifecycle.

### Verified Local
A local repair result whose regression evidence is fresh for the named head.
It grants no remote mutation authority.

### Review Ready
An authenticated provider-native review item bound to the exact source,
target, and head. Pending, unknown, stale, or anonymous truth is not ready.

### Verified Remote Main
A landing result with provider, Git, worktree, checks, and direct issue
closeout read back independently. Provider `merged` state alone is incomplete.

### Canonical Skill Source
The repository root `skills/` tree. It is enumerated once for package,
installation, and provenance.

### Managed Projection
An exact-set, per-file-hash copy of canonical Skill source installed under
`.agents/skills` or `.claude/skills`. A projection never becomes source.

### Install Root Ownership Manifest
The single `.dverity/managed-skills.json` file that proves package/source
provenance and ownership for both managed projections.

### Historical Record
CHANGELOG, ADR, task, postmortem, research, or other durable evidence written
under an earlier product state. Current documentation may link it as history,
but runtime, package, and install logic must not consume or rewrite it.

### Current Surface
README, legal notice, package metadata, badges, install links, policy files,
and current guides. These must use the canonical Dverity identity.

### External Executor
The planning or implementation system that hands a named, clean, verified,
ahead branch to Dverity. It does not become a Dverity workflow entry.
