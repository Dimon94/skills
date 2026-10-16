const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const skill = path.resolve(__dirname, "..");
const installer = path.join(skill, "scripts/install-hooks.cjs");

function sandbox(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "test-discipline-install-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const settings = path.join(home, "override/settings.json");
  fs.mkdirSync(path.dirname(settings));
  return { home, settings };
}

function invoke(box, args = [], script = installer) {
  const env = { ...process.env, HOME: box.home, CLAUDE_SETTINGS: box.settings };
  delete env.FORCE_COLOR;
  delete env.COLORTERM;
  return spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8", timeout: 5000 });
}

function success(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
}

function snapshot(box) {
  return fs.readdirSync(path.dirname(box.settings)).sort().map((name) => {
    const file = path.join(path.dirname(box.settings), name);
    const stat = fs.statSync(file);
    return [name, fs.readFileSync(file, "utf8"), stat.mtimeMs, stat.ino];
  });
}

test("缝 3 #1：安装保留他人条目、字段与顺序，先备份原配置", (t) => {
  const box = sandbox(t);
  const foreign = { matcher: "Write", hooks: [{ type: "command", command: "echo foreign" }] };
  const config = { env: { KEEP: "yes" }, hooks: { PostToolUse: [], PreToolUse: [foreign] }, theme: "dark" };
  const original = JSON.stringify(config, null, 4) + "\n";
  fs.writeFileSync(box.settings, original, { mode: 0o600 });
  const inode = fs.statSync(box.settings).ino;
  success(invoke(box));
  assert.notEqual(fs.statSync(box.settings).ino, inode);
  const installed = JSON.parse(fs.readFileSync(box.settings, "utf8"));
  assert.deepEqual(Object.keys(installed), ["env", "hooks", "theme"]);
  assert.deepEqual(Object.keys(installed.hooks), ["PostToolUse", "PreToolUse", "SubagentStart"]);
  assert.deepEqual(installed.env, config.env);
  assert.equal(installed.theme, "dark");
  assert.deepEqual(installed.hooks.PostToolUse, []);
  assert.deepEqual(installed.hooks.PreToolUse[0], foreign);
  const command = `node '${path.join(skill, "hooks/entry.cjs")}' claude`;
  const hook = { type: "command", command, timeout: 5 };
  assert.deepEqual(installed.hooks.PreToolUse[1], { matcher: "Edit|Write|MultiEdit", hooks: [hook] });
  assert.deepEqual(installed.hooks.SubagentStart, [{ hooks: [hook] }]);
  const backups = fs.readdirSync(path.dirname(box.settings)).filter((name) => name.includes(".bak-"));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^settings\.json\.test-discipline\.bak-\d{14}$/);
  assert.equal(fs.readFileSync(path.join(path.dirname(box.settings), backups[0]), "utf8"), original);
  assert.equal(fs.statSync(box.settings).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(box.home, ".claude")), false);
});

test("缝 3 #2：重装与 installed 检查不改字节、mtime、inode 或备份", (t) => {
  const box = sandbox(t);
  fs.writeFileSync(box.settings, "{}\n");
  success(invoke(box));
  const before = snapshot(box);
  success(invoke(box));
  assert.deepEqual(snapshot(box), before);
  const check = invoke(box, ["--check"]);
  success(check);
  assert.equal(check.stdout.trim(), "Claude: installed");
  assert.deepEqual(snapshot(box), before);
});

test("缝 3 #3：未安装检查只报 missing，不写现有或不存在的目标", (t) => {
  const box = sandbox(t);
  for (const exists of [false, true]) {
    if (exists) fs.writeFileSync(box.settings, '{"theme":"dark"}\n');
    const before = snapshot(box);
    const check = invoke(box, ["--check"]);
    assert.equal(check.status, 1, check.stderr);
    assert.equal(check.stderr, "");
    assert.equal(check.stdout.trim(), "Claude: missing");
    assert.deepEqual(snapshot(box), before);
  }
  assert.equal(fs.existsSync(path.join(box.home, ".claude")), false);
});

