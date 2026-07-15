---
name: dverity-repair
description: Diagnose and repair a confirmed defect to a Verified Local evidence packet. Use when a bug, defect, or regression needs evidence-first repair, or when another Dverity skill reroutes a confirmed defect. Remote promotion requires separate explicit authority.
metadata:
  dverity_class: workflow-entry
  reads:
    - ../../DVERITY.md
  resources:
    - scripts/repair-contract.js
---

# Dverity Repair

A discipline for repairing confirmed defects on evidence. Read
`../../DVERITY.md` for the Truth-to-Main chain; this skill owns diagnosis and
repair only, and its terminal is **Verified Local**: a packet that passes
`scripts/repair-contract.js#validateRepairPacket` with
`remote_actions_performed: []`. Push, review, and landing belong to other
skills under separate explicit authority.

Every claim in the packet traces to a command you ran and its captured output
(invocation, stdout/stderr, exit code). When evidence runs out, the honest
terminal is a **blocked record** — never a plausible story, never a speculative
product edit.

**Blocked record** — the failure terminal at any phase: the commands you
attempted with their output, the missing minimal artifact, the smallest useful
ask (environment access, a HAR/log/core dump, permission for temporary
instrumentation), the next owner, and zero product mutations.

## Grounding

Before diagnosis:

1. Read `CONTEXT.md` (if present) and ADRs near the code you're touching; mine
   code, tests, runbooks, task evidence, and Git history before asking the
   user for facts the repository already holds.
2. Use `../postmortem/SKILL.md` to recall likely recurrences,
   failed-verification lessons, and review escapes. Recall is a lead until
   current evidence revalidates it.
3. Use `../dverity-research/SKILL.md` when an external API, dependency,
   platform, or stale-source Evidence Gap blocks a probe. Reproduction stays
   the proof; research only unblocks a probe.

## Phase 1 — Build a tight red loop

**This is the skill.** Everything after is mechanical consumption of the loop:
one command that reaches the user's exact symptom and repeats without human
interpretation. Spend disproportionate effort here — be aggressive, creative,
relentless.

Ways to construct one, in rough order:

1. **Failing test** at whatever seam reaches the defect.
2. **HTTP/CLI invocation** against a running dev instance, diffing output
   against known-good.
3. **Replayed trace** — capture a real request/payload/event log, replay it
   through the code path in isolation.
4. **Throwaway harness** — a minimal subset of the system (one service, mocked
   deps) driving the defect path with a single call.
5. **Property/fuzz loop** — for "sometimes wrong output", run hundreds of
   random inputs and catch the failure mode.
6. **Differential loop** — same input through old vs new version or config,
   diff the outputs.
7. **Bisection harness** — automate "boot at state X, check, repeat" so
   `git bisect run` can consume it.
8. **Structured HITL script** — last resort; a human clicks, the script drives
   them and captures output back to you.

Once you have *a* loop, tighten it: faster (cache setup, narrow scope), sharper
(assert the specific symptom, not "didn't crash"), more deterministic (pin
time, seed RNG, isolate filesystem and network).

**Non-deterministic defects.** The goal is a higher reproduction rate, not a
clean repro: loop the trigger 100×, parallelise, add stress, freeze time or
randomness, shrink the timing window — until the measured rate reaches at
least 50%. Below that the loop cannot support falsification: go blocked.

**When no loop can be built**, return a blocked record. Product code stays
untouched.

Phase 1 is complete when you can name one command you have already run —
invocation, output, and exit code captured — and:

- [ ] it exits non-zero and its output contains the user's exact symptom
      string, the same fingerprint the packet will carry;
- [ ] the same input gives the same verdict every run, or a flaky case has a
      measured rate ≥ 50%;
- [ ] it runs in seconds, unattended.

If you catch yourself reading code to build a theory before this command
exists, stop — that is the exact failure this skill prevents. No red command,
no Phase 2.

## Phase 2 — Reproduce and minimise

Run the loop; watch it go red on the failure the user described, more than
once — a nearby failure is the wrong bug and leads to the wrong fix. Capture
the exact symptom output for the packet.

Then shrink: remove one input, caller, config value, step, or environment
variable at a time, rerunning after every cut. Done when:

