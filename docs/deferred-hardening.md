# 延后加固清单

用途：登记当前不执行的加固工作，让延后成为可检查的记录。本仓无产品交付阶段，清单只承载与 skill 质量相关的延后项。

## 维护规则

- 每次对话的工作收口时更新本文件：登记本次发现的新条目，或更新既有条目的证据与严重度。本次没有新发现时，写一行日期加“无新增”。
- 一条条目只登记一个可独立执行的加固动作。“补测试”“做安全审计”这类整体愿望必须拆开。
- 严重度用 repo://docs/agents/quality-standards.md 第 2 节的 P0-P3，由影响和可触发性决定。
- 证据坐标写文件加可搜索符号，或可复跑的命令与运行证据。没有证据时写 Unknown，不写猜测影响。
- 条目被用户要求执行后，状态改 Done 并写验证命令；判定为不需要时改 Dropped 并写理由。两种都不删行。
- 清单出现 P0 或 P1 条目时，在对话中点名并列出触发它的条目坐标。

## 类别

深度测试、安全扫描、脚本健壮性、文档一致性、跨运行时兼容。类别之外的延后项先确认它是否属于本清单职责，不扩表。

## 条目

| 日期 | 条目 | 类别 | 触发场景与影响 | 证据坐标 | 严重度 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-04 | postmortem-contract.js 的单元测试（原 test/postmortem-skill-contract.test.js）未随产品删除迁入，契约脚本当前无自动回归保护 | 深度测试 | 修改契约脚本时无快速验证 | repo://skills/postmortem/scripts/postmortem-contract.js；git history f681f58^:test/postmortem-skill-contract.test.js | P2 | Open |
| 2026-09-04 | git-push-pr 与 gh-merge-pr 为通用重写版，尚无一次真实 PR 生命周期验证；首次真实使用后按实际证据更新本行 | 深度测试 | skill 步骤与实际 gh 行为偏差无法在仓内暴露 | repo://skills/git-push-pr/SKILL.md；repo://skills/gh-merge-pr/SKILL.md | P3 | Open |
| 2026-10-10 | 核对并修正 issue-tracker.md 中过期的项目坐标 | 文档一致性 | 文档仍指向 Dimon94/dverity，与 AGENTS.md 和 Git remote 的 Dimon94/skills 冲突，按旧文档发布可能选错仓库 | repo://docs/agents/issue-tracker.md 首段；repo://AGENTS.md forge；`git remote get-url origin` | P2 | Done：2026-10-16 改为 Dimon94/skills；`grep -rn Dimon94/dverity docs/agents` 无结果 |
| 2026-10-10 | 为 Skill 格式校验接入提交守卫 | 脚本健壮性 | 当前仅手动校验，格式错误可未经检查进入提交；该守卫不能替代寻路行为重放 | `git config --get core.hooksPath` 无值；`.git/hooks` 无非 sample 钩子；`.github/workflows` 不存在；skill-creator 的 `quick_validate.py` 可手动运行 | P3 | Open |

## 收口记录

- 2026-09-04：无新增。
- 2026-10-10：epic-planner 无新增加固条目。

- 2026-10-24：test-discipline 回顾无新增加固条目；既有 Skill 格式提交守卫缺口仍为 Open，未扩入本次修改。
