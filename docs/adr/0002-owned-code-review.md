# code-review 转为本仓自有 Skill

Status: accepted

## 决定

按用户 2026-09-07 的开发模式需求，`skills/code-review/SKILL.md` 统一拥有 Codex 双轴
审查的模型选择、只读边界与失败语义。依照 ADR-0001 的长期本地改造规则，将该 Skill
移出 `skills/sync-upstream-skills/references/sources.json`；其余快照保持原来源与 hash。
Pipeline 只传证据，不复制审查模型策略。非 Codex runtime 保持原生模型选择。

## 来源与回退

原始来源：https://github.com/mattpocock/skills.git，`skills/engineering/code-review`，MIT；
锁定 commit `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`，目录 SHA-256
`12daafb9c4f77deb3c3303dc2e6f8a3c2a0ff7928fc004af959ba18b8bd38068`。
现有许可文件保留。以后由本仓维护，不再自动同步该目录。
若撤销本地策略，恢复该锁定快照、来源清单条目及 System Map 归属后再验证 hash。