- [ ] every remaining element is load-bearing — removing any one changes the
      verdict or symptom;
- [ ] the minimal case still shows the original symptom;
- [ ] you have recorded the real public boundary where this case can become a
      regression test. If the architecture exposes no correct boundary, that
      is itself a finding — record it as a follow-up rather than accepting a
      shallow test.

## Phase 3 — Hypothesis board

Create 3–5 evidence-backed candidates — or exactly one, with a recorded reason
why no second honest candidate exists (a two-row board fails validation, and a
fabricated second cause is worse than none). Each row:

```text
id, cause, observed result, abductive ECE,
disconfirming kill probe, independent confirm test,
rung, next check, evidence
```

An observed result names before-state, after-state, and where it was noticed.
For unknown causes, reason by abductive effect–cause–effect (ECE):

```text
observed effect <= suspected cause => independent predicted effect
```

Write the kill probe **before** collecting support: "if X is the cause, expect
Z; if not-Z appears, X is refuted." The kill probe, the corroborating
co-effect, and the confirm test are three different commands.

Rank every candidate on the trust ladder:

1. `conjectured` — tied to an observed result;
2. `standing` — survived a serious disconfirming probe;
3. `corroborated` — an independent predicted effect was observed;
4. `confirmed` — an independent removal/action test passed;
5. `refuted` — the killing fact stays visible on the board.

Trust language is validator-enforced: the cause statement begins `root cause:`
only at `confirmed`; at `corroborated` it begins `probable cause:` and names
the missing confirm test. Supporting evidence alone never climbs the ladder.

From standing-or-stronger rows, sketch a compact Current Reality Tree (CRT);
every important edge passes clarity, existence, and sufficiency. If two
legitimate needs collide to create the defect, draw the evaporating cloud: the
shared objective, both needs, both opposing wants, and the hidden assumption
to break.

Show the board to the user before probing when they are present; proceed with
your own ranking when they are not.

## Phase 4 — Disconfirm, corroborate, confirm

One probe, one predicted signal, one variable at a time:

1. try to **kill** the leading hypothesis;
2. if it survives, collect one **independent co-effect**;
3. **confirm** with a removal or action test.

Prefer a debugger or REPL — one breakpoint beats ten logs; otherwise place
targeted logs at exactly the boundaries that distinguish hypotheses, each
prefixed with a unique `[DEBUG-...]` token so cleanup is a single grep. For a
performance regression, measure first: establish a timing/profile/query-plan
baseline before any mutation.

## Phase 5 — Injection and regression

Before adding any helper, validator, parser, script, or schema, run
`../do-not-repeat-yourself/SKILL.md` and reuse the nearest correct wheel.

The **Injection** is the smallest change that breaks the confirmed causal
edge. At the recorded public boundary:

1. convert the minimal reproduction into a failing regression test; run it
   red;
2. name the Injection and the causal edge it breaks;
3. name the desired effect (FRT), the most plausible negative branch (NBR),
   and the cheapest prevention check;
4. implement only the Injection;
5. run the same regression command green;
6. rerun the **original unminimised command** green — same command, symptom
   gone.

A `corroborated` probable cause may receive a minimal low-risk repair when the
packet keeps the missing confirmation and the residual risk visible; the green
test does not promote it to `root cause`.

## Phase 6 — Cleanup and Verified Local packet

Grep out every `[DEBUG-...]` probe and delete throwaway prototypes; record the
scanned paths and the verification command. Assemble the packet from what each
phase captured — symptom fingerprint, original and minimised red evidence, the
full board with kill/corroboration/confirm probes, Injection and FRT/NBR,
regression red→green at the boundary, the original recheck, cleanup evidence,
and `remote_actions_performed: []` — then run
`scripts/repair-contract.js#validateRepairPacket`.

The phase is complete only when the validator returns `verified-local-repair`.
Any other result is a blocked record.

## Routing boundary

`scripts/repair-contract.js#routeRepairWork` owns the ownership decision: a
confirmed defect routes here; feature gaps, requirement changes, and
product-intent gaps route to the external Wayfinder/executor; missing intent
or less-than-confirmed evidence stays blocked. Repair ships defect fixes only.
