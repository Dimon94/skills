---
name: sync-upstream-skills
description: 检查或更新本仓精选的第三方套件 Skill 快照。用于核对上游变化、刷新快照或处理同步漂移；只读检查可直接运行，写入更新必须由用户明确要求。
---

# Sync Upstream Skills

本 Skill 只维护 `references/sources.json` 声明的上游快照。来源清单拥有仓库、ref、
选取路径、锁定 commit 和内容 hash；`skills/<name>` 是 agent 运行时读取的快照。

## 检查

默认只读：

```bash
node skills/sync-upstream-skills/scripts/sync-upstream-skills.js --check
```

逐项报告：`current` 表示内容未变；`outdated` 表示上游已变化；`modified` 表示仓内
内容偏离锁定 hash；`missing` 表示快照缺失。后两种状态必须人工处理，不能覆盖。

完成标准：每个来源和 Skill 都有可复核状态；检查过程不写仓库。

## 更新

只有用户明确要求更新时运行：

```bash
node skills/sync-upstream-skills/scripts/sync-upstream-skills.js --update
```

脚本按来源做 sparse checkout，只复制清单中的目录。任一仓内快照出现本地漂移时，
整次更新 fail-close；先审查差异，再决定保留为本仓自有 Skill，或恢复锁定快照后重试。
更新后检查 diff，确认上游没有新增越权动作、依赖或不兼容 frontmatter，再运行每个
受影响 Skill 的最小验证和当前运行时可用的 Skill validator。

完成标准：清单 commit/hash 与全部快照一致，`--check` 返回成功，未触碰清单外 Skill。

## 边界

- 独立单-Skill 项目使用上游 clone + symlink，不进入来源清单。
- 改写自上游的自有 Skill 不进入来源清单；出处归 repo://skills/sync-upstream-skills/references/adapted-sources.md，人工对照。
- 本 Skill 不修改 `~/.agents`、`~/.claude`，也不提交、推送或发布。
- 对上游快照的长期本地改造必须转成本仓自有 Skill；快照目录不保留隐式 patch。
