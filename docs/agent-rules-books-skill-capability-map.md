# Agent Rules Books Skill Capability Map

This document maps the current cc-devflow skills to candidate capability
upgrades that can be mined from
`mattpocock/agent-rules-books`.

The goal is not to import book rules wholesale. The workflow starts from each
cc-devflow skill's responsibility, extracts only the useful vocabulary and
decision pressure, then turns that into smaller skill-native improvements.

## Source Model

External source:

- Repository: `https://github.com/mattpocock/agent-rules-books`
- Usage guide: `docs/USAGE.md`
- Compatibility matrix: `docs/COMPATIBILITY.md`

Local process sources requested for this iteration:

- PRD synthesis: `mattpocock-skills:to-prd`
- TDD optimization loop: `mattpocock-skills:tdd`

Do not publish machine-local absolute paths in this document. Resolve local
process skill locations from the operator's installed skill registry when
running the follow-up PRD or TDD workflow.

Useful source paths follow this shape:

```text
<book>/<book>.nano.md
<book>/<book>.mini.md
<book>/<book>.md
docs/compatibility/<book>/<other-book>.md
```

Use source sizes this way:

- `nano`: always-on reminder candidates only.
- `mini`: primary source for skill-native extraction.
- `full`: reference material for PRD, audit, or deep review work.
- `docs/compatibility/*`: conflict checks when two lenses pull on the same
  decision.

## Extraction Rules

1. Start from the cc-devflow skill responsibility.
2. Name the decision that skill must make better.
3. Pull terms, checks, and process steps from the smallest relevant book source.
4. Compress them into the skill's own contract language.
5. Put common-path pressure in `SKILL.md`; put longer procedures in
   `PLAYBOOK.md` or `references/`.
6. Verify improvements through public behavior: generated task quality, review
   verdict quality, route selection, or documented closeout evidence.
7. Do not add a parallel public skill before the existing skill loop proves the
   capability.

## Book Path Index

| Book lens | Primary use | Mini path | Full path | Nano path |
| --- | --- | --- | --- | --- |
| APoSD | complexity, deep modules, API depth, information hiding | `a-philosophy-of-software-design/a-philosophy-of-software-design.mini.md` | `a-philosophy-of-software-design/a-philosophy-of-software-design.md` | `a-philosophy-of-software-design/a-philosophy-of-software-design.nano.md` |
| Clean Architecture | dependency direction, policy/detail split, boundary stability | `clean-architecture/clean-architecture.mini.md` | `clean-architecture/clean-architecture.md` | `clean-architecture/clean-architecture.nano.md` |
| Clean Code | local readability, naming, small functions, test cleanliness | `clean-code/clean-code.mini.md` | `clean-code/clean-code.md` | `clean-code/clean-code.nano.md` |
| Code Complete | construction discipline, defensive design, implementation quality | `code-complete/code-complete.mini.md` | `code-complete/code-complete.md` | `code-complete/code-complete.nano.md` |
| DDIA | consistency, durability, data flow, schema and migration risk | `designing-data-intensive-applications/designing-data-intensive-applications.mini.md` | `designing-data-intensive-applications/designing-data-intensive-applications.md` | `designing-data-intensive-applications/designing-data-intensive-applications.nano.md` |
| DDD | domain language, bounded contexts, model ownership | `domain-driven-design/domain-driven-design.mini.md` | `domain-driven-design/domain-driven-design.md` | `domain-driven-design/domain-driven-design.nano.md` |
| DDD Distilled | lighter domain modeling and context mapping | `domain-driven-design-distilled/domain-driven-design-distilled.mini.md` | `domain-driven-design-distilled/domain-driven-design-distilled.md` | `domain-driven-design-distilled/domain-driven-design-distilled.nano.md` |
| IDDD | tactical domain patterns and implementation mapping | `implementing-domain-driven-design/implementing-domain-driven-design.mini.md` | `implementing-domain-driven-design/implementing-domain-driven-design.md` | `implementing-domain-driven-design/implementing-domain-driven-design.nano.md` |
| PoEAA | enterprise patterns, transaction scripts, service/data mapping | `patterns-of-enterprise-application-architecture/patterns-of-enterprise-application-architecture.mini.md` | `patterns-of-enterprise-application-architecture/patterns-of-enterprise-application-architecture.md` | `patterns-of-enterprise-application-architecture/patterns-of-enterprise-application-architecture.nano.md` |
| Refactoring | behavior-preserving improvement sequence | `refactoring/refactoring.mini.md` | `refactoring/refactoring.md` | `refactoring/refactoring.nano.md` |
| Refactoring Guru | smell catalog and pattern-level repair vocabulary | `refactoring-guru/refactoring-guru.mini.md` | `refactoring-guru/refactoring-guru.md` | `refactoring-guru/refactoring-guru.nano.md` |
| Release It | release gates, stability, rollback, production risk | `release-it/release-it.mini.md` | `release-it/release-it.md` | `release-it/release-it.nano.md` |
| Pragmatic Programmer | practical delivery habits, tracer bullets, broken windows | `the-pragmatic-programmer/the-pragmatic-programmer.mini.md` | `the-pragmatic-programmer/the-pragmatic-programmer.md` | `the-pragmatic-programmer/the-pragmatic-programmer.nano.md` |
| WELC | seams, characterization tests, legacy-safe changes | `working-effectively-with-legacy-code/working-effectively-with-legacy-code.mini.md` | `working-effectively-with-legacy-code/working-effectively-with-legacy-code.md` | `working-effectively-with-legacy-code/working-effectively-with-legacy-code.nano.md` |

