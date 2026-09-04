---
name: postmortem
description: Recall or record confirmed reusable failure lessons. Use after a verified recurrence, review escape, failed gate, or explicit user request.
metadata:
  resources:
    - scripts/postmortem-contract.js
---

# Postmortem

`postmortem` owns reusable failure memory. It does not own workflow state,
review findings, remote delivery, or ordinary failure logs.

Use exactly one mode:

- `recall`: a recurrence, failed verification, or review escape may match a
  prior lesson;
- `interrogate`: evidence is too thin to classify the lesson;
- `record`: a confirmed reusable lesson, review escape, or explicit user
  request needs durable memory.

Use `scripts/postmortem-contract.js#decidePostmortem` before any filesystem
write. Ordinary failures and unconfirmed lessons do not record. Recall does not
make historical evidence current; revalidate it against the present repro and
code.

When recall is needed, search `docs/postmortems/` only if it exists. Search by
module, exact error, violated contract, failure class, and stable recurrence
signature. A recurring pattern applies broadly; a special case applies only
when its narrow recall condition matches.

Before recording, require the symptom, evidence, root-cause status, lesson
type, recall condition, and stable recurrence key. A suspected or unknown cause
must never be written as confirmed. Update an existing matching recurrence
rather than create a competing lesson.

Durable records live under:

```text
docs/postmortems/<lowercase-kebab-slug>.md
```

Call `scripts/postmortem-contract.js#recordPostmortem` only after the decision
says `record: true`. The function creates the directory at that moment; the
directory is never eagerly created.
