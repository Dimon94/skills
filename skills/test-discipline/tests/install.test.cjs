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
  const extensions = path.join(home, "pi-extensions");
  return { home, settings, codex: path.join(home, "override/hooks.json"), extensions, link: path.join(extensions, "test-discipline.js") };
}

function invoke(box, args = [], script = installer) {
  const env = { ...process.env, HOME: box.home, CLAUDE_SETTINGS: box.settings, CODEX_HOOKS: box.codex, PI_EXTENSIONS_DIR: box.extensions };
  delete env.FORCE_COLOR;
  delete env.COLORTERM;
  return spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8", timeout: 5000 });
}

function success(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
}

function snapshot(box) {
  return [path.dirname(box.settings), box.extensions].flatMap((directory) => {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).sort().map((name) => {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      const content = stat.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file, "utf8");
      return [file, content, stat.mtimeMs, stat.ino];
    });
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
  assert.deepEqual(installed.hooks.PreToolUse[1], { matcher: "Edit|Write|MultiEdit|Bash", hooks: [hook] });
  assert.deepEqual(installed.hooks.SubagentStart, [{ hooks: [hook] }]);
  const backups = fs.readdirSync(path.dirname(box.settings)).filter((name) => name.startsWith("settings.json.test-discipline.bak-"));
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
  assert.equal(fs.readlinkSync(box.link), path.join(skill, "hooks/pi.js"));
  assert.equal(fs.existsSync(path.join(box.home, ".pi")), false);
  const before = snapshot(box);
  success(invoke(box));
  assert.deepEqual(snapshot(box), before);
  const check = invoke(box, ["--check"]);
  success(check);
  assert.equal(check.stdout.trim(), "Claude: installed\nCodex: installed\nPi: installed");
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
    assert.equal(check.stdout.trim(), "Claude: missing\nCodex: missing\nPi: missing");
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
  fs.mkdirSync(box.extensions);
  const staleLink = "/old/skills/test-discipline/hooks/pi.js";
  fs.symlinkSync(staleLink, box.link);
  const before = snapshot(box);
  const check = invoke(box, ["--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.equal(check.stderr, "");
  assert.equal(check.stdout.trim(), "Claude: drift\nCodex: missing\nPi: drift");
  assert.deepEqual(snapshot(box), before);
  success(invoke(box, ["--uninstall"]));
  assert.equal(fs.readlinkSync(box.link), staleLink);
  success(invoke(box));
  assert.equal(fs.readlinkSync(box.link), path.join(skill, "hooks/pi.js"));
  const installed = JSON.parse(fs.readFileSync(box.settings, "utf8"));
  assert.deepEqual(installed.hooks.PreToolUse[0], { matcher: "Write", hooks: [foreign] });
  assert.ok(!JSON.stringify(installed).includes("/old/"));
  const repaired = invoke(box, ["--check"]);
  success(repaired);
  assert.equal(repaired.stdout.trim(), "Claude: installed\nCodex: installed\nPi: installed");
});

test("缝 3 Bash：旧 Claude matcher 报 drift，重装修复且不改变 Codex 与 Pi", (t) => {
  const box = sandbox(t);
  success(invoke(box));
  const config = JSON.parse(fs.readFileSync(box.settings, "utf8"));
  config.hooks.PreToolUse[0].matcher = "Edit|Write|MultiEdit";
  fs.writeFileSync(box.settings, JSON.stringify(config));
  const before = snapshot(box);
  const check = invoke(box, ["--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.equal(check.stderr, "");
  assert.equal(check.stdout.trim(), "Claude: drift\nCodex: installed\nPi: installed");
  assert.deepEqual(snapshot(box), before);
  success(invoke(box));
  success(invoke(box, ["--check"]));
  const unaffected = (rows) => rows.filter(([file]) => file === box.codex || file === box.link);
  assert.deepEqual(unaffected(snapshot(box)), unaffected(before));
});

test("缝 3 #5：卸载只移除本 Skill 条目与因此清空的组，备份后可重复执行", (t) => {
  const box = sandbox(t);
  success(invoke(box));
  assert.equal(fs.readlinkSync(box.link), path.join(skill, "hooks/pi.js"));
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
  fs.unlinkSync(box.link);
  const relativeLink = path.relative(box.extensions, path.join(skill, "hooks/pi.js"));
  fs.symlinkSync(relativeLink, box.link);
  const result = invoke(box, ["--uninstall"]);
  success(result);
  assert.equal(result.stdout.trim(), "Claude: uninstalled\nCodex: uninstalled\nPi: uninstalled");
  assert.equal(fs.existsSync(box.link), false);
  const piBackups = fs.readdirSync(box.extensions);
  assert.equal(piBackups.length, 1);
  assert.match(piBackups[0], /^test-discipline\.js\.test-discipline\.bak-\d{14}$/);
  assert.equal(fs.readlinkSync(path.join(box.extensions, piBackups[0])), relativeLink);
  assert.deepEqual(JSON.parse(fs.readFileSync(box.settings, "utf8")), { theme: "dark", hooks: {
    PreToolUse: [empty, { matcher: "Write", timeout: 9, hooks: [foreign] }],
    SubagentStart: [],
    PostToolUse: [{ hooks: [foreign] }],
  } });
  const backups = fs.readdirSync(path.dirname(box.settings)).filter((name) => name.startsWith("settings.json.test-discipline.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(box.settings), backups[0]), "utf8"), original);
  const before = snapshot(box);
  success(invoke(box, ["--uninstall"]));
  assert.deepEqual(snapshot(box), before);
  const check = invoke(box, ["--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.equal(check.stdout.trim(), "Claude: missing\nCodex: missing\nPi: missing");
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
  assert.equal(check.stdout.trim(), "Claude: installed\nCodex: installed\nPi: installed");
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
  assert.equal(check.stdout.trim(), "Claude: missing\nCodex: missing\nPi: missing");
  success(invoke(box));
  const config = JSON.parse(fs.readFileSync(box.settings, "utf8"));
  assert.deepEqual(config.hooks.PreToolUse[0], { matcher: "Write", hooks: foreign });
  success(invoke(box, ["--check"]));
});

test("缝 3 #7：Pi 目标是普通文件时拒绝覆盖，检查与卸载保留用户文件", (t) => {
  const box = sandbox(t);
  fs.mkdirSync(box.extensions);
  fs.writeFileSync(box.link, "// 用户自己的扩展\n");
  const before = fs.readFileSync(box.link);
  const inode = fs.statSync(box.link).ino;
  const install = invoke(box);
  assert.equal(install.status, 1, install.stderr);
  assert.match(install.stderr, /test-discipline:.*拒绝覆盖/);
  assert.ok(install.stderr.includes(box.link));
  assert.equal(fs.existsSync(box.settings), false);
  const check = invoke(box, ["--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stdout, /Pi: drift/);
  success(invoke(box, ["--uninstall"]));
  assert.deepEqual(fs.readFileSync(box.link), before);
  assert.equal(fs.statSync(box.link).ino, inode);
  assert.deepEqual(fs.readdirSync(box.extensions), ["test-discipline.js"]);
});

test("缝 3 Codex：保留配置、信任提示、幂等、漂移修复与卸载", (t) => {
  const box = sandbox(t);
  const foreign = { type: "command", command: "echo codex-keep" };
  const original = JSON.stringify({ keep: true, hooks: { PreToolUse: [{ matcher: "shell", hooks: [foreign] }] } });
  fs.writeFileSync(box.codex, original);
  const codexHome = path.join(box.home, ".codex");
  fs.mkdirSync(codexHome);
  const config = path.join(codexHome, "config.toml");
  fs.writeFileSync(config, "# 不得修改的信任记录\n");
  const configStat = fs.statSync(config);
  const result = invoke(box);
  success(result);
  assert.ok(result.stdout.replace(/\s+/g, " ").includes("Codex：请在 /hooks 中信任 test-discipline 条目"));
  const installed = JSON.parse(fs.readFileSync(box.codex, "utf8"));
  const hook = { type: "command", command: `node '${path.join(skill, "hooks/entry.cjs")}' codex`, timeout: 5 };
  assert.equal(installed.keep, true);
  assert.deepEqual(installed.hooks.PreToolUse, [
    { matcher: "shell", hooks: [foreign] }, { matcher: "apply_patch", hooks: [hook] },
  ]);
  assert.deepEqual(installed.hooks.SubagentStart, [{ hooks: [hook] }]);
  const backup = fs.readdirSync(path.dirname(box.codex)).find((name) => name.startsWith("hooks.json.test-discipline.bak-"));
  assert.ok(backup);
  assert.equal(fs.readFileSync(path.join(path.dirname(box.codex), backup), "utf8"), original);
  const before = snapshot(box);
  success(invoke(box));
  success(invoke(box, ["--check"]));
  assert.deepEqual(snapshot(box), before);
  installed.hooks.PreToolUse[1].hooks[0].command = "node '/old/test-discipline/hooks/entry.cjs' codex";
  fs.writeFileSync(box.codex, JSON.stringify(installed));
  const drifted = snapshot(box);
  const check = invoke(box, ["--check"]);
  assert.equal(check.status, 1, check.stderr);
  assert.equal(check.stdout.trim(), "Claude: installed\nCodex: drift\nPi: installed");
  assert.deepEqual(snapshot(box), drifted);
  success(invoke(box));
  success(invoke(box, ["--check"]));
  success(invoke(box, ["--uninstall"]));
  assert.deepEqual(JSON.parse(fs.readFileSync(box.codex, "utf8")), {
    keep: true, hooks: { PreToolUse: [{ matcher: "shell", hooks: [foreign] }], SubagentStart: [] },
  });
  const removed = snapshot(box);
  success(invoke(box, ["--uninstall"]));
  assert.deepEqual(snapshot(box), removed);
  assert.equal(fs.readFileSync(config, "utf8"), "# 不得修改的信任记录\n");
  assert.equal(fs.statSync(config).mtimeMs, configStat.mtimeMs);
  assert.deepEqual(fs.readdirSync(codexHome), ["config.toml"]);
});

function rejectsInvalidConfig(box, file, content) {
  fs.writeFileSync(box.settings, "{}\n");
  fs.writeFileSync(box.codex, "{}\n");
  fs.writeFileSync(file, content);
  const before = snapshot(box);
  for (const args of [[], ["--check"], ["--uninstall"]]) {
    const result = invoke(box, args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^test-discipline:/);
    assert.ok(result.stderr.includes(file));
    assert.deepEqual(snapshot(box), before);
  }
}

test("缝 3 #6：非法 JSON 安装、检查与卸载退出 1，不写文件或备份", (t) => {
  const box = sandbox(t);
  const invalid = ['{"hooks": broken', 'null', '[]', '{"hooks":[]}', '{"hooks":{"PreToolUse":[{}]}}'];
  for (const file of [box.settings, box.codex]) {
    for (const content of invalid) rejectsInvalidConfig(box, file, content);
  }
});
