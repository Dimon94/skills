# TOC Thinking Processes

Use this card when diagnosis, planning, or orchestration needs causal rigor.
Keep the output compact; the point is a falsifiable chain, not a diagram.

## Vocabulary

- `UDE`: observable undesirable effect. Logs, wrong output, latency, failed gate.
- `Observed result`: a state change with before-state, after-state, and noticed-at.
- `CRT`: Current Reality Tree. Current facts linked as sufficient causes.
- `Abductive ECE`: effect -> suspected cause -> independent effect. Use when the first thing known is an observed effect.
- `Cause-forward ECE`: cause -> effect A + effect B + effect C. Use when the cause is already known and decisions need consequence prediction.
- `Hypothesis board`: every active and refuted candidate cause, with rung, next check, and evidence.
- `Trust ladder`: conjectured -> standing -> corroborated -> confirmed, with refuted possible at any rung.
- `Conflict Cloud`: one objective, two necessary needs, two opposing wants, one assumption to break.
- `Injection`: smallest change that breaks a bad causal edge or cloud assumption.
- `FRT`: Future Reality Tree. Predicted desirable effects after the injection.
- `NBR`: Negative Branch Reservation. Predicted bad side effect and prevention.
- `PRT`: Prerequisite Tree. Obstacles that must be removed before the injection works.
- `TRT`: Transition Tree. Ordered actions that cause the injection to exist.

## Minimum Record

```text
TOC:
- UDEs:
- Observed result: <before-state> -> <after-state>; noticed-at <time/check>
- Hypothesis board:
  - HYP001: <cause>; rung <conjectured|standing|corroborated|confirmed|refuted>; next check <probe>; evidence <source/check>
- CRT: <root fact> -> <intermediate fact> -> <observed UDE>
- ECE mode: abductive | cause-forward
- Abductive ECE: <observed effect> <= <suspected cause> => <independent predicted effect>
- Cause-forward ECE: <known cause> => <predicted effect A>; <predicted effect B>; <predicted risk>
- Disconfirm first: <kill prediction>; <probe>; <kill condition>
- Confirm after standing: <independent support>; <why it is not circular>
- Conflict: <objective>; <need A -> want X>; <need B -> want not-X>; assumption to break
- Injection:
- FRT/NBR: <desired effect>; <negative branch>; <prevention/check>
```

Omit `Conflict` only when no real tradeoff is driving the bad state. Omit
`NBR` only for a trivial one-line fix with no plausible side effect.

## Debugging Pattern

1. List UDEs as observations only. Do not smuggle causes into symptoms.
2. Anchor diagnosis to one observed result: before-state, after-state, and noticed-at. Static conditions are facts, not results to explain.
3. Generate candidate causes with the U-quadrant scan:
   - known-attended: causes already suspected in the case
   - known-ignored: recent changes, ignored logs, config, dependencies, history, prior incidents, or decisions already in reach
   - unknown: adjacent causes needing research or user knowledge, only after known candidates are exhausted or refuted
4. Keep at least two competing hypotheses visible on the Hypothesis board before deep verification.
5. Build unknown-cause hypotheses as Abductive ECE: observed effect ->
   suspected cause -> independent predicted effect.
6. Write the disconfirming probe before any confirming search. Name the exact
   observation that would kill the hypothesis or force a rewrite.
7. Run the disconfirming probe first. A hypothesis that fails it is killed, not
   patched with convenient supporting evidence.
8. Only after a hypothesis reaches `standing`, collect confirming evidence. Confirmation must be
   independent of the symptom that generated the hypothesis.
9. Build only `standing` or stronger hypotheses into a CRT chain from root fact to UDE.
10. If the bad design persists because two needs fight, write the Conflict Cloud
   and break one hidden assumption instead of choosing a compromise.
11. Treat the fix as an Injection. The regression test proves the original UDE is gone.
12. Run FRT/NBR before closing: name the desired effect, the likely negative branch,
   and the cheapest check that catches it.

## Trust Ladder

Each hypothesis moves one rung at a time:

1. `conjectured`: named as a candidate sufficient cause for one observed result.
2. `standing`: survived at least one serious falsification attempt.
3. `corroborated`: at least one predicted co-effect beyond the original result was observed. This is tentative, not final.
4. `confirmed`: a removal test or action test passed. Diagnosis of this branch stops here.
5. `refuted`: any rung can fall here; keep the killing fact visible on the board.

Root cause language is reserved for `confirmed`. If only `corroborated`, say
`probable cause`, name the missing confirmation test, and keep the risk visible.

## Evidence-First Questions

Resolve every open diagnostic question in this order:

1. Current reproduction output, captured logs, traces, fixtures, and task evidence.
2. Project code, config, dependency manifests, tests, docs, and Git history.
3. Cheap safe checks runnable now: search, dry-run, targeted test, toggle, revert, timing, or REPL/debugger inspection.
4. Existing postmortems or research, treated as leads until revalidated against current evidence.
5. User input only for off-repo facts, intent, priorities, credentials, or environment access.

When the user must answer, ask exactly one question and include the consequence:
which hypothesis rung moves, which assumption changes, or which blocker clears.

## ECE Mode Gate

- Use Abductive ECE for root-cause discovery: effect first, cause second,
  independent effect third.
- Use Cause-forward ECE for consequence prediction: known cause first, multiple
  expected effects next.
- Do not use Cause-forward ECE to prove a root cause. It can forecast impact,
  but it cannot replace an Abductive ECE kill probe.
- Do not use Abductive ECE for planning after the cause is proven. Switch to
  Cause-forward ECE, FRT, NBR, PRT, or TRT.

## Confirmation Bias Gate

- Do not mark a hypothesis `confirmed` from supporting evidence alone.
- Do not let a hypothesis leave `conjectured` without a falsification attempt.
- Do not let a hypothesis become `corroborated` from the original UDE; use an independent co-effect.
- Do not call a `corroborated` hypothesis root cause.
- One easy match is weak evidence; a failed kill probe is strong evidence.
- Confirmation cannot reuse the same UDE that created the hypothesis.
- If every available probe only supports the hypothesis, the investigation is
  still `standing`, not `confirmed`.
- When time is tight, run the cheapest kill probe, not the easiest support probe.

## Orchestration Pattern

- Discovery child issue: answer one missing CRT edge, kill probe, cloud assumption, injection proof, PRT obstacle, or NBR risk.
- PRD gate: use Cause-forward ECE to state what to change, what to change to,
  what effects should follow, and how to cause the change.
- Issue split gate: each implementation issue is one Injection, prerequisite,
  transition step, or predicted-effect check.
- Integration gate: run Cause-forward ECE plus FRT/NBR across merged child
  commits before summary PR/MR.

## CLR Check

Apply the Categories of Legitimate Reservation to every important edge:

First classify the edge:

- Sufficiency logic: `if X, then Y`; CRT-style causal chains.
- Necessity logic: `to achieve A, we must have B`; clouds and prerequisite logic.

Then check in order:

1. Clarity: entities and causal wording are concrete enough to test.
2. Existence: the entity, fact, or causal relation exists in evidence.
3. Sufficiency, only for sufficiency logic:
   - Cause insufficiency: A alone is not enough; add the missing cause.
   - Other cause: B may also happen through another cause.
   - Cause-effect reversal: B may cause A instead.
   - Predicted effect existence: the claimed downstream effect would actually occur.
   - Tautology: the edge is not just the same statement twice.

Unresolved CLR on a critical edge blocks `confirmed`. Either kill the hypothesis,
rewrite the edge, or keep it `standing` with the unresolved reservation.
