# 为 Dverity 做贡献

[中文版](./CONTRIBUTING.zh-CN.md) | [English](./CONTRIBUTING.md)

每个改动都应边界明确、证据充分。唯一完整产品契约由
[DVERITY.md](./DVERITY.md) 持有；贡献文档只描述仓库工作，不创建另一条生命周期。

## 本地准备

```bash
git clone https://github.com/Dimon94/dverity.git
cd dverity
npm ci
npm test -- --runInBand
npm run verify:publish
```

## 仓库责任

- `skills/` 是唯一 canonical Skill source。
- `.agents/skills` 与 `.claude/skills` 是安装投影，不是 source。
- `lib/dverity/` 持有生命周期与验证行为。
- `bin/dverity.js` 是唯一 executable entry。
- `DVERITY.md` 是唯一完整产品链契约。
- `docs/` 只放局部指南与不可变历史记录。

物理 Skill 集合必须保持为 `skills/` 已有的九个根目录。新增内部 gate、mode、validator
或 runbook，都不构成创建另一个 Skill 的理由。

## 改动纪律

1. 从能证明行为的最小公开测试 seam 开始。
2. 先跑 focused red，只实现足够的 green，再跑完整测试。
3. 保持 CHANGELOG、ADR、task、postmortem、research、tag 与其他 durable history 原文；
   除非当前工作明确拥有一条新的 append-only record。
4. Provider 与 registry mutation 必须有明确、具名的 authority。
5. 公开命令、Skill 责任、安装契约或安全边界变化时，同步 current docs。

## 常用检查

```bash
npm test -- --runInBand
npm run verify:publish
npm pack --dry-run
git diff --check
```

请在 [Dimon94/dverity](https://github.com/Dimon94/dverity) 提交聚焦的 issue 与 pull
request。安全问题按 [SECURITY.zh-CN.md](./SECURITY.zh-CN.md) 处理。
