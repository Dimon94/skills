#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: scripts/check-skills.js
//   INPUT: 仓库根目录（默认本脚本上一级）；skills/*/ 下的 .md；sync-upstream-skills 来源清单
//   OUTPUT: 每个问题一行 "<error|known>\t<文件>\t<说明>"；有 error 时退出 1
//   POS: L1 验证列“Skill 校验”的命令；只读，不改任何文件
//   TEST: node --test test/check-skills.test.js
// L5
//   PARAM: 链接 = 代码块外、非 URL、非锚点、含 . 或 / 的 ](目标)
//   FAIL: name 不等于目录名、缺 description、相对链接指向的文件不存在 → error
//   FAIL: 来源清单 knownBrokenLinks 里登记的链接已能解析 → error（登记过期）
// L6
//   CHAIN: 上游快照的正文由来源清单哈希锁定，本仓不改；它的断链登记在
//          该 Skill 条目的 knownBrokenLinks 里，只报告为 known，新断链照样失败
// ==========================================================================
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const skillsDir = path.join(root, "skills");
const manifest = path.join(skillsDir, "sync-upstream-skills/references/sources.json");

// 来源清单里登记的已知断链：skill 名 → 链接集合
function knownBroken() {
  if (!fs.existsSync(manifest)) return new Map();
  const { sources } = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const entries = sources.flatMap((s) => s.skills).map((k) => [k.name, new Set(k.knownBrokenLinks || [])]);
  return new Map(entries);
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  return Object.fromEntries(m[1].split("\n").map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
}

function mdFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(e.parentPath, e.name));
}

// 代码块外的相对链接目标，去掉锚点；不含 . 或 / 的目标（如 url）是模板占位符
function relativeLinks(text) {
  const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\]\(([^)\s]+)/g)].map((m) => m[1])
    .filter((t) => !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(t) && /[./]/.test(t))
    .map((t) => t.split("#")[0]).filter(Boolean);
}

function checkSkill(name, known, report) {
  const dir = path.join(skillsDir, name);
  const fm = frontmatter(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"));
  const rel = `skills/${name}/SKILL.md`;
  if (fm.name !== name) report("error", rel, `name 是 ${fm.name || "空"}，应等于目录名 ${name}`);
  if (!fm.description) report("error", rel, "缺 description");
  const seen = new Set();
  for (const file of mdFiles(dir)) {
    for (const link of relativeLinks(fs.readFileSync(file, "utf8"))) {
      if (fs.existsSync(path.resolve(path.dirname(file), link))) continue;
      seen.add(link);
      report(known.has(link) ? "known" : "error", path.relative(root, file), `断链 ${link}`);
    }
  }
  for (const link of known) if (!seen.has(link)) report("error", rel, `knownBrokenLinks 已过期：${link}`);
}

function main() {
  const known = knownBroken();
  let errors = 0;
  const report = (level, file, msg) => {
    if (level === "error") errors++;
    console.log(`${level}\t${file}\t${msg}`);
  };
  const names = fs.readdirSync(skillsDir).filter((n) => fs.existsSync(path.join(skillsDir, n, "SKILL.md")));
  for (const name of names) checkSkill(name, known.get(name) || new Set(), report);
  console.log(`checked ${names.length} skills, ${errors} errors`);
  process.exit(errors ? 1 : 0);
}

main();