## Skill Capability Map

Source editing rule:

- `.claude/skills/<skill>/` is the source skill surface.
- `.codex/skills/<skill>/` is generated adapter output when present; do not
  edit it as the source of truth.
- Maintainer-only skills that are not present under `.codex/skills/` still use
  `.claude/skills/<skill>/` as their source path.

| cc-devflow skill | Source paths for future PRD/issues |
| --- | --- |
| `cc-next` | `.claude/skills/cc-next/SKILL.md`; `.claude/skills/cc-next/PLAYBOOK.md`; generated mirror: `.codex/skills/cc-next/` |
| `cc-dev` | `.claude/skills/cc-dev/SKILL.md`; `.claude/skills/cc-dev/PLAYBOOK.md`; `.claude/skills/cc-dev/references/checklist-contract.md`; generated mirror: `.codex/skills/cc-dev/` |
| `cc-plan` | `.claude/skills/cc-plan/SKILL.md`; `.claude/skills/cc-plan/PLAYBOOK.md`; `.claude/skills/cc-plan/references/planning-contract.md`; `.claude/skills/cc-plan/assets/TASKS_TEMPLATE.md`; generated mirror: `.codex/skills/cc-plan/` |
| `cc-diagnose` | `.claude/skills/cc-diagnose/SKILL.md`; `.claude/skills/cc-diagnose/PLAYBOOK.md`; `.claude/skills/cc-diagnose/references/toc-thinking-processes.md`; `.claude/skills/cc-diagnose/references/parallel-orchestration-boundary.md`; generated mirror: `.codex/skills/cc-diagnose/` |
| `cc-do` | `.claude/skills/cc-do/SKILL.md`; `.claude/skills/cc-do/PLAYBOOK.md`; `.claude/skills/cc-do/references/execution-recovery.md`; generated mirror: `.codex/skills/cc-do/` |
| `cc-review` | `.claude/skills/cc-review/SKILL.md`; `.claude/skills/cc-review/PLAYBOOK.md`; `.claude/skills/cc-review/references/`; generated mirror: `.codex/skills/cc-review/` |
| `cc-check` | `.claude/skills/cc-check/SKILL.md`; `.claude/skills/cc-check/PLAYBOOK.md`; `.claude/skills/cc-check/references/gate-contract.md`; `.claude/skills/cc-check/references/review-contract.md`; generated mirror: `.codex/skills/cc-check/` |
| `cc-act` | `.claude/skills/cc-act/SKILL.md`; `.claude/skills/cc-act/PLAYBOOK.md`; `.claude/skills/cc-act/references/closure-contract.md`; `.claude/skills/cc-act/assets/PR_BRIEF_TEMPLATE.md`; generated mirror: `.codex/skills/cc-act/` |
| `postmortem` | `.claude/skills/postmortem/SKILL.md`; `.claude/skills/postmortem/PLAYBOOK.md`; `.claude/skills/postmortem/assets/`; generated mirror: `.codex/skills/postmortem/` |
| `cc-pr-review` | `.claude/skills/cc-pr-review/SKILL.md`; `.claude/skills/cc-pr-review/PLAYBOOK.md`; generated mirror: `.codex/skills/cc-pr-review/` |
| `cc-pr-land` | `.claude/skills/cc-pr-land/SKILL.md`; `.claude/skills/cc-pr-land/PLAYBOOK.md`; generated mirror: `.codex/skills/cc-pr-land/` |
| `cc-archive` | `.claude/skills/cc-archive/SKILL.md`; `.claude/skills/cc-archive/PLAYBOOK.md`; generated mirror: `.codex/skills/cc-archive/` |
| `cc-simplify` | `.claude/skills/cc-simplify/SKILL.md`; generated mirror: `.codex/skills/cc-simplify/` |
| `do-not-repeat-yourself` | `.claude/skills/do-not-repeat-yourself/SKILL.md`; generated mirror: `.codex/skills/do-not-repeat-yourself/` |
| `docs-sync` | `.claude/skills/docs-sync/SKILL.md`; `.claude/skills/docs-sync/PLAYBOOK.md`; `.claude/skills/docs-sync/references/sync-contract.md`; no generated `.codex` public mirror |
| `managed-skill-sync` | `.claude/skills/managed-skill-sync/SKILL.md`; no generated `.codex` public mirror |
| `npm-release` | `.claude/skills/npm-release/SKILL.md`; `.claude/skills/npm-release/PLAYBOOK.md`; no generated `.codex` public mirror |

