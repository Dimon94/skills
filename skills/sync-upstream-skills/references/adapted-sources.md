# Adapted Sources

改写自上游的本仓自有 Skill 的出处清单。只供人工对照上游更新，不进入 `sources.json` 快照锁定，不参与 `--check` / `--update`。

| Skill | 上游仓库 | 上游路径 | 基于 commit | 对照链接 |
| --- | --- | --- | --- | --- |
| how | cursor/plugins | `pstack/skills/how` | `7314f723` | <https://github.com/cursor/plugins/blob/main/pstack/skills/how/SKILL.md> |
| why | cursor/plugins | `pstack/skills/why` | `7314f723` | <https://github.com/cursor/plugins/blob/main/pstack/skills/why/SKILL.md> |
| create-verification-skill | cursor/plugins | `pstack/skills/create-verification-skill` | `ecc249f1` | <https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md> |
| maintain-verification-skill | cursor/plugins | `pstack/skills/maintain-verification-skill` | `ecc249f1` | <https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-verification-skill/SKILL.md> |
| blast-radius | cursor/plugins | `pstack/skills/blast-radius` | `ecc249f1` | <https://github.com/cursor/plugins/blob/main/pstack/skills/blast-radius/SKILL.md> |

改写内容：how/why 仅把 Cursor 专属点位通用化（模型路由段、Task 子 agent 参数字段、`mcps/` 目录发现方式、cursor location 措辞），正文与 references 原文照抄。create-verification-skill 与 maintain-verification-skill 仅把生成/定位路径从 `.cursor/skills/` 改为 `.agents/skills/`（pi 原生发现项目级 `.agents/skills/`），其余原文照抄。blast-radius 把第 6 步的 `arena` 多模型并发改为建议用 `wayfinder` 画寻路图，并把收尾的 `unslop` 引用改为内联的去 AI 腔要求（本仓不引入该 skill），其余原文照抄。
