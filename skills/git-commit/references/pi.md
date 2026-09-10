# Pi 提交执行

仅在当前 Harness 是 Pi 时读取。提交选择只归 `~/.git-commit/pi/config.yaml`；`model` 使用完整 `provider/id`。已有配置若分开保存 `provider` 与裸 `model`，组合成完整标识；两者冲突即停止。

## 发现与调用

1. 先查询 `subagent` 的 `action: "list"` 和 `action: "models"`。前者列出可执行、未禁用的 agent；后者列出活动模型注册表。列表截断不代表模型不存在。
2. 核对磁盘配置时，默认 Pi 目录是 `~/.pi/agent/`：`models.json` 拥有自定义 provider/model 定义，`settings.json` 的 `enabledModels` 管理选择范围。运行时显式覆盖配置目录时使用该目录。只提取模型相关字段，避免读取或输出 `apiKey`。磁盘定义不等于已加载或服务可用。
3. 阅读已安装 `pi-subagents` 的 `docs/models.md`「Precedence」「Inspecting the live mapping」及当前工具 schema。每次调用的 `model` 覆盖优先于 agent 默认模型；`agent` 填角色名，`model` 填完整模型标识，`thinking` 接收配置的 `reasoning_effort`。`context: "fresh"` 只控制上下文，不选择模型。
4. 使用已发现的 agent，在原 cwd 启动；不新建 worktree。先确认该角色没有会换模型的 fallback；无法确认时停止。将本 Skill 绝对路径、配置选择、授权范围和验证要求传入任务。不要把 provider/model 填到 `agent` 字段。

## 新建角色与启动实例

角色定义和运行实例是两个操作。已有 `delegate` 能完成提交时直接复用；一次模型选择不需要新建角色。

需要独立工具权限或系统提示词时，先查看当前 schema，再用管理调用创建持久角色：

```json
{
  "action": "create",
  "config": {
    "name": "commit-worker",
    "description": "执行已授权的本地提交",
    "scope": "user",
    "tools": "read, bash, contact_supervisor",
    "systemPrompt": "先只读准备，等待父会话核验并放行写入。"
  }
}
```

`config.scope` 选择写入范围，默认 `user`；不是顶层的 `agentScope`。用户角色写入 `~/.pi/agent/agents/`，项目角色写入 `.pi/agents/`（采用当前运行时项目配置目录）。同名角色已存在时使用 `update`，不要覆盖文件。创建角色属于持久配置变更，执行前需有授权。

启动实例省略 `action`，将用户选择映射为独立参数。例如配置解析为 `junbo/deepseek-v4.1-flash` 和 `high` 时：

```json
{
  "agent": "delegate",
  "model": "junbo/deepseek-v4.1-flash",
  "thinking": "high",
  "context": "fresh",
  "async": true,
  "cwd": "<目标仓库绝对路径>",
  "task": "只读准备；禁止写文件、stage、commit。准备后用 contact_supervisor 请求核验并等待放行。"
}
```

`~/.git-commit/pi/config.yaml` 由本 Skill 读取并映射；插件不会自动读取它。持久模型默认值可来自角色 frontmatter 或 `settings.json` 的 `subagents.agentOverrides.<name>`，但本 Skill 使用每次调用覆盖，避免再维护一份提交模型选择。

## 源码核对入口

先定位当前安装的 `pi-subagents/package.json`；以下路径相对该包根。不要修改安装副本来绕过配置。

| 源码坐标 / 搜索符号 | 已核实行为 |
| --- | --- |
| `src/agents/agent-management.ts` / `handleCreate` | 解析 `config`，要求 name/description，读取 `config.scope`，应用配置后序列化角色文件。 |
| `src/runs/background/async-execution.ts` / `primaryModel`、`effectiveThinking` | 每次调用的 modelOverride 优先于 agentConfig.model；thinkingOverride 优先于角色 thinking。随后构造候选模型与 fallback。 |
| `src/runs/shared/pi-args.ts` / `applyThinkingSuffix`、`buildPiArgs` | 模型和推理强度组合成 `provider/id:level`，传给子进程 `--model`；不是靠任务文字切换模型。 |
| `src/runs/background/subagent-runner.ts` / `buildPiArgs`、`getPiSpawnCommand` | 将候选模型传给参数构造器，再启动原生 Pi 子进程。 |

正常解析链路是：调用参数 → 解析模型与 thinking → 候选模型 → CLI 参数 → Pi 子进程。源码支持模型覆盖；实际模型不符时应沿这条链定位，不能推断角色默认值一定覆盖调用参数。

## 生效与写入门槛

首次启动只授权只读准备，禁止 staging 和 commit。通过该 run 的 `status` 找到对应子步骤的 `sessionFile`，定向读取子会话 JSONL 的 `model_change`、`thinking_level_change` 和 assistant 消息的 provider/model。按时间顺序处理变更，核对当前值；不要误读父会话文件。`debug.run` 可辅助定位运行目录。

`attemptedModels`、恢复描述符中的模型和角色默认值都不等于实际响应模型。缺少 session 记录时，寻找宿主等价证据；字段或查询能力随版本变化，按当前 schema 查询。CLI 参数正确但会话记录不符时，继续核对 Pi CLI、恢复状态和已加载扩展；根因未证明前记 `Unknown`。

只有宿主证据匹配后，才向同一受核验执行者放行写入；若恢复产生新运行，重新核验。当前工具不支持这种门槛时，报告受阻，不直接启动有提交权限的任务。

provider 错误（如 `503 no_available_providers`）证明本次请求失败，不证明模型未注册或发生回退。保留错误与 run ID，按主 SKILL 的失败规则停止。

## 文档回归案例

- Pi 中运行 GPT：只读取 Pi 提交配置，不读取 Codex 配置。
- 活动模型列表被截断：继续定向查询，不据此断言未注册。
- agent 默认模型 A，每次调用指定 B：按覆盖优先级解析，并核验该 run；不能凭角色默认值声称回退。
- run 只有 `fresh` 或请求参数：生效证据不足，保持只读。
