# Dverity Skill Capability Map

The complete product contract belongs to [DVERITY.md](../DVERITY.md). This file
only records source inventory and local Skill responsibility.

## Workflow entries

| Skill | Local responsibility |
| --- | --- |
| `dverity-repair` | diagnosis, repair, and Verified Local evidence |
| `submit-remote-review` | verified source submission and one review item |
| `merge-remote-review` | current-head review, landing, closeout, and parity |

## Reusable dependencies

| Skill | Local responsibility |
| --- | --- |
| `do-not-repeat-yourself` | locate the nearest correct reusable mechanism |
| `postmortem` | recall and record confirmed reusable failure lessons |
| `dverity-research` | gather source-backed evidence for a real gap |
| `dverity-simplify` | remove confirmed over-engineering and scope drift |
| `git-commit` | create narrow, audited local commits |
| `resolving-merge-conflicts` | resolve real conflicts when product intent is proven |

`skills/` is the only source. Installed `.agents/skills` and `.claude/skills`
trees are exact-set, per-file-hash projections of that source.
