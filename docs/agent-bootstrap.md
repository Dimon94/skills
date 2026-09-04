# AI Agent 一次安装 / One-paste AI Agent Bootstrap

本页只有一个职责：把完整开发链路交给 AI Agent 安装并验证。脚本负责 Skill 源码与 symlink；Agent 负责识别当前操作系统、当前运行时和需要人工参与的登录或模型选择。

This page has one responsibility: hand the complete development workflow to an AI Agent for installation and verification. The script owns Skill sources and symlinks. The Agent owns environment detection and any login or model choice that requires a person.

## 中文提示词

把下面整段复制给能够操作终端的 AI Agent：

```text
请安装并验证 Dimon Agent Development Workflow。除登录、验证码、付费、权限升级和模型角色选择外，全程自行完成；每次需要我介入时只问一个问题。

1. 先检查操作系统、git、python3、当前 Agent 类型、当前 Skill home，以及已有 checkout 和 symlink。保留所有未提交改动。不要覆盖同名普通目录，不要打印或复制密钥与环境变量。
2. 把 https://github.com/Dimon94/skills.git clone 到 ~/.local/share/dimon-agent-workflow/skills。目录已存在时，先确认它是该仓库；工作区干净才执行 git pull --ff-only，有改动则保留并继续使用当前 checkout。
3. 在该仓库运行 ./scripts/install-development-workflow.sh，然后运行 ./scripts/install-development-workflow.sh --check。修复所有失败，直到检查通过。
4. 确认当前 Agent 能发现 research、grill-with-docs、improve-codebase-architecture、productionize-app-with-services、wayfinder、to-spec、to-tickets、diagnosing-bugs、brainstorming-only、office-hours-only、delivery-pipeline、fireworks-tech-graph、git-commit、git-rebase-main、gh-merge-pr、code-review、complexity-optimizer、thermo-nuclear-code-quality-review、better-interface、vercel-react-best-practices 和 supabase-postgres-best-practices。若当前运行时不读取 ~/.agents/skills 或 ~/.claude/skills，只把同一 Canonical source 链入该运行时真实的 Skill home；不要另建运行时副本。
5. 如果我要使用 delivery-pipeline 的 CLI/Herdr 调度，检查 Herdr 与至少一个 Worker CLI（pi、Codex CLI 或 Claude CLI）。缺少 Herdr 时只从 https://herdr.dev/install 的官方说明安装，并为本机已存在的 Agent CLI 安装对应 integration；不要安装我没有使用的 Worker CLI。Codex App 原生 Task/Worktree 模式不需要 Herdr。
6. delivery-pipeline 的 Worker 角色尚未配置时，调用 delivery-pipeline-setup。模型和 effort 必须让我选择，不要猜默认值。
7. Second Opinion 是可选前置工具。只有我明确要求启用时，按 https://github.com/Dimon94/codex-with-chatgpt 的安装说明配置；只在 ChatGPT/Cloudflare 登录、验证码或两步验证时叫我。
8. 最后报告：每个源码仓库路径与 remote、每个必需 Skill 的实际 symlink、--check 结果、Herdr/Agent CLI 状态、delivery-pipeline 配置状态，以及仍需我完成的唯一下一步。没有证据的状态写 Unknown。
```

## English Prompt

Paste the complete block below into an AI Agent that can operate a terminal:

```text
Install and verify the Dimon Agent Development Workflow. Work autonomously except for logins, CAPTCHAs, payments, permission elevation, and worker-model choices. Ask me only one question at a time when human input is required.

1. Inspect the operating system, git, python3, the current Agent, its real Skill home, existing checkouts, and existing symlinks. Preserve every uncommitted change. Never replace a same-name real directory, and never print or copy secrets or environment variables.
2. Clone https://github.com/Dimon94/skills.git into ~/.local/share/dimon-agent-workflow/skills. If the directory exists, first prove that it is the same repository. Run git pull --ff-only only when the checkout is clean; preserve and use a dirty checkout without updating it.
3. In that repository, run ./scripts/install-development-workflow.sh and then ./scripts/install-development-workflow.sh --check. Repair failures until the check passes.
4. Confirm that the current Agent can discover research, grill-with-docs, improve-codebase-architecture, productionize-app-with-services, wayfinder, to-spec, to-tickets, diagnosing-bugs, brainstorming-only, office-hours-only, delivery-pipeline, fireworks-tech-graph, git-commit, git-rebase-main, gh-merge-pr, code-review, complexity-optimizer, thermo-nuclear-code-quality-review, better-interface, vercel-react-best-practices, and supabase-postgres-best-practices. If this runtime reads neither ~/.agents/skills nor ~/.claude/skills, link the same canonical sources into its actual Skill home. Do not create another runtime copy.
5. If I will use delivery-pipeline through CLI/Herdr dispatch, check Herdr and at least one worker CLI: pi, Codex CLI, or Claude CLI. If Herdr is missing, install it only from https://herdr.dev/install and install integrations only for Agent CLIs already present. Do not install worker CLIs I do not use. Native Codex App Tasks and Worktrees do not require Herdr.
6. If delivery-pipeline worker roles are not configured, invoke delivery-pipeline-setup. I must choose every model and effort value; do not invent defaults.
7. Second Opinion is optional. Configure it from https://github.com/Dimon94/codex-with-chatgpt only when I explicitly ask for it. Interrupt me only for ChatGPT or Cloudflare login, CAPTCHA, or two-factor authentication.
8. Report each source checkout and remote, every required Skill's actual symlink, the --check result, Herdr and Agent CLI status, delivery-pipeline configuration status, and the single remaining action that needs me. Mark anything without evidence as Unknown.
```

## Deterministic Skill-only Command

已经具备 Git 和 Python、只需要安装 Skill 时，直接运行：

If Git and Python are already available and only the Skills are needed, run:

```bash
git clone https://github.com/Dimon94/skills.git \
  "$HOME/.local/share/dimon-agent-workflow/skills"
cd "$HOME/.local/share/dimon-agent-workflow/skills"
./scripts/install-development-workflow.sh
./scripts/install-development-workflow.sh --check
```

`--offline` 使用已有 checkout，不访问网络。`--check` 只验证，不修改文件。

`--offline` uses existing checkouts without network access. `--check` verifies without changing files.
