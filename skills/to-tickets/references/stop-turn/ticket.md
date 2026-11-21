## TURN-1: 停止正在生成的回合

- Parent: TURN（停止回合并保留部分结果）
- Repo: stop-turn-example
- Kind: behavior
- Owns: T1, R1
- Respects: 无
- Stories: 1
- Modules: 回合详情
- Blocked by: None

### What to build

- Scenarios: S1
- Interface: Spec / Implementation Decisions / 回合详情，`stop(turn: Turn): Turn`。
- Ensures: 同一决定下的返回状态与结果约定。
- 范围：用户从回合详情停止当前回合。重复停止交回需求作者裁决。

### Acceptance criteria

- [ ] S1（T1, R1）：给定详情已显示「第一段」，用户点击停止，回合显示已停止，详情仍可读到「第一段」。在回合详情执行操作并读回。
