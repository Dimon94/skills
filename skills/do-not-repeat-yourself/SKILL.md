---
name: do-not-repeat-yourself
description: Find and reuse the nearest correct mechanism before adding another. Use when a change would add reusable code, policy, or workflow meaning.
---

# Do Not Repeat Yourself

Run this gate before adding a helper, utility, adapter, validator, parser,
script, schema, Skill, prompt rule, or any other reusable mechanism, and again
before committing. DRY means do not duplicate meaning or wheels; it does not
mean extracting every similar line into a bad abstraction.

## Reuse-first gate

1. Freeze the exact mechanism or staged diff in scope.
2. Search nearby callers and same-directory patterns.
3. Search repository utilities, scripts, Skills, docs, ADRs, and declared
   entrypoints.
4. Prefer the language standard library, native platform, and installed
   dependencies before new code.
5. Add a mechanism only when the earlier wheel is missing, wrong, or more costly
   than a narrow implementation.

For every new mechanism, record the search evidence or reused wheel. If an
existing wheel covers it, delete the duplicate and reuse the owner. If a close
wheel is wrong, state the failed contract rather than quietly forking it.

## Duplication classes

- duplicate meaning: the same business rule, error semantics, prompt rule, or
  state transition exists twice;
- duplicate mechanism: a second implementation of an existing reusable path;
- duplicate wheel: custom code where the standard library, platform, dependency,
  or existing Skill already fits.

Keep boundary duplication when sharing would leak internals across trust
boundaries. Keep independent test fixtures when that improves readability.
Keep small local duplication when an abstraction costs more than the repeated
lines. Temporary migration duplication needs a removal condition.

When touching current docs or Skills, prefer one owner plus pointers. Never
copy a complete product chain, catalog, enumerator, or state machine into a
second source.

End the gate with:

```text
DRY record:
- scope:
- searched:
- reused:
- remaining duplication:
```

Use `none` only after searching. Historical duplication outside the ticket is
reported, not fixed, unless it blocks current correctness.
