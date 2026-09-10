# Codex 提交执行

仅在当前 Harness 是 Codex 时读取。提交选择只归 `~/.git-commit/codex/config.yaml`；模型名称和推理强度以当前宿主支持的值为准。

1. 核对当前 spawn schema、可用模型和自定义角色覆盖。配置中的 `model` 与 `reasoning_effort` 必须映射到宿主真实支持的参数；不能靠任务文字请求模型切换。
2. 将本地提交委派给配置模型，留在原 repo/worktree，不新建 App task 或 worktree。完整历史 fork 不支持模型覆盖时，只有当前 schema 支持 `fork_turns: none` 才使用它，并传递本 Skill 绝对路径与完整任务。
3. 首次委派只授权只读准备。用宿主运行证据核对实际模型与推理强度后，再向同一执行者放行本地提交；恢复若产生新运行，重新核验。
4. 无模型覆盖能力、无生效回读或无写入放行机制时，按主 SKILL 报告受阻。不要借用 Pi 工具参数，也不要把请求参数当作实际值。

当前会话若不提供 Codex 原生工具，则调用 schema 与端到端运行状态为 `Unknown`；此参考不承诺固定的宿主字段可用。
