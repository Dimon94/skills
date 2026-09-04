const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const script = path.resolve(
  __dirname,
  "../skills/sync-upstream-skills/scripts/sync-upstream-skills.js",
);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function runSync(args, cwd) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("同步上游快照，并在本地漂移时拒绝覆盖", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-sync-test-"));
  const upstream = path.join(sandbox, "upstream");
  const project = path.join(sandbox, "project");
  const sourceSkill = path.join(upstream, "suite", "sample-review");
  const targetSkill = path.join(project, "skills", "sample-review");
  const manifest = path.join(project, "sources.json");

  fs.mkdirSync(sourceSkill, { recursive: true });
  fs.writeFileSync(path.join(sourceSkill, "SKILL.md"), "version one\n");
  run("git", ["init", "-b", "main"], upstream);
  run("git", ["config", "user.email", "test@example.com"], upstream);
  run("git", ["config", "user.name", "Test"], upstream);
  run("git", ["add", "."], upstream);
  run("git", ["commit", "-m", "initial"], upstream);

  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    manifest,
    JSON.stringify(
      {
        schemaVersion: 1,
        sources: [
          {
            id: "sample-suite",
            repository: upstream,
            ref: "main",
            commit: null,
            skills: [
              {
                name: "sample-review",
                sourcePath: "suite/sample-review",
                treeSha256: null,
              },
            ],
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );

  const first = runSync(
    ["--update", "--manifest", manifest, "--root", project],
    project,
  );
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(fs.readFileSync(path.join(targetSkill, "SKILL.md"), "utf8"), "version one\n");

  fs.writeFileSync(path.join(targetSkill, "SKILL.md"), "local edit\n");
  fs.writeFileSync(path.join(sourceSkill, "SKILL.md"), "version two\n");
  run("git", ["add", "."], upstream);
  run("git", ["commit", "-m", "update"], upstream);

  const blocked = runSync(
    ["--update", "--manifest", manifest, "--root", project],
    project,
  );
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /本地内容已偏离锁定快照/);
  assert.equal(fs.readFileSync(path.join(targetSkill, "SKILL.md"), "utf8"), "local edit\n");
});
