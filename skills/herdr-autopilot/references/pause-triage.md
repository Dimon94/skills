# 暂停分诊与阶段切换

`poll` 返回 `needs_attention` 非空时读取本文件。所有原则正文以 [dimon-mode/SKILL.md](../../dimon-mode/SKILL.md) 及其指向的 `principle-*` 叶子为唯一真相，本文件只定义外控分诊路由。

Herdr 的 `done` 可能误报：lane 的后台子代理仍在跑，或尾部写着 `NEXT: blocked-human`。分诊时先看尾部内容，再信状态。

## 三档分诊表

| 档位 | 命中条件 | 动作 |
| --- | --- | --- |
| **自动推进** | 1. 阶段收口并点名下一步 `/to-spec`、`/to-tickets`、`/delivery-pipeline-herdr`；<br>2. `to-epic`、`to-spec`、`to-tickets`、`dimon-mode` 过程链路内的规划、设计、拆票与发布裁决（MMF 切分、Spec 边界、常规交互/实现取舍、确认拆票并发布到 tracker）——总控按 `dimon-mode` 原则优先选最简、贴合现行仓库约定或子 Agent 推荐的方案直接拍板，不打扰用户；<br>3. 技术选型或方案二选一，且能靠读代码、跑测试或查现行 Spec 得出结论；<br>4. 可逆的继续执行确认（如继续下一波 ticket、修完 review finding 重跑验证）；<br>5. Milestone 收口后派下一个 Milestone，不等用户催；<br>6. 宿主或工具版本不一致但不影响功能（如 Pi 版本提示），继续执行；<br>7. 协调会话断联后，按原合同重新委派。 | 先 `record-reply` 过熔断，再 `herdr agent prompt`（非默认 session 时带 `--session <session>`）回复；阶段前进时调用 `set-stage`。 |
| **升级人类** | 1. 缺少外部权限、账号登录、密钥，或仓库与 Issue 中完全查不到的外部商业/合规硬约束；<br>2. `blocked` 停在首次条款/权限/未知弹窗，或同一状态触发 `record-reply` 熔断（默认连续 3 次未进入新 stage）；<br>3. 同一类失败连续两次未定位根因（提示按 `principle-attack-the-premise` 停下）。 | 调用 `escalate`，向用户汇报「卡点 + 推荐方案 + 理由」，等待用户批复后再转发并 `resolve`。 |
| **硬拦截** | 合并 PR/MR、强推共享分支、删除数据、生产部署、对外发消息，或任何需要用户输入确认口令的不可逆动作（见 `dimon-mode`「自主权」节）。 | 绝不代输口令；PR/MR 待合入标 `awaiting_merge`，其余标 `escalated` 上报。 |

## 自动回复写作准则

给子 Agent 的回复保持短、硬、可执行：

- 阶段切换直接发对应斜杠命令与精确坐标（例：`/to-spec MMF-2，范围见 Epic #123`）。
- 回答技术二选一时，要求子 Agent 以运行证据定夺，不替它拍脑袋猜结论。
- 遇到可逆的 review finding 修复，明确要求按原入口先复现失败再修绿，不放宽验收标准。
- 在 `pipeline` 阶段读到子票开始实施或已通过验收并合入集成分支时，顺手调用 `node scripts/autopilot.js sync-issue --issue <ticket> --target <started|review|done>` 同步子票状态并回读，再汇报进展。

## 标准阶段流转

- **需求主链**：`epic` → `spec` → `tickets` → `pipeline` → `awaiting_merge` → `done`
- **缺陷主链**：`bugfix` → `awaiting_merge` → `done`

若子 Agent 在 `tickets` 阶段回报「超出单 MMF 边界需重切」，按 `dimon-mode` 链路回退到 `epic` 或升级给用户裁决，不硬塞进 `pipeline`。
