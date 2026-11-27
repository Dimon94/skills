# 自动化审查评论分诊（Bugbot Triage）

[`../playbooks/babysit.md`](../playbooks/babysit.md) 处理 Bugbot 或自动化代码审查评论时按需读取本文件。目标不是默认忽略自动化评论，而是避免把每条评论都当成必须改代码的指令。

## 三档归类

动手前逐条归类：

- `fix`：指向可信的正确性、安全、隐私、数据丢失、认证、计费、迁移、幂等、竞态或已上线行为缺陷。在最低归属 PR 修复，push 后回复 commit SHA 并 resolve。
- `dismiss`：命中已记录的低风险噪声模式，且当前代码或运行结果能给出具体反证。回复简短依据并 resolve。
- `ask`：新出现的疑难问题、高严重度、涉及安全/隐私/数据，或意图不明。交由人类决定，不猜测。

拿不准时归 `ask`。漏掉一条真实数据或安全缺陷的代价远高于多问一句。

## 默认归 `ask` 的边界

以下类别即使过去在别的 PR 被跳过，也不自动 dismiss：

- 安全、隐私、鉴权、计费、数据保留与权限边界。
- 高严重度问题。
- 迁移、schema、幂等、并发与跨系统行为。
- 改动很小、明显降风险且不改变产品意图的建议（直接 `fix` 或交由人类确认）。

## 经验模式记录格式

新沉淀的稳定模式按以下结构追加到本文件：

```markdown
### <短模式名>

- Confidence: candidate | recurring | strong
- Skip when: <必须同时成立的条件>
- Do not skip when: <不可跳过的风险边界>
- Example signal: <典型措辞或代码语境>
- Source: <PR/评论坐标或简短实证>
```

`candidate`（1–2 例）→ `recurring`（多轮实证跳过）→ `strong`（边界极窄、反复验证、低风险）。

## 常见低风险跳过模式

### 有意为之的 UI / 设计系统视觉变更

- Confidence: candidate
- Skip when: PR 描述、截图、设计评审或邻近代码已明示视觉变更，评论只是复述共享视觉默认值变了。
- Do not skip when: 指向无障碍、焦点可见性、键盘导航、对比度，或非预期改动的组件 API 合同。
- Example signal: 焦点轮廓、按钮尺寸、间距变化，且 owner 已标明有意修改。

### 栈上层 PR 消费的导出或辅助函数

- Confidence: candidate
- Skip when: 评论称某导出/组件/文件未使用，但当前 PR 栈的上层 PR diff 已可查证正在引用它。
- Do not skip when: 当前 PR 不在栈内、符号是公开 API，或无法核实上层引用。
- Example signal: “Exported symbol is never used”，实际用于上层栈 PR。

### 平行迁移期间的临时重复代码

- Confidence: candidate
- Skip when: PR 为保持新旧路径并行而有意保留少量重复，旧路径将在后续删除或替换。
- Do not skip when: 重复逻辑涉及安全、计费、数据访问、API 合同，或长期共享抽象明显降风险。
- Example signal: “Significant duplication / duplicated validation”，PR 已明示旧路径待删。

### 既有框架或共享组件不变量已覆盖

- Confidence: candidate
- Skip when: 共享组件、框架合同、类型不变量或单一真相源在当前 diff 或邻近代码中明确强制保证了该约束。
- Do not skip when: 不变量仅靠口头假设未强制执行，或跨异步/状态边界可能分叉。
- Example signal: 内层弹层缺少 `max-height`，而外层共享弹层已强制视口边界。

### Owner 已明示延后的非高危清理

- Confidence: candidate
- Skip when: PR owner 明确记录为已知后续清理，当前 PR 未恶化行为，且非高危领域。
- Do not skip when: 无 owner 表态、属中高危产品行为，或延后会合入新回归。

### 评论自撤或明确误报的规则告警

- Confidence: recurring
- Skip when: 评论正文或后续回复已自撤/声明合规，且本地可验证规则确已满足。
- Do not skip when: 高危问题仅靠人工口头一句“误报”而无依据。

## 实战校准规则

### 手写复刻浏览器原生行为——默认 `fix`

- Confidence: candidate
- Skip when: 几乎不跳过。用 JS 定位克隆替代原生 sticky、手工转发滚轮/触摸事件、用 mask/clip-path 模拟遮挡时，逻辑缺陷类告警命中率极高。
- Do not skip when: 涉及事件转发缺口（`deltaMode`、边缘滚动链、触摸阈值）、命中测试偏差或 Observer 与框架状态的时序竞态。

### 文档/合同测试漂移告警——先跑一次测试再判

- Confidence: candidate
- Skip when: 永不跳过验证动作。当 PR 含锁定文档或协议措辞的测试，且告警称“测试与文档脱节”时，直接在 PR 顶端跑该测试：红灯实锤为 `fix`，绿灯直接作为 `dismiss` 反证。前几轮修文恰恰最容易导致此类漂移，不靠“多轮后偏跳过”的直觉判断。

### 同 PR 后续提交已修掉的过时安全告警

- Confidence: candidate
- Skip when: 安全扫描针对旧提交报缺鉴权或校验，但当前 PR 顶端在副作用前已调用该门禁并附测试。
- Do not skip when: 校验对该主体为空操作、位于副作用之后，或缺少对应主体的测试覆盖。

### 故意收窄的错误分支不可盲目放宽

- Confidence: candidate
- Skip when: 告警要求把窄错误码（如仅在 `ENOENT` 时回退备用命令）放宽为兜底重试，而窄条件区分了“依赖未安装”与“命令执行失败”；盲目放宽会用备用路径的报错掩盖真实鉴权/网络/业务错误。
- Do not skip when: 漏掉了同类“二进制不可用”错误码（如 `EACCES`）、会丢数据或留半成品，或重试幂等且仍暴露原错误。
