# Dverity

> Truth before main.

[![GitHub stars](https://img.shields.io/github/stars/Dimon94/dverity?style=social)](https://github.com/Dimon94/dverity/stargazers)
[![npm version](https://img.shields.io/npm/v/dverity.svg)](https://www.npmjs.com/package/dverity)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](./package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[中文文档](./README.zh-CN.md) | [English](./README.md) | [快速开始](./docs/guides/getting-started.zh-CN.md) | [贡献指南](./CONTRIBUTING.zh-CN.md) | [安全策略](./SECURITY.zh-CN.md)

Dverity 是证据优先的交付工具。唯一完整产品契约在
[DVERITY.md](./DVERITY.md)；本 README 只说明安装和公开入口，不复制该契约。

## 安装

需要 Node.js 18+、npm 与 Git 仓库。

安装到一个明确的项目根目录：

```bash
npx dverity@5 install --project /absolute/path/to/project
```

或安装到明确的全局根目录：

```bash
npx dverity@5 install --global
```

已有受管 v4 安装必须显式迁移：

```bash
npx dverity@5 migrate --project /absolute/path/to/project
```

`install`、`migrate`、`verify`、`uninstall` 始终要求且只允许一个
`--global` 或 `--project <absolute-path>`；Dverity 不猜测目标根目录。

## Skills

包会把同一套九个根 Skill 安装到 `.agents/skills` 与 `.claude/skills`。
三个 workflow entry 只负责各自局部职责：

- `dverity-repair`：诊断并修复缺陷，终止于 Verified Local。
- `submit-remote-review`：把一个已验证 source 提交评审。
- `merge-remote-review`：评审并落地一个经过认证的 review item。

其余六个 Skill 是这些入口消费的可复用依赖。精确 source inventory 见
[Skill 能力图](./docs/agent-rules-books-skill-capability-map.md)。

## 验证或卸载

```bash
npx dverity@5 verify --project /absolute/path/to/project
npx dverity@5 uninstall --project /absolute/path/to/project
```

`verify` 严格只读。`uninstall` 只删除 install-root ownership manifest 精确证明的
投影，并保留配置、证据、drift 文件和 unknown 文件。

## 项目链接

- [GitHub](https://github.com/Dimon94/dverity)
- [npm](https://www.npmjs.com/package/dverity)
- [Issues](https://github.com/Dimon94/dverity/issues)
- [贡献指南](./CONTRIBUTING.zh-CN.md)
- [安全策略](./SECURITY.zh-CN.md)

项目采用 [MIT License](./LICENSE)。
