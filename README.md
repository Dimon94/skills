# Dverity

> Truth before main.

[![GitHub stars](https://img.shields.io/github/stars/Dimon94/dverity?style=social)](https://github.com/Dimon94/dverity)
[![npm version](https://img.shields.io/npm/v/dverity.svg)](https://www.npmjs.com/package/dverity)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](./package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[中文文档](./README.zh-CN.md) | [English](./README.md) | [Getting Started](./docs/guides/getting-started.md) | [Contributing](./CONTRIBUTING.md) | [Security](./SECURITY.md)

Dverity is an evidence-first delivery toolkit. Its complete product contract
lives only in [DVERITY.md](./DVERITY.md); this README covers installation and
the public entry points without duplicating that contract.

## Install

Requirements: Node.js 18+, npm, and a Git repository.

Install into one explicit project root:

```bash
npx dverity@5 install --project /absolute/path/to/project
```

Or install into the explicit global root:

```bash
npx dverity@5 install --global
```

An existing managed v4 installation must use the explicit migration command:

```bash
npx dverity@5 migrate --project /absolute/path/to/project
```

`install`, `migrate`, `verify`, and `uninstall` always require exactly one of
`--global` or `--project <absolute-path>`. Dverity never guesses a root.

## Skills

The package installs the same nine root Skills into `.agents/skills` and
`.claude/skills`. Use the three workflow entries for their local responsibility:

- `dverity-repair` — diagnose and repair a defect to Verified Local.
- `submit-remote-review` — submit one verified source for review.
- `merge-remote-review` — review and land one authenticated review item.

The remaining six Skills are reusable dependencies consumed by those entries.
See [the Skill capability map](./docs/agent-rules-books-skill-capability-map.md)
for the exact source inventory.

## Verify or uninstall

```bash
npx dverity@5 verify --project /absolute/path/to/project
npx dverity@5 uninstall --project /absolute/path/to/project
```

`verify` is read-only. `uninstall` removes only projections proven by the
install-root ownership manifest and preserves configuration, evidence, drifted
files, and unknown files.

## Project links

- [GitHub](https://github.com/Dimon94/dverity)
- [npm](https://www.npmjs.com/package/dverity)
- [Issues](https://github.com/Dimon94/dverity/issues)
- [Contribution guide](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)

Licensed under the [MIT License](./LICENSE).
