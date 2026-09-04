#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// -----------------------------------------------------------------------------
// COORD: skills/sync-upstream-skills/scripts/sync-upstream-skills.js
// INPUT: references/sources.json 与上游 Git 仓库。
// OUTPUT: skills/<name> 上游快照及更新后的锁定 commit/hash。
// POS: 只同步清单成员；不安装运行时链接，不修改独立仓库依赖。
// TEST: test/sync-upstream-skills.test.js
// -----------------------------------------------------------------------------

const defaultRoot = path.resolve(__dirname, "../../..");
const defaultManifest = path.resolve(__dirname, "../references/sources.json");

function parseArgs(argv) {
  const options = { mode: "check", manifest: defaultManifest, root: defaultRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.mode = "check";
    else if (argument === "--update") options.mode = "update";
    else if (argument === "--manifest") options.manifest = path.resolve(argv[++index] || "");
    else if (argument === "--root") options.root = path.resolve(argv[++index] || "");
    else if (argument === "--help" || argument === "-h") options.mode = "help";
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function printHelp() {
  console.log("Usage: sync-upstream-skills.js [--check | --update]");
  console.log("  --check   只读比较仓内快照、锁定值与上游 current head（默认）");
  console.log("  --update  在本地无漂移时更新全部快照和锁定值");
}

function validateRelative(value, label) {
  if (typeof value !== "string" || !value || value === "." || path.isAbsolute(value)) {
    throw new Error(`${label} 必须是非空相对路径`);
  }
  if (value.split(/[\\/]/).includes("..")) throw new Error(`${label} 不能包含 ..`);
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources)) {
    throw new Error("来源清单 schemaVersion 必须为 1，sources 必须是数组");
  }
  const names = new Set();
  for (const source of manifest.sources) {
    if (!/^[a-z0-9-]+$/.test(source.id || "")) throw new Error("source.id 非法");
    const githubRepository = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(source.repository || "");
    if (!githubRepository && !path.isAbsolute(source.repository || "")) throw new Error(`${source.id} 的 repository 非法`);
    if (!/^[A-Za-z0-9._/-]+$/.test(source.ref || "") || source.ref.includes("..") || source.ref.startsWith("-")) throw new Error(`${source.id} 的 ref 非法`);
    if (source.commit !== null && !/^[0-9a-f]{40}$/.test(source.commit || "")) throw new Error(`${source.id} 的 commit 非法`);
    if (!Array.isArray(source.skills) || source.skills.length === 0) throw new Error(`${source.id} 没有 skills`);
    for (const skill of source.skills) {
      if (!/^[a-z0-9-]+$/.test(skill.name || "") || names.has(skill.name)) throw new Error(`Skill 名称非法或重复：${skill.name}`);
      validateRelative(skill.sourcePath, `${skill.name}.sourcePath`);
      if (skill.sourcePath.startsWith("-")) throw new Error(`${skill.name}.sourcePath 非法`);
      if (skill.treeSha256 !== null && !/^[0-9a-f]{64}$/.test(skill.treeSha256 || "")) throw new Error(`${skill.name} 的 treeSha256 非法`);
      names.add(skill.name);
    }
  }
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "git 执行失败").trim();
    throw new Error(`${detail}\ncommand: git ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function walkFiles(root, relative = "") {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  return entries.flatMap((entry) => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? walkFiles(root, child) : [child];
  });
}

function treeHash(root) {
  if (!fs.existsSync(root)) return null;
  const digest = crypto.createHash("sha256");
  for (const relative of walkFiles(root)) {
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    digest.update(relative);
    digest.update("\0");
    digest.update(stat.isSymbolicLink() ? `link:${fs.readlinkSync(file)}` : fs.readFileSync(file));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function assertSafeTree(root, skillName) {
  for (const relative of walkFiles(root)) {
    const stat = fs.lstatSync(path.join(root, relative));
    if (!stat.isFile()) throw new Error(`${skillName} 含不受支持的非普通文件：${relative}`);
  }
}

function checkoutSource(source, temporaryRoot) {
  const checkout = path.join(temporaryRoot, source.id);
  runGit(["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", source.ref, source.repository, checkout]);
  runGit(["sparse-checkout", "set", ...source.skills.map((skill) => skill.sourcePath)], checkout);
  const commit = runGit(["rev-parse", "HEAD"], checkout);
  const skills = source.skills.map((skill) => {
    const sourceDirectory = path.join(checkout, skill.sourcePath);
    if (!fs.existsSync(path.join(sourceDirectory, "SKILL.md"))) throw new Error(`${source.id} 缺少 ${skill.sourcePath}/SKILL.md`);
    assertSafeTree(sourceDirectory, skill.name);
    return { skill, sourceDirectory, latestHash: treeHash(sourceDirectory) };
  });
  return { source, commit, skills };
}

function inspect(checkouts, root) {
  return checkouts.flatMap(({ source, commit, skills }) => skills.map(({ skill, sourceDirectory, latestHash }) => ({
    source,
    commit,
    skill,
    sourceDirectory,
    latestHash,
    target: path.join(root, "skills", skill.name),
    currentHash: treeHash(path.join(root, "skills", skill.name)),
  })));
}

function stateOf(row) {
  if (row.currentHash === null) return "missing";
  if (row.skill.treeSha256 === null || row.currentHash !== row.skill.treeSha256) return "modified";
  if (row.latestHash !== row.skill.treeSha256) return "outdated";
  return "current";
}

function check(rows) {
  let clean = true;
  for (const row of rows) {
    const state = stateOf(row);
    console.log(`${state}\t${row.skill.name}\t${row.commit}`);
    if (state !== "current") clean = false;
  }
  return clean;
}

function assertWritable(rows) {
  for (const row of rows) {
    const expected = row.skill.treeSha256;
    if (expected === null && row.currentHash === null) continue;
    if (expected === null || row.currentHash !== expected) {
      throw new Error(`本地内容已偏离锁定快照：skills/${row.skill.name}；请先人工处理差异`);
    }
  }
}

function replaceTree(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
}

function update(rows, manifest, manifestPath) {
  assertWritable(rows);
  for (const row of rows) {
    if (row.currentHash !== row.latestHash) replaceTree(row.sourceDirectory, row.target);
    row.skill.treeSha256 = row.latestHash;
    console.log(`${row.currentHash === row.latestHash ? "unchanged" : "updated"}\t${row.skill.name}\t${row.commit}`);
  }
  for (const source of manifest.sources) source.commit = rows.find((row) => row.source === source).commit;
  const temporaryManifest = `${manifestPath}.tmp`;
  fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(temporaryManifest, manifestPath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "help") return printHelp();
  const manifest = JSON.parse(fs.readFileSync(options.manifest, "utf8"));
  validateManifest(manifest);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-upstream-"));
  try {
    const rows = inspect(manifest.sources.map((source) => checkoutSource(source, temporaryRoot)), options.root);
    if (options.mode === "update") update(rows, manifest, options.manifest);
    else if (!check(rows)) process.exitCode = 1;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
