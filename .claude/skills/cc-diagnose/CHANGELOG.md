# CC-Diagnose Skill Changelog

## v1.2.1 - 2026-07-08

- separate disconfirming kill probes from removal/action confirmation tests
- allow a single evidence-backed hypothesis when no second real candidate exists, with an explicit anti-fabrication note
- move `cc-dev` EF### orchestration rules into a branch-specific reference
- clarify that `confirmed` stops root-cause search only, not Injection/FRT/NBR/regression cleanup

## v1.2.0 - 2026-07-07

- add Hypothesis board and trust ladder rules so candidate causes stay visible as conjectured, standing, corroborated, confirmed, or refuted
- require observed results to include before-state, after-state, and noticed-at before cause verification
- add U-quadrant candidate search, evidence-first question resolution, and root-cause language only after removal or action tests
- strengthen CLR ordering by separating sufficiency and necessity logic before edge challenges

## v1.1.0 - 2026-07-07

- require a tight red-capable feedback loop before hypothesis work
- add reproduce-and-minimise completion criteria so the regression seam is load-bearing
- route unknown root causes through Abductive ECE kill probes before CRT confirmation
- record fixes as TOC Injections with FRT/NBR cleanup and postmortem handoff rules

## v1.0.0 - 2026-04-17

- initial distributed `cc-diagnose` hotfix skill for feedback-loop-first bug diagnosis
