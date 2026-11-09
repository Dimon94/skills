# 写或改 Skill

Skill 只在 my-skills 仓库里写，在它的任务树里做。

1. 起草：运行时有 `writing-for-agents` 就按它写。写作规则见 my-skills 的 `docs/agents/writing-standards.md` 第 4 节。拿不准就删，只留删掉后 agent 决定会变的字；按名字委托给别的 Skill，不复述它的步骤。
2. 校验：在树根运行 `node scripts/check-skills.js`，退出码 0 才算通过。`known` 行是上游快照登记过的断链，不修；`error` 行逐条修掉。
3. 结构性改动（步骤、路由、门槛、脚本接口）：被改的 Skill 有 `references/verification.md` 时，按其中的前向案例检查实际产物。只改措辞时跳过本步。
4. 用 `git-commit` 交付。

反复碰到一套没有 Skill 承载的流程时，提议新建 Skill。
