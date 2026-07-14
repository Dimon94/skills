# Owned-subset migration must not read unmanaged content

- Stable recurrence key: `owned-subset-reads-unmanaged-content`
- Trigger: Independent Review escape on PR #92
- Root-cause status: confirmed

## Symptom

Global migration failed with `EACCES` when an unrelated personal Claude Skill
contained a mode `000` file, even though that Skill was outside Dverity
ownership.

## Evidence

The migration recorded personal Skill names for committed-state readback, but
the `stage-unknown` edge also recursively copied their contents into the
transaction stage. Removing that copy made the same disposable-HOME CLI probe
pass while preserving the personal file and its mode.

## Lesson

“Preserved after migration” is weaker than “not consumed by migration.” For an
owned-subset operation, tests must include unreadable unmanaged content and
prove success without reading it. Persist only the minimum metadata required
for readback; never stage unknown bytes as a preservation mechanism.

## Recall condition

Recall this lesson whenever an ownership-scoped migration, backup, installer,
or validator enumerates unknown paths and then copies, hashes, parses, or opens
their contents.
