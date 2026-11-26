# herdr 布局规则交给 agent 自觉

- 复发键：herdr-autopilot-layout-choice-by-agent
- 症状：用户反复纠正 Herdr 落位。多任务标签页都叫“1”；未按 2×2 四格和中文简写命名；两个 Epic 共用一个 workspace。
- 证据：ee5c88a、b4025ff、本次 feat/herdr-epic-workspace。
- 根因（已确认）：落位和命名规则写在 SKILL.md，资源由 agent 传参选择（如 place --workspace），脚本不决定。
- 教训类型：复发模式。
- 教训：Herdr 的 workspace、tab、pane 由 autopilot 脚本按 issue 和 Epic 决定并命名；agent 只给业务坐标，不传资源 ID。
- 强制：见 skills/herdr-autopilot/scripts/autopilot.js 与 layout.js 头部合同块。
- 召回条件：给 herdr-autopilot 或 delivery-pipeline-herdr 新增布局、命名或资源归属规则时。