| cc-devflow skill | Current responsibility | Candidate source lenses | Extractable keywords and flows | Target surface | TDD proof idea |
| --- | --- | --- | --- | --- | --- |
| `cc-dev` | Drive one selected planned objective autonomously through PDCA until delivery choice or blocker. | Pragmatic Programmer, Release It, Refactoring, WELC | tracer bullet, feedback loop, strict review convergence, stop-the-line blocker, one terminal state, no context drift, visible evidence chain | `SKILL.md` route/state-machine contract; `PLAYBOOK.md` stage-transition pressure; `references/checklist-contract.md` | Scenario fixture with stale validation forces reroute to `cc-check` or `cc-do` instead of shipping. |
| `cc-plan` | Clarify scope, freeze design decisions, and break work into executable tasks before coding. | APoSD, Clean Architecture, DDD Distilled, Refactoring, WELC | deep module, information hiding, caller knowledge, dependency direction, public seam, characterization test, vertical slice, design it twice, non-goals | `SKILL.md` Design Pressure; `PLAYBOOK.md` option comparison; `assets/TASKS_TEMPLATE.md` task fields | A planning fixture for a non-trivial API change must include boundary, public test seam, viable/ideal option, and vertical task slices. |
| `cc-diagnose` | Build a tight red-capable bug loop, minimise the repro, move evidence-backed causes through a TOC trust ladder, instrument, fix, and regression-test without the old heavy IDCA handoff. | WELC, Pragmatic Programmer, DDIA, Release It | characterization test, seam discovery, hypothesis board, hypothesis falsification, first bad state, feedback loop sharpening, data consistency, blast radius, escape analysis | `SKILL.md` six-phase diagnosis loop plus TOC reference | Bug fixture with weak evidence cannot call a cause confirmed until the hypothesis board records a removal or action test. |
| `cc-do` | Implement frozen tasks, resume work, or fix review feedback inside approved scope. | Local TDD skill, Refactoring, Clean Code, Code Complete, APoSD, WELC | one test one behavior, red-green vertical slice, minimal green, behavior-preserving refactor, remove touched smell, public interface only, no speculative code | `SKILL.md` execution law; `PLAYBOOK.md` loop examples; `references/execution-recovery.md` | A task fixture rejects horizontal test batch and requires one Red/Green tracer before next behavior. |
| `cc-review` | Deep review plans, investigations, implementations, PRs, complexity, hardening, and productization risk. | APoSD, Clean Architecture, Refactoring, Refactoring Guru, DDIA, Release It, WELC | shallow module, change amplification, dependency inversion, smell catalog, N+1, consistency failure, release hazard, characterization gap, finding severity | `references/` specialist lenses; `PLAYBOOK.md` routing; compatibility checks | Review fixture maps a finding to source evidence, violated control, repair option, and no local report file. |
| `cc-check` | Produce fresh verification evidence and honest pass/fail/blocked verdict before closeout. | Code Complete, Release It, Pragmatic Programmer, WELC | proof value, external behavior, confidence per minute, test boundary quality, false green, flaky isolation, missing evidence vs real failure | `references/gate-contract.md`; `references/review-contract.md` | Verification fixture with green no-op smoke test returns fail/blocked instead of pass. |
| `cc-act` | Commit, hand off, push, merge local main, or create/update PR with smallest durable delivery surface. | Release It, Pragmatic Programmer, Code Complete | release readiness, rollback, health check, watch items, atomic commit, durable handoff, no document farm, explicit delivery mode | `references/closure-contract.md`; `assets/PR_BRIEF_TEMPLATE.md` | Closeout fixture requires skipped release gates to carry reasons and refuses ambiguous push/PR default. |
| `postmortem` | Recall, interrogate, record, and update reusable failure lessons without turning every failure into process state. | Release It, Pragmatic Programmer, WELC | recurrence key, special-case recall, next-operator warning, root-cause status, escape analysis, workflow patch candidate | `SKILL.md`; `PLAYBOOK.md`; `assets/POSTMORTEM_TEMPLATE.md` | Contract fixture proves recurrence updates reuse the existing postmortem and special cases only recall on matching conditions. |
| `cc-pr-review` | Independently review one remote PR before landing. | APoSD, Refactoring, Release It, WELC, Clean Architecture | PR truth, changed contract, compatibility risk, review independence, production gate carry-forward, legacy seam risk | `PLAYBOOK.md`; `references/pr-review-chain.md`; `references/*` PR review facets | PR fixture with changed API but no tests produces a landing blocker with exact evidence. |
| `cc-pr-land` | Land reviewed PRs into main with review-first, rebase-first, production-gate-aware discipline. | Release It, Pragmatic Programmer, Code Complete | rebase discipline, main parity proof, deploy risk, rollback note, post-merge verification, no dirty landing | `SKILL.md` landing gates; `PLAYBOOK.md` rebase protocol | Landing fixture refuses merge when branch lacks reviewed verdict or main parity command proof. |
| `cc-archive` | Archive, restore, and list completed or shelved `devflow/changes/<change-key>/` directories. | Pragmatic Programmer, Release It | filesystem truth, no process files, explicit shelving, archive target conflict, restore conflict, path proof | `SKILL.md`; `PLAYBOOK.md`; CLI archive runtime | Archive fixture refuses an `ArchiveSkip` change and reports the CLI blocker instead of moving files manually. |
| `cc-simplify` | Clean confirmed smells in the current diff before check or act. | Refactoring, Refactoring Guru, APoSD, Clean Code, WELC | confirmed smell, deletion test, deep module, duplication, feature envy, primitive obsession, overmocked tests, safe refactor sequence | `PLAYBOOK.md`; `references/confirmed-smell-gate.md`; `references/reviewer-swarm.md`; `references/finding-triage.md` | Diff fixture with speculative cleanup candidate is reported but not edited; confirmed duplicated branch is simplified and rechecked. |
| `do-not-repeat-yourself` | Gate new mechanisms and commit diffs against existing wheels, duplicate meaning, and justified narrow duplication. | Pragmatic Programmer, Code Complete, Refactoring | wheel ladder, duplicate meaning, duplicate mechanism, bad abstraction, single source of truth, DRY record | `SKILL.md` coding-time and commit-time gate | Diff fixture with a new helper that duplicates an existing utility deletes the helper, reuses the utility, and records retained duplication. |
| `docs-sync` | Sync skill versions, changelogs, README/CONTRIBUTING/docs, and migration notes after public workflow changes. | Clean Code, Code Complete, Pragmatic Programmer | single source of truth, reader journey, version drift, public contract, no stale narrative, dependency-ordered docs | `references/sync-contract.md`; `SKILL.md` quality gate | Diff fixture touching a public skill requires version/changelog/docs drift scan. |
| `managed-skill-sync` | Maintainer-only source/mirror/package/downstream synchronization for cc-devflow skill distribution. | Release It, Pragmatic Programmer, Code Complete | registry truth, generated mirror, allowlist, dry-run, publish verification, downstream parity, stage hygiene | maintainer-only skill body; release checklist | Sync fixture refuses manual `.codex` mirror edits as source truth and requires adapter regeneration. |
| `npm-release` | Publish cc-devflow npm package with version, changelog, tag, dry-run, and registry verification. | Release It, Pragmatic Programmer, Code Complete | release atomicity, live registry truth, auth gate, dry-run, tag parity, post-publish smoke, rollback notes | `PLAYBOOK.md`; `references/checklist-contract.md` | Release fixture with existing version requires bump before publish and records registry verification commands. |

