---
name: dverity-simplify
description: Simplify verified changes before remote submission. Use for deletion-first, YAGNI, native-library, structural, and test-seam review.
metadata:
  dverity_class: reusable-dependency
  reads:
    - references/simplification-rules.js
---

# Dverity Simplify

Read `references/simplification-rules.js`. Review only the verified diff and
preserve its accepted behavior.

Use this order:

1. Delete behavior that is unnecessary or speculative. YAGNI beats rewriting.
2. Replace custom machinery with an existing native API or standard library.
3. Repair confirmed structural risk: mixed responsibilities, excessive
   branching or nesting, giant modules, hidden coupling, or poor test seams.
4. Keep necessary code when none of those conditions is proven.

Tests must observe public behavior. Do not add private-method assertions,
internal collaborator mocks, or abstractions created only to satisfy a test.
The bundled decision reference is the executable behavioral contract; no
external Skill, plugin identity, version, or absolute path is required.
