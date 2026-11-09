const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const script = path.resolve(__dirname, "../scripts/check-skills.js");

function suite(skills, knownBrokenLinks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-skills-"));
  for (const [name, body] of Object.entries(skills)) {
    fs.mkdirSync(path.join(root, "skills", name), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), body);
  }
  const refs = path.join(root, "skills/sync-upstream-skills/references");
  fs.mkdirSync(refs, { recursive: true });
  const manifest = { schemaVersion: 1, sources: [{ id: "up", skills: [{ name: "snap", knownBrokenLinks }] }] };
  fs.writeFileSync(path.join(refs, "sources.json"), JSON.stringify(manifest));
  return root;
}

function check(root) {
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

const skill = (name, body = "") => `---\nname: ${name}\ndescription: d\n---\n${body}\n`;

test("自有 Skill 的断链、name 不符、缺 description 都让检查失败", () => {
  const root = suite({
    own: skill("own", "见 [b](../missing/SKILL.md)，`[x](nope.md)` 与 [占位](url) 不算链接"),
    other: skill("wrong"),
    bare: "---\nname: bare\n---\n",
  });
  const r = check(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error\tskills\/own\/SKILL\.md\t断链 \.\.\/missing\/SKILL\.md/);
  assert.match(r.stdout, /error\tskills\/other\/SKILL\.md\tname 是 wrong/);
  assert.match(r.stdout, /error\tskills\/bare\/SKILL\.md\t缺 description/);
  assert.doesNotMatch(r.stdout, /nope|url/);
});

test("快照里登记过的断链只报告；新断链失败；登记过期也失败", () => {
  const link = "../gone/SKILL.md";
  let r = check(suite({ snap: skill("snap", `[g](${link})`) }, [link]));
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /known\tskills\/snap\/SKILL\.md\t断链/);

  r = check(suite({ snap: skill("snap", `[g](${link}) [n](../new/SKILL.md)`) }, [link]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error\t.*断链 \.\.\/new\/SKILL\.md/);

  r = check(suite({ snap: skill("snap") }, [link]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /knownBrokenLinks 已过期/);
});
