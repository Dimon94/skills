# Agent Development Workflow

[中文](README.zh-CN.md)

This repository combines requirement shaping, map planning, spec and ticket creation, automated dispatch, and local Git closeout into one resumable development workflow. `skills/` is the canonical runtime source. Third-party suites contribute only curated upstream snapshots; standalone single-Skill projects stay in upstream clones and are consumed through symlinks.

![Development workflow](docs/assets/development-workflow.en.svg)

## Task Routing

| Task type | Workflow |
| --- | --- |
| Large requirement | Use `research`, Second Opinion, `grill-with-docs`, `brainstorming-only`, or `office-hours-only` as needed → create a shared Map with `wayfinder` → let `delivery-pipeline` advance it automatically |
| Small requirement | `grill-with-docs` → `to-spec` → `to-tickets` → hand the published Spec to `delivery-pipeline` |
| Refactor or optimization | Analyze with either `improve-codebase-architecture` or `productionize-app-with-services` → classify the resulting work by size → follow the large- or small-requirement workflow above |
| Bug | isolated Worktree → `diagnosing-bugs` → `git-commit` → `git-rebase-main` |
| Understand existing code | `how` walks the mechanism; `why` traces the motivation and constraints behind the shape |
| Assess a change's blast radius | `blast-radius` proves what a change breaks beyond the diff by running real code; foggy, wide impact goes to `wayfinder` |
| No scripted way to prove a project works | Run `create-verification-skill` once per project to generate a local `verify-<app>` skill; `maintain-verification-skill` keeps its feature map honest |

The pre-map tools are selected by the problem. They are not a fixed sequence and do not all have to run. Refactor and optimization analysis is also a pre-routing step, not an independent delivery path. Pushes, pull requests, and remote merges always require separate authority.

When a pull request reaches review, `gh-merge-pr` freezes one Review Packet, runs `code-review` as the main Standards and Spec review, and adds specialist reviews only when the request, changed paths, or main findings provide evidence. The current-head verdict must pass before a separately authorized merge and parity readback.

## Install the Skill Bundle Once

```bash
git clone https://github.com/Dimon94/skills.git \
  "$HOME/.local/share/dimon-agent-workflow/skills"
cd "$HOME/.local/share/dimon-agent-workflow/skills"
./scripts/install-development-workflow.sh
./scripts/install-development-workflow.sh --check
```

The script clones or fast-forwards standalone dependency repositories, then links repository-owned Skills, curated snapshots, and standalone Skills into `~/.agents/skills` and `~/.claude/skills`. It refuses to replace a real directory with a symlink. A dependency checkout with local changes is preserved and not updated.

To let an AI Agent inspect the environment, install runtime dependencies, and verify the result, paste the prompt from the [one-paste Agent bootstrap guide](docs/agent-bootstrap.md).

## Dependency Repositories

| Repository | Workflow responsibility | Standalone install |
| --- | --- | --- |
| [Dimon94/skills](https://github.com/Dimon94/skills) | Local delivery Skills such as `git-commit` and `git-rebase-main` | [`scripts/link-skills.sh`](scripts/link-skills.sh) |
| [mattpocock/skills](https://github.com/mattpocock/skills) | Research, grilling, architecture analysis, Wayfinder, specs, tickets, implementation, and review | [Installation](https://github.com/mattpocock/skills#installation-30-second-setup) |
| [swyxio/skills](https://github.com/swyxio/skills) | Upstream source for the curated `productionize-app-with-services` snapshot | Included by this repository's installer |
| [cursor/plugins](https://github.com/cursor/plugins) | Upstream source for the `thermo-nuclear-code-quality-review` snapshot and the adapted `how`, `why`, `blast-radius`, and verification-skill pair | Included by this repository's installer |
| [humanlayer/skills](https://github.com/humanlayer/skills) | Upstream source for the curated `show-me` snapshot | Included by this repository's installer |
| [Kappaemme-git/codex-complexity-optimizer](https://github.com/Kappaemme-git/codex-complexity-optimizer) | Standalone `complexity-optimizer` Skill | Linked directly by this repository's installer |
| [Dimon94/delivery-pipeline](https://github.com/Dimon94/delivery-pipeline) | Automated dispatch, integration, testing, and review from a Map or Spec | [Install](https://github.com/Dimon94/delivery-pipeline#install) |
| [Dimon94/brainstorming-only](https://github.com/Dimon94/brainstorming-only) | `brainstorming-only` and `office-hours-only` | [Quick Install](https://github.com/Dimon94/brainstorming-only#quick-install) |
| [fireworks-tech-graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph) | Generate and validate architecture, flow, and technical diagrams | [Installation](https://github.com/yizhiyanhua-ai/fireworks-tech-graph#installation) |
| [Second Opinion](https://github.com/Dimon94/codex-with-chatgpt) | Optional high-level planning and independent review | [One-paste install](https://github.com/Dimon94/codex-with-chatgpt#one-paste-install--一段话安装) |
| [Herdr](https://github.com/thinkerisme/herdr) | Terminal multi-agent runtime used by `delivery-pipeline` | [Install](https://herdr.dev/install) |

`delivery-pipeline` also needs at least one installed worker CLI: pi, Codex CLI, or Claude CLI. Codex App uses native Tasks and Worktrees and does not require Herdr.

## Repository Boundary

- `AGENTS.md`: repository working contract.
- `CONTEXT.md`: canonical vocabulary.
- `docs/architecture/current-system-map.md`: modules, dependencies, and verification entry points.
- `skills/`: the canonical source for repository-owned Skills and curated upstream snapshots.
- `scripts/link-skills.sh`: links repository-owned Skills and upstream snapshots from `skills/`.
- `scripts/install-development-workflow.sh`: installs the complete development-workflow Skill Bundle.
- `skills/sync-upstream-skills/references/sources.json`: source, path, commit, and content hash for every upstream snapshot.
- `skills/sync-upstream-skills/references/adapted-sources.md`: upstream source and base commit for repo-owned Skills adapted from upstream.

Run `$sync-upstream-skills` to check curated snapshots; it writes only after an explicit update request. Standalone single-Skill projects still update through their upstream clone, and symlinks consume the result immediately.