## Compatibility Risks

Use `docs/COMPATIBILITY.md` before enabling two book lenses as equal active
pressure. Important first-pass risks:

- DDD and PoEAA can conflict when model-first design and enterprise pattern
  catalog guidance fight over the same boundary.
- Clean Code, Code Complete, and Pragmatic Programmer overlap heavily for
  everyday implementation pressure. Pick one primary source per skill section.
- Refactoring and Refactoring Guru overlap. Use `refactoring` for sequence and
  safety; use `refactoring-guru` only for smell names and repair vocabulary.
- APoSD is the best default for plan/review architecture pressure because it
  talks about cognitive load and information hiding, not only object taxonomy.
- Release It should stay near `cc-check`, `cc-act`, `cc-pr-land`, and
  `npm-release`; do not let it turn every early plan into production ceremony.

## PRD Input Notes

### Problem Statement

cc-devflow already has a strong workflow loop, but each skill can make better
first-pass decisions if its responsibility is sharpened with selected software
engineering vocabulary and process pressure. Without a responsibility-driven
map, importing external rules risks prompt bloat, conflicting guidance, and
weak improvements that are hard to verify.

### Solution

Create an internal, non-public capability-upgrade lane that audits each
existing skill, maps it to relevant `agent-rules-books` sources, extracts only
skill-native rules, and then optimizes skills one by one through TDD-style
behavior fixtures.

