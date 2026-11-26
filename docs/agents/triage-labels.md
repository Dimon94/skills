# Triage Labels

Skills 使用五个 canonical triage 角色。本表映射到本仓 issue tracker 实际使用的 label 字符串。

| Skill 里的角色 | 本仓 tracker 的 label | 含义 |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage` | `needs-triage` | 维护者需要评估这条 issue |
| `needs-info` | `needs-info` | 等报告者补充信息 |
| `ready-for-agent` | `ready-for-agent` | 规格完整，可交给 AFK agent |
| `ready-for-human` | `ready-for-human` | 需要人来实现 |
| `wontfix` | `wontfix` | 不处理 |

当 skill 提到某个角色（如 "apply the AFK-ready triage label"），使用右列对应的 label 字符串。

右列应随本仓 tracker 实际词汇调整。

## 规模分流

规模标签与五个 triage 角色独立使用。判定、改线和读回见 [dimon-mode 的「判定规模」](../../skills/dimon-mode/SKILL.md#判定规模)。

| Label | 含义 |
| --- | --- |
| `scope:bug` | 修复已承诺行为的偏差 |
| `scope:small` | 单票小需求 |
| `scope:mmf` | 进入 MMF 规划 |