test("缝 3 #4：旧仓路径报告 drift，重装修复且保留混合组内他人的 hook", (t) => {
  const box = sandbox(t);
  const foreign = { type: "command", command: "echo keep" };
  const stale = { type: "command", command: "node '/old/skills/test-discipline/hooks/entry.cjs' claude", timeout: 5 };
  fs.writeFileSync(box.settings, JSON.stringify({ hooks: {
    PreToolUse: [{ matcher: "Write", hooks: [stale, foreign] }],
    SubagentStart: [{ hooks: [stale] }],
  } }));
  const before = snapshot(box);
  const check = invoke(box, ["--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.equal(check.stderr, "");
  assert.equal(check.stdout.trim(), "Claude: drift");
  assert.deepEqual(snapshot(box), before);
  success(invoke(box));
  const installed = JSON.parse(fs.readFileSync(box.settings, "utf8"));
  assert.deepEqual(installed.hooks.PreToolUse[0], { matcher: "Write", hooks: [foreign] });
  assert.ok(!JSON.stringify(installed).includes("/old/"));
  const repaired = invoke(box, ["--check"]);
  success(repaired);
  assert.equal(repaired.stdout.trim(), "Claude: installed");
});

test("缝 3 #5：卸载只移除本 Skill 条目与因此清空的组，备份后可重复执行", (t) => {
  const box = sandbox(t);
  const foreign = { type: "command", command: "echo keep" };
  const owned = { type: "command", command: `node '${path.join(skill, "hooks/entry.cjs")}' claude`, timeout: 5 };
  const stale = { ...owned, command: "node '/old/skills/test-discipline/hooks/entry.cjs' claude" };
  const empty = { matcher: "Read", hooks: [] };
  const config = { theme: "dark", hooks: {
    PreToolUse: [empty, { matcher: "Write", timeout: 9, hooks: [owned, foreign] }, { matcher: "Edit", hooks: [stale] }],
    SubagentStart: [{ hooks: [owned] }],
    PostToolUse: [{ hooks: [foreign] }],
  } };
  const original = JSON.stringify(config, null, 4) + "\n";
  fs.writeFileSync(box.settings, original);
  const result = invoke(box, ["--uninstall"]);
  success(result);
  assert.equal(result.stdout.trim(), "Claude: uninstalled");
  assert.deepEqual(JSON.parse(fs.readFileSync(box.settings, "utf8")), { theme: "dark", hooks: {
    PreToolUse: [empty, { matcher: "Write", timeout: 9, hooks: [foreign] }],
    SubagentStart: [],
    PostToolUse: [{ hooks: [foreign] }],
  } });
  const backups = fs.readdirSync(path.dirname(box.settings)).filter((name) => name.includes(".bak-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(box.settings), backups[0]), "utf8"), original);
  const before = snapshot(box);
  success(invoke(box, ["--uninstall"]));
  assert.deepEqual(snapshot(box), before);
  const check = invoke(box, ["--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.equal(check.stdout.trim(), "Claude: missing");
  assert.equal(fs.existsSync(path.join(box.home, ".claude")), false);
});

test("配置事件与 hook 字段的键顺序不影响 installed 判定", (t) => {
  const box = sandbox(t);
  fs.writeFileSync(box.settings, JSON.stringify({ hooks: { SubagentStart: [], PreToolUse: [] } }));
  success(invoke(box));
  const config = JSON.parse(fs.readFileSync(box.settings, "utf8"));
  assert.deepEqual(Object.keys(config.hooks), ["SubagentStart", "PreToolUse"]);
  for (const groups of Object.values(config.hooks)) {
    for (const group of groups) {
      group.hooks = group.hooks.map(({ type, command, timeout }) => ({ timeout, command, type }));
    }
  }
  fs.writeFileSync(box.settings, JSON.stringify(config));
  const before = snapshot(box);
  const check = invoke(box, ["--check"]);
  success(check);
  assert.equal(check.stdout.trim(), "Claude: installed");
  assert.deepEqual(snapshot(box), before);
});

test("目录片段相同的他人相对命令不被认领或移除", (t) => {
  const box = sandbox(t);
  const foreign = [
    { type: "command", command: "bash scripts/test-discipline/hooks/audit.sh" },
    { type: "command", command: "node 'scripts/test-discipline/hooks/entry.cjs' claude" },
  ];
  fs.writeFileSync(box.settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Write", hooks: foreign }] } }));
  const check = invoke(box, ["--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.equal(check.stdout.trim(), "Claude: missing");
  success(invoke(box));
  const config = JSON.parse(fs.readFileSync(box.settings, "utf8"));
  assert.deepEqual(config.hooks.PreToolUse[0], { matcher: "Write", hooks: foreign });
  success(invoke(box, ["--check"]));
});

test("缝 3 #6：非法 JSON 安装、检查与卸载退出 1，不写文件或备份", (t) => {
  const box = sandbox(t);
  const invalid = ['{"hooks": broken', 'null', '[]', '{"hooks":[]}', '{"hooks":{"PreToolUse":[{}]}}'];
  for (const content of invalid) {
    fs.writeFileSync(box.settings, content);
    const before = snapshot(box);
    for (const args of [[], ["--check"], ["--uninstall"]]) {
      const result = invoke(box, args);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^test-discipline:/);
      assert.ok(result.stderr.includes(box.settings));
      assert.deepEqual(snapshot(box), before);
    }
  }
});