### User Stories

1. As a cc-devflow maintainer, I want each skill's upgrade candidates mapped to
   its responsibility, so that I can improve the workflow without importing
   unrelated book rules.
2. As a cc-devflow maintainer, I want every candidate upgrade to name source
   skill files and generated mirrors, so that future PRD/issues can route edits
   to the right files.
3. As a cc-devflow maintainer, I want book rules compressed into skill-native
   vocabulary, so that the public workflow surface stays small.
4. As a cc-devflow maintainer, I want one skill optimized per vertical TDD
   slice, so that each capability improvement has a behavior proof.
5. As a cc-devflow user, I want agents to plan, implement, verify, and ship
   with stronger engineering judgment, so that they get more work right on the
   first pass.

### Implementation Decisions

- Skill contract audit: this map and future PRD/issue text.
- Skill runtime/tests: fixture-based tests that assert generated or validated
  behavior through public CLI/scripts where possible.
- Individual skill updates: small changes to `SKILL.md`, `PLAYBOOK.md`,
  `references/`, and templates.
- Docs sync: version/changelog/public docs after each shipped skill change.
- Source edits happen under `.claude/skills/<skill>/`; `.codex/skills/<skill>/`
  is regenerated adapter output when present.
- Local process skills are referenced by skill name only in publishable docs;
  machine-local absolute paths stay out of `docs/`.

### Testing Decisions

- Use vertical slices: one skill, one behavior, one failing fixture, one minimal
  skill update.
- Prefer public behavior fixtures over private text assertions.
- Treat prompt-size and skill benchmark output as part of verification when
  `SKILL.md` grows.
- Avoid horizontal rewrites across all skills.

### Out of Scope

- Creating a new public `book-rules` skill.
- Copying full rule files into cc-devflow.
- Turning `AGENTS.md` or `CLAUDE.md` into a global rule anthology.
- Shipping all skill upgrades in one PR.
- Publishing machine-local absolute paths in package docs.

### Further Notes

The formal PRD should be generated from this section plus the skill capability
map above. It should not re-interview the user unless a source path or target
surface is missing.

## Suggested Issue Breakdown

1. Audit source rule paths and freeze this capability map.
2. Add a `cc-plan` fixture proving design pressure appears in task contracts.
3. Upgrade `cc-plan` with APoSD/Clean Architecture/DDD Distilled extraction.
4. Add a `cc-do` fixture proving vertical TDD execution pressure.
5. Upgrade `cc-do` with TDD/Refactoring/Clean Code extraction.
6. Add a `cc-check` fixture proving false-green verification is rejected.
7. Upgrade `cc-check` with Code Complete/Release It proof-value extraction.
8. Add a `cc-act` fixture proving release gates and explicit delivery mode.
9. Upgrade `cc-act` with Release It closeout extraction.
10. Add `cc-review` lens routing fixtures and compatibility-risk checks.
11. Upgrade `cc-review` specialist lenses incrementally.
    release skills in priority order.
