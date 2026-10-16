# Adapted Sources

改写自上游的本仓自有 Skill 的出处清单。只供人工对照上游更新，不进入 `sources.json` 快照锁定，不参与 `--check` / `--update`。

| Skill | 上游仓库 | 上游路径 | 基于 commit | 对照链接 |
| --- | --- | --- | --- | --- |
| how | cursor/plugins | `pstack/skills/how` | `7314f723` | <https://github.com/cursor/plugins/blob/main/pstack/skills/how/SKILL.md> |
| why | cursor/plugins | `pstack/skills/why` | `7314f723` | <https://github.com/cursor/plugins/blob/main/pstack/skills/why/SKILL.md> |
| create-verification-skill | cursor/plugins | `pstack/skills/create-verification-skill` | `ecc249f1` | <https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md> |
| maintain-verification-skill | cursor/plugins | `pstack/skills/maintain-verification-skill` | `ecc249f1` | <https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-verification-skill/SKILL.md> |
| blast-radius | cursor/plugins | `pstack/skills/blast-radius` | `ecc249f1` | <https://github.com/cursor/plugins/blob/main/pstack/skills/blast-radius/SKILL.md> |
| investigate | cursor/plugins | `pstack/skills/poteto-mode/playbooks/investigation.md` | `ecc249f1` | <https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/investigation.md> |
| no-comments | cursor/plugins | `pstack/skills/no-comments`、`pstack/agents/comment-sicko.md` | `6ce45c59b9301a638c1fe1a7b8dc2a82b650898f` | <https://github.com/cursor/plugins/blob/6ce45c59b9301a638c1fe1a7b8dc2a82b650898f/pstack/skills/no-comments/SKILL.md> |
| in-your-own-words | cursor/plugins | `pstack/skills/in-your-own-words` | `6ce45c59b9301a638c1fe1a7b8dc2a82b650898f` | <https://github.com/cursor/plugins/blob/6ce45c59b9301a638c1fe1a7b8dc2a82b650898f/pstack/skills/in-your-own-words/SKILL.md> |
| test-review | mattpocock/skills | `skills/engineering/code-review` | `f3fc5632f401156837ee3872f14fe33ccf1024ea` | <https://github.com/mattpocock/skills/blob/f3fc5632f401156837ee3872f14fe33ccf1024ea/skills/engineering/code-review/SKILL.md> |
| epic-planner | mattpocock/skills | `skills/in-progress/chief-of-staff`、`skills/engineering/codebase-design`、`skills/engineering/wayfinder`、`skills/productivity/writing-for-agents` | `49dd158d1076134a641b33efb035946536778336` | <https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills> |

`test-review` 借鉴固定审查范围、Standards / Spec 独立分派与分轴报告的结构；测试审查内容由本仓维护，目标项目的测试规范在调用时读取。

`no-comments` 保留注释清理、必要例外、独立审查与根因修复流程；将 Comment Sicko 规则收进 Skill 的只读 reference，用宿主子 agent 替代 Cursor Task 类型。移除 poteto-mode、architect 与 principle Skill 的安装依赖，结构推演留在入口；how/why 复用现有 Skill。疑义项按 Unknown 保留，正确性抑制先修根因再删除，有效约束待编码时保留。`in-your-own-words` 保留只复述目标与问题的职责。两者使用中文，保留上游的 `disable-model-invocation: true`；Codex 显式调用策略归各自 `agents/openai.yaml`。均由本仓维护，不进入快照锁定清单。

`epic-planner` 借鉴目标负责制、深模块词汇、Wayfinder 的建索引/解票/frontier/迷雾循环与 context pointer 写法，并参考同 commit 的 `skills/engineering/to-spec`、`skills/engineering/to-tickets` 的远程 Issue 发布设计；在史诗层加入 investigate 内部调研，按票路由 research、prototype、grill-with-docs，远程保存结论后才收敛多地图计划。本仓拥有该寻路合同与跨地图集成规划，外部运行时依赖由调用环境提供，不复制上游 Skill。

改写内容：how/why 仅把 Cursor 专属点位通用化（模型路由段、Task 子 agent 参数字段、`mcps/` 目录发现方式、cursor location 措辞），正文与 references 原文照抄。create-verification-skill 与 maintain-verification-skill 仅把生成/定位路径从 `.cursor/skills/` 改为 `.agents/skills/`（pi 原生发现项目级 `.agents/skills/`），其余原文照抄。blast-radius 把第 6 步的 `arena` 多模型并发改为建议用 `wayfinder` 画寻路图，并把收尾的 `unslop` 引用改为内联的去 AI 腔要求（本仓不引入该 skill），其余原文照抄。investigate 去掉 Cursor 专属点位（throughput checkpoint、unslop、architect、babysit），路由目标换成本仓已有的 how / why，其余语义照抄。
