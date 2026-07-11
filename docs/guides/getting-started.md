# Getting Started with Dverity

[中文文档](./getting-started.zh-CN.md) | [English](./getting-started.md)

The complete product contract is [DVERITY.md](../../DVERITY.md). This guide
covers only installation and first use.

## Requirements

- Node.js 18+
- npm
- a Git repository
- an Agent Skills host or Claude Code

## Install

Choose one explicit root:

```bash
npx dverity@5 install --project /absolute/path/to/project
# or
npx dverity@5 install --global
```

The install creates one `.dverity/managed-skills.json` ownership manifest and
matching `.agents/skills` and `.claude/skills` projections.

For a proven managed v4 root, use migration instead of install:

```bash
npx dverity@5 migrate --project /absolute/path/to/project
```

## Verify

```bash
npx dverity@5 verify --project /absolute/path/to/project
```

Verification is read-only. Missing ownership, hash drift, unknown same-name
files, invalid scope, or incomplete host discovery blocks instead of repairing
the root.

## First use

- Use `dverity-repair` for a confirmed defect and local regression proof.
- Use `submit-remote-review` only with explicit push/review-item authority.
- Use `merge-remote-review` only with an authenticated provider-native item and
  explicit landing authority.

## Uninstall

```bash
npx dverity@5 uninstall --project /absolute/path/to/project
```

Only manifest-and-hash-proven projections are removed. Configuration, human
evidence, drifted files, and unknown files remain.
