#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/to-spec/scripts/check-spec.js
//   INPUT: 一份 Spec 草稿（Markdown 文件路径；缺省读 stdin）
//   OUTPUT: 每个问题一行 "error\t<规则>\t<说明>"，有问题退出 1；无问题打印 ok 退出 0
//   POS: to-spec 第 5 步发布前的确定性核对；只读，不改文件、不访问 tracker
//   EXPORT: checkSpec、splitSections、ids；to-tickets/scripts/check-tickets.js 复用后两者解析 Spec
//   TEST: node --test skills/to-spec/tests/check-spec.test.js
// L5
//   PARAM: 章节 = 模板的九个 "## " 标题，按模板顺序
//   PARAM: 阻塞边 = Dependencies 节以 Blocked by / Blocks 加冒号开头的行，值可为“无”
//   PARAM: T/R 定义 = Business Flow 节出现的 T<n>/R<n>；该节写 N/A 时可为空
//   PARAM: owner 行 = Implementation Decisions 里以 Owns/Owner/拥有 加冒号开头的行，
//          取冒号后到 Participants/参与 之前的 T/R 编号；T1–T3 展开为区间
//   FAIL: 缺章节或顺序错 → sections
//   FAIL: Dependencies 节缺 Blocked by: 或 Blocks: 行 → dependencies
//   FAIL: Business Flow 既无 T/R 也无 N/A → business-flow
//   FAIL: T/R 没有 owner 行或出现在多条 owner 行 → owner
//   FAIL: T/R 未出现在 Testing Decisions → testing
//   FAIL: 其他节引用了 Business Flow 未定义的 T/R → undefined
//   FAIL: 正文含仓库文件路径（src/… 或带源码扩展名的相对路径）→ path
// ==========================================================================
const fs = require("node:fs");

const SECTIONS = [
  "Problem Statement",
  "Solution",
  "Business Flow",
  "User Stories",
  "Implementation Decisions",
  "Testing Decisions",
  "Dependencies",
  "Out of Scope",
  "Further Notes",
];
const EDGE_LINE = /^[\s>*-]*`?\**(Blocked by|Blocks)\**`?\s*[:：]/;
const ID = /\b([TR])(\d+)\b/g;
const RANGE = /\b([TR])(\d+)\s*[–-]\s*\1?(\d+)\b/g;
const OWNER_LINE = /^[\s>*-]*\**(Owns|Owner|拥有)\**\s*[:：]\**(.*)$/;
const PATH = /(?:^|[\s(`'"])((?:src|app|lib|scripts|packages|apps)\/[\w./-]+|(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|sql|swift|kt|vue|css))\b/gm;

// ---- 切分 ---------------------------------------------------------------
function splitSections(text) {
  const out = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) out.set((current = heading[1]), []);
    else if (current) out.get(current).push(line);
  }
  return new Map([...out].map(([name, lines]) => [name, lines.join("\n")]));
}

function ids(text) {
  const found = new Set();
  for (const [, kind, from, to] of text.matchAll(RANGE))
    for (let n = Number(from); n <= Number(to); n++) found.add(kind + n);
  for (const [, kind, n] of text.matchAll(ID)) found.add(kind + Number(n));
  return found;
}


// ---- 规则 ---------------------------------------------------------------
function checkSections(sections) {
  const present = [...sections.keys()].filter((name) => SECTIONS.includes(name));
  const missing = SECTIONS.filter((name) => !sections.has(name));
  const ordered = present.join("|") === SECTIONS.filter((n) => sections.has(n)).join("|");
  return [
    ...missing.map((name) => ["sections", `缺少章节 ## ${name}`]),
    ...(ordered ? [] : [["sections", `章节顺序应为：${SECTIONS.join(" → ")}`]]),
  ];
}

function checkDependencies(sections) {
  if (!sections.has("Dependencies")) return [];
  const found = new Set(sections.get("Dependencies").split("\n").map((line) => EDGE_LINE.exec(line)?.[1]));
  return ["Blocked by", "Blocks"]
    .filter((label) => !found.has(label))
    .map((label) => ["dependencies", `Dependencies 缺少 ${label}: 行；没有边写“无”和依据`]);
}

function ownerCounts(decisions) {
  const counts = new Map();
  for (const line of decisions.split("\n")) {
    const match = OWNER_LINE.exec(line);
    if (!match) continue;
    const owned = match[2].split(/Participants|参与/)[0];
    for (const id of ids(owned)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function checkTraceability(sections) {
  const flow = sections.get("Business Flow") || "";
  const defined = ids(flow);
  if (defined.size === 0)
    return /N\/A/.test(flow) ? [] : [["business-flow", "Business Flow 既没有 T/R 编号，也没有写 N/A 和理由"]];
  const decisions = sections.get("Implementation Decisions") || "";
  const testing = ids(sections.get("Testing Decisions") || "");
  const owners = ownerCounts(decisions);
  const used = new Set([...ids(decisions), ...testing]);
  const errors = [];
  for (const id of defined) {
    const count = owners.get(id) || 0;
    if (count !== 1) errors.push(["owner", `${id} 应恰好出现在一条 Owns: 行，实际 ${count} 条`]);
    if (!testing.has(id)) errors.push(["testing", `${id} 未出现在 Testing Decisions`]);
  }
  for (const id of used)
    if (!defined.has(id)) errors.push(["undefined", `${id} 未在 Business Flow 定义`]);
  return errors;
}

function checkPaths(text) {
  const prose = text.replace(/https?:\/\/\S+/g, "");
  return [...new Set([...prose.matchAll(PATH)].map((m) => m[1]))].map((p) => [
    "path",
    `Spec 不写文件路径：${p}`,
  ]);
}

function checkSpec(text) {
  const sections = splitSections(text);
  return [...checkSections(sections), ...checkDependencies(sections), ...checkTraceability(sections), ...checkPaths(text)];
}

// ---- 入口 ---------------------------------------------------------------
if (require.main === module) {
  const source = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : fs.readFileSync(0, "utf8");
  const errors = checkSpec(source);
  for (const [rule, message] of errors) console.log(`error\t${rule}\t${message}`);
  if (errors.length === 0) console.log("ok");
  process.exitCode = errors.length ? 1 : 0;
}

module.exports = { checkSpec, splitSections, ids };
