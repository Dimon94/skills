# TOC Thinking Processes

Use this card when diagnosis, planning, or orchestration needs causal rigor.
Keep the output compact; the point is a falsifiable chain, not a diagram.

## Vocabulary

- `UDE`: observable undesirable effect. Logs, wrong output, latency, failed gate.
- `CRT`: Current Reality Tree. Current facts linked as sufficient causes.
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
- CRT: <root fact> -> <intermediate fact> -> <observed UDE>
- Conflict: <objective>; <need A -> want X>; <need B -> want not-X>; assumption to break
- Injection:
- FRT/NBR: <desired effect>; <negative branch>; <prevention/check>
- Probe/check:
```

Omit `Conflict` only when no real tradeoff is driving the bad state. Omit
`NBR` only for a trivial one-line fix with no plausible side effect.

## Debugging Pattern

1. List UDEs as observations only. Do not smuggle causes into symptoms.
2. Build each hypothesis as a CRT chain from a root fact to at least one UDE.
3. Test the weakest CRT edge first; a probe validates one edge, not a feeling.
4. If the bad design persists because two needs fight, write the Conflict Cloud
   and break one hidden assumption instead of choosing a compromise.
5. Treat the fix as an Injection. The regression test proves the original UDE is gone.
6. Run FRT/NBR before closing: name the desired effect, the likely negative branch,
   and the cheapest check that catches it.

## Orchestration Pattern

- Discovery child issue: answer one missing CRT edge, cloud assumption, injection proof, PRT obstacle, or NBR risk.
- PRD gate: state what to change, what to change to, and how to cause the change.
- Issue split gate: each implementation issue is one Injection, prerequisite, or transition step.
- Integration gate: run FRT/NBR across merged child commits before summary PR/MR.

## CLR Check

Apply the Categories of Legitimate Reservation to every important edge:

- Clarity: terms are concrete enough to test.
- Entity existence: the fact exists in evidence.
- Causality existence: A really can cause B.
- Cause insufficiency: A alone is not enough; add the missing cause.
- Additional cause: B may also happen through another cause.
- Cause-effect reversal: B may cause A instead.
- Predicted effect existence: the claimed downstream effect would actually occur.
- Tautology: the edge is not just the same statement twice.
