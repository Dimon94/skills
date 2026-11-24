# 暂停分诊与阶段切换

`poll` 返回 `needs_attention` 非空时读取本文件。所有原则正文以 [dimon-mode/SKILL.md](../../dimon-mode/SKILL.md) 及其指向的 `principle-*` 叶子为唯一真相，本文件只定义外控分诊路由。

## 三档分诊表

| 档位 | 命中条件 | 动作 |
| --- | --- | --- |
| **自动推进** | 1. 阶段收口并点名下一步 `/to-spec`、`/to-tickets`、`/delivery-pipeline-herdr`；<br>2. 技术选型或方案二选一，且能靠读代码、跑测试或查现行 Spec 得出结论（遵循 `dimon-mode` 硬规则：能靠运行观察到的答案不问人）；<br>3. 可逆的继续执行确认（如继续下一波 ticket、修完 review finding 重跑验证）。 | 先 `record-reply` 过熔断，再 `herdr --session <session> agent prompt` 回复；阶段前进时调用 `set-stage`。 |
| **升级人类** | 1. 实验与源码定不了的产品范围、交互偏好、业务口径拍板；<br>2. 缺少外部权限、账号登录、密钥或业务背景；<br>3. `blocked` 停在未知审批弹窗，或同一状态触发 `record-reply` 熔断（默认连续 3 次未进入新 stage）；<br>4. 同一类失败连续两次未定位根因（提示按 `principle-attack-the-premise` 停下）。 | 调用 `escalate`，向用户汇报「卡点 + 推荐方案 + 理由」，等待用户批复后再转发并 `resolve`。 |
| **硬拦截** | 合并 PR/MR、强推共享分支、删除数据、生产部署、对外发消息，或任何需要用户输入确认口令的不可逆动作（见 `dimon-mode`「自主权」节）。 | 绝不代输口令；PR/MR 待合入标 `awaiting_merge`，其余标 `escalated` 上报。 |

## 自动回复写作准则

给子 Agent 的回复保持短、硬、可执行：

- 阶段切换直接发对应斜杠命令与精确坐标（例：`/to-spec MMF-2，范围见 Epic #123`）。
- 回答技术二选一时，要求子 Agent 以运行证据定夺，不替它拍脑袋猜结论。
- 遇到可逆的 review finding 修复，明确要求按原入口先复现失败再修绿，不放宽验收标准。

## 标准阶段流转

- **需求主链**：`epic` → `spec` → `tickets` → `pipeline` → `awaiting_merge` → `done`
- **缺陷主链**：`bugfix` → `awaiting_merge` → `done`

若子 Agent 在 `tickets` 阶段回报「超出单 MMF 边界需重切」，按 `dimon-mode` 链路回退到 `epic` 或升级给用户裁决，不硬塞进 `pipeline`。
