# Dverity 快速开始

[中文文档](./getting-started.zh-CN.md) | [English](./getting-started.md)

唯一完整产品契约是 [DVERITY.md](../../DVERITY.md)。本指南只说明安装与首次使用。

## 前置条件

- Node.js 18+
- npm
- Git 仓库
- Agent Skills host 或 Claude Code

## 安装

选择一个明确根目录：

```bash
npx dverity@5 install --project /absolute/path/to/project
# 或
npx dverity@5 install --global
```

安装会创建一个 `.dverity/managed-skills.json` ownership manifest，以及内容匹配的
`.agents/skills`、`.claude/skills` 投影。

已有 proven managed v4 root 时，必须使用迁移：

```bash
npx dverity@5 migrate --project /absolute/path/to/project
```

## 验证

```bash
npx dverity@5 verify --project /absolute/path/to/project
```

验证严格只读。ownership 缺失、hash drift、unknown 同名文件、scope 非法或 host discovery
不完整都会阻塞，不会顺手修复目标根目录。

## 首次使用

- confirmed defect 与本地回归证明使用 `dverity-repair`。
- 只有明确 push/review-item authority 时使用 `submit-remote-review`。
- 只有 authenticated provider-native item 与明确 landing authority 时使用
  `merge-remote-review`。

## 卸载

```bash
npx dverity@5 uninstall --project /absolute/path/to/project
```

只删除 manifest 与 hash 共同证明的投影；配置、人类证据、drift 文件和 unknown 文件保留。
