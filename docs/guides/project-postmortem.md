# Dverity Project Postmortems

The `postmortem` Skill owns recall and recording rules. A record is created only
for a confirmed reusable lesson, a review escape, or an explicit user request.

## Required evidence

- exact symptom and affected boundary;
- commands, provider readback, or files that prove the event;
- confirmed versus probable root-cause language;
- the reusable lesson and when it should be recalled;
- redaction of secrets, customer data, private logs, and local machine paths.

Search existing records before writing and update the matching recurrence when
one exists. Do not use postmortems as task state, review state, or a second copy
of [DVERITY.md](../../DVERITY.md).
