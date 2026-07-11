---
name: dverity-repair
description: Diagnose and repair confirmed defects to Verified Local. Use for evidence-first bug repair; remote submission requires separate explicit authority.
metadata:
  dverity_class: workflow-entry
  reads:
    - ../../DVERITY.md
  resources:
    - scripts/repair-contract.js
---

# Dverity Repair

`dverity-repair` diagnoses and repairs confirmed defects. Read
`../../DVERITY.md`; this Skill owns only its local phase and defaults to the
Verified Local terminal. A repair request never grants push, review-item,
approval, landing, issue-close, or any other remote mutation authority.

The operating discipline is a tight red loop: one command that the agent has
already run, that reaches the user's exact symptom, and that can be repeated
without human interpretation. Without that loop, return a blocked record. Do
not manufacture a root cause or write product code to make progress look real.

## Grounding and sidecars

Before diagnosis:

1. Read `CONTEXT.md` or the nearest project vocabulary when present.
2. Read current code, tests, ADRs, runbooks, task evidence, and relevant Git
   history before asking the user for facts already in the repository.
3. Use `../postmortem/SKILL.md` to recall likely recurrences, failed
   verification lessons, or review escapes. Recall is a lead until current
   evidence revalidates it.
4. Use `../dverity-research/SKILL.md` only when a real external API,
   dependency, platform, or stale-source Evidence Gap blocks a probe. Research
   cannot substitute for reproduction.

## Phase 1 - Tight red loop

Build the fastest deterministic signal that reaches the real failure. Prefer,
in order: a boundary test, HTTP/CLI invocation, replayed trace, minimal harness,
property loop, bisect harness, or structured HITL script.

The loop is ready only when all are true:

- it has been run and is red;
- output contains the user's exact symptom rather than a nearby failure;
- the same input produces the same verdict, or a flaky case has been raised to
  a useful measured reproduction rate;
- it runs in seconds and is agent-runnable.

For a non-deterministic defect, repeat, parallelize, stress, freeze time or
randomness, and shrink the timing window. A low-rate signal that cannot support
falsification is blocked, not “probably fixed.”

If no red loop can be established, report the attempted commands, the missing
minimal artifact, and the next owner. Ask for the smallest useful item such as
environment access, a HAR/log/core dump, or permission for temporary
instrumentation. Do not mutate product code.

## Phase 2 - Reproduce and minimise

Run the loop and capture the exact failure more than once. Then remove one
input, caller, config value, step, or environmental variable at a time. Rerun
after every removal.

The minimum reproduction is complete when every remaining element is
load-bearing, removing any element changes the verdict or symptom, and the
small case still matches the original symptom. Record the real public boundary
where the case can become a regression test. If the architecture exposes no
correct boundary, record that as a follow-up instead of accepting a shallow
test.

## Phase 3 - Evidence-first Hypothesis board

Create 3-5 evidence-backed candidates. When current evidence supports only one
non-fabricated candidate, record why no second honest candidate exists. Never
invent a second cause to satisfy a number.

Each row contains:

```text
id, cause, observed result, abductive ECE,
disconfirming kill probe, independent confirm test,
rung, next check, evidence
```

An observed result names before-state, after-state, and where it was noticed.
Build unknown-cause hypotheses as:

```text
observed effect <= suspected cause => independent predicted effect
```

Write the kill probe before collecting support: “if X is the cause, expect Z;
if not-Z appears, refute X.” A removal or action test is the confirm test and is
recorded separately. One command cannot be both the kill probe and the confirm
test.

Use this trust ladder:

1. `conjectured`: candidate tied to an observed result;
2. `standing`: survived a serious disconfirming probe;
3. `corroborated`: an independent predicted effect was observed;
4. `confirmed`: an independent removal/action test passed;
5. `refuted`: the killing fact stays visible.

Only `confirmed` may use “root cause.” `corroborated` is “probable cause” and
must name the missing confirmation. Supporting evidence alone never advances a
hypothesis to `confirmed`.

Build a compact CRT only from standing-or-stronger rows. Every important edge
must pass clarity, existence, and sufficiency checks. If competing needs create
the defect, name the objective, both needs, both opposing wants, and the hidden
assumption to break.

## Phase 4 - Disconfirm, corroborate, confirm

Run one probe for one predicted signal at a time:

1. try to kill the leading hypothesis;
2. if it survives, collect one independent co-effect;
3. confirm with a removal or action test.

Prefer a debugger or REPL, then a narrowly placed log. Prefix temporary logs
with a unique `[DEBUG-...]` token so cleanup can prove their removal. For a
performance regression, establish a timing/profile/query-plan baseline before
mutation.

## Phase 5 - Injection and regression

Before adding any helper, validator, parser, script, schema, or reusable policy,
run `../do-not-repeat-yourself/SKILL.md` and reuse the nearest correct wheel.

At the correct public boundary:

1. convert the minimum reproduction into a failing regression test;
2. run it red;
3. describe the smallest Injection and the causal edge it breaks;
4. name the desired FRT effect, the most plausible NBR negative branch, and the
   cheapest prevention check;
5. implement only the Injection;
6. run the regression green;
7. rerun the original unminimised symptom green.

A corroborated probable cause may receive a minimal low-risk repair only when
the packet keeps the missing confirmation and risk visible. It does not become
a root-cause claim by virtue of the test turning green.

## Phase 6 - Cleanup and Verified Local packet

Remove every tagged debug probe and one-off prototype, then run the cleanup
scan. Submit the local evidence to
`scripts/repair-contract.js#validateRepairPacket` with:

- schema version and exact symptom fingerprint;
- original and minimized red commands/output;
- load-bearing, determinism, and reproduction-rate evidence;
- the full Hypothesis board, kill probe, confirm test, trust language;
- Injection and FRT/NBR;
- public-boundary regression red/green evidence;
- original unminimised green recheck;
- debug/prototype cleanup evidence;
- `remote_actions_performed: []`.

Only a passing validator result is `verified-local-repair`. Any missing gate is
blocked and must preserve attempted loops, the missing artifact, the next owner,
and zero product mutations.

## Reroute boundary

Use `scripts/repair-contract.js#routeRepairWork` for the local ownership
decision. A confirmed defect routes only to `dverity-repair`. Feature gaps,
requirement changes, and product-intent gaps route to the external
Wayfinder/executor. Missing intent or less-than-confirmed defect evidence stays
blocked. Repair does not implement features and does not promote work remotely.
