# Parallel Orchestration Boundary

Use this only when `cc-dev` dispatches `cc-diagnose` as an `EF###` diagnosis
environment.

## Scope

- Diagnose only the failure that triggered this environment: child failure,
  cherry-pick conflict, phase gate failure, or `cc-check` fail.
- If the real problem exceeds the current change scope, return route `cc-plan`
  or an independent `FIX`.
- Build the feedback loop and reproduce the original failure before hypothesis
  work. Without a loop, return blocked.

## Codex App Child Threads

- When creating a Codex App child thread, use the saved project worktree path as
  `projectId`, then switch inside the child thread to the required start branch
  and target worktree.
- If the controller requires a real Codex App child thread, create one. Do not
  substitute a subagent or simulate parallel work in the current thread.

## Commit Boundary

- Produce an independent commit unless the diagnosis proves no file change is
  required.
- Commit only the minimum fix for this failure: regression test, necessary task
  evidence, and debug cleanup.
- Follow `references/git-commit-guidelines.md` and
  `../do-not-repeat-yourself/SKILL.md`; fix commits must name root cause,
  verification, and risk.

## Final Report Checklist

- environment id
- commit or explicit no-change diagnosis
- reproduction loop
- regression command
- dirty state
- debug probe cleanup proof
- route recommendation
