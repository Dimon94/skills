const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const script = path.resolve(__dirname, "../scripts/install-development-workflow.sh");

test("链接依赖按最终来源检查，安装保留正确中间链接并拒绝错误来源", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-links-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const sources = path.join(home, "sources");
  const projects = {
    "mattpocock-skills": ["mattpocock/skills", [
      ...["wayfinder", "research", "grill-with-docs", "improve-codebase-architecture",
        "to-tickets", "diagnosing-bugs", "domain-modeling", "prototype"].map((name) => `skills/engineering/${name}`),
      "skills/productivity/grilling",
    ]],
    "brainstorming-only": ["Dimon94/brainstorming-only", ["brainstorming-only", "office-hours-only"]],
    "delivery-pipeline": ["Dimon94/delivery-pipeline", [
      "skills/delivery-pipeline", "skills/delivery-pipeline-codex-app", "skills/delivery-pipeline-setup",
    ]],
    "fireworks-tech-graph": ["yizhiyanhua-ai/fireworks-tech-graph", ["skills/fireworks-tech-graph"]],
    "codex-complexity-optimizer": ["Kappaemme-git/codex-complexity-optimizer", ["complexity-optimizer"]],
  };
  for (const [project, [remote, skills]] of Object.entries(projects)) {
    const checkout = path.join(sources, project);
    fs.mkdirSync(checkout, { recursive: true });
    assert.equal(spawnSync("git", ["init", checkout]).status, 0);
    assert.equal(spawnSync("git", ["-C", checkout, "remote", "add", "origin", `https://github.com/${remote}.git`]).status, 0);
    for (const skill of skills) {
      fs.mkdirSync(path.join(checkout, skill), { recursive: true });
      fs.writeFileSync(path.join(checkout, skill, "SKILL.md"), "fixture\n");
    }
  }
  const agents = path.join(home, ".agents/skills");
  const claude = path.join(home, ".claude/skills");
  const env = { ...process.env, HOME: home, WORKFLOW_SKILL_SOURCE_ROOT: sources,
    AGENTS_SKILLS_DIR: agents, CLAUDE_SKILLS_DIR: claude };
  for (const key of ["MATTPOCOCK_SKILLS_DIR", "BRAINSTORMING_SKILLS_DIR", "DELIVERY_PIPELINE_DIR",
    "FIREWORKS_TECH_GRAPH_DIR", "COMPLEXITY_OPTIMIZER_DIR", "FORCE_COLOR", "COLORTERM"]) delete env[key];
  const run = (flag) => spawnSync("bash", [script, flag], { env, encoding: "utf8" });
  let result = run("--offline");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const intermediate = path.join(home, "library-wayfinder");
  fs.symlinkSync("sources/mattpocock-skills/skills/engineering/wayfinder", intermediate);
  const target = path.join(agents, "wayfinder");
  fs.unlinkSync(target);
  fs.symlinkSync(intermediate, target);

  // 独立预期来自用户验收：正确来源通过，安装不能抢写中间链接。
  result = run("--check");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  result = run("--offline");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readlinkSync(target), intermediate);

  fs.unlinkSync(intermediate);
  fs.symlinkSync("sources/mattpocock-skills/skills/engineering/research", intermediate);
  result = run("--check");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr.replace(/\s+/g, " "), /expected symlink .*wayfinder/);
  assert.equal(fs.readlinkSync(target), intermediate);
});
