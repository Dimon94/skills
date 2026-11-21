#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/to-spec/scripts/check-spec.js
//   INPUT: 一份 Spec 草稿（Markdown 文件路径；缺省读 stdin）
//   OUTPUT: 每个问题一行 "error\t<规则>\t<说明>"，有问题退出 1；无问题打印 ok 退出 0
//   POS: to-spec 第 6 步发布前的确定性核对；只读，不改文件、不访问 tracker
//   EXPORT: checkSpec、splitSections、ids、readScenarios；to-tickets 复用后三者读取同一份 Spec
//   INPUT: 新建 Spec 用 --require-scenarios；缺省仍可读历史正文
//   TEST: node --test skills/to-spec/tests/check-spec.test.js
// L5
//   PARAM: 章节 = 模板的九个 "## " 标题，按模板顺序
//   PARAM: 阻塞边 = Dependencies 节以 Blocked by / Blocks 加冒号开头的行，值可为“无”
//   PARAM: T/R 定义 = Business Flow 节出现的 T<n>/R<n>；该节写 N/A 时可为空
//   PARAM: owner 行 = Implementation Decisions 里以 Owns/Owner/拥有 加冒号开头的行，
//          取冒号后到 Participants/参与 之前的 T/R 编号与状态 id；T1–T3 展开为区间
//   PARAM: 状态 id = Business Flow 里 `state "…" as <id>` 的 id 与 `a --> b` 两端，不含 [*]
//   FAIL: 缺章节或顺序错 → sections
//   FAIL: Dependencies 节缺 Blocked by: 或 Blocks: 行 → dependencies
//   FAIL: Business Flow 既无 T/R 也无 N/A → business-flow
//   FAIL: T/R 没有 owner 行或出现在多条 owner 行 → owner
//   FAIL: 状态 id 没有 owner 行或出现在多条 owner 行 → state
//   FAIL: T/R 未出现在 Testing Decisions → testing
//   FAIL: 其他节引用了 Business Flow 未定义的 T/R → undefined
//   FAIL: 场景表缺列、缺值、标识重复、covers 缺失或引用未定义 T/R → scenario
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
const STATE_ALIAS = /^\s*state\s+"[^"]*"\s+as\s+([^\s{]+)/;
const ARROW = /^\s*([^\s:]+)\s*-->\s*([^\s:]+)/;
const TOKEN = /[\s,，、;；:：。`*]+/;
const PATH = /(?:^|[\s(`'"])((?:src|app|lib|scripts|packages|apps)\/[\w./-]+|(?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|sql|swift|kt|vue|css))\b/gm;

// ---- 切分 ---------------------------------------------------------------
function splitSections(text, headingPrefix = '## ') {
  const out = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    if (line.startsWith(headingPrefix)) out.set((current = line.slice(headingPrefix.length).trimEnd()), []);
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


// ---- Testing Decisions 场景表 -------------------------------------------
const COLUMNS = ['id', 'covers', 'given', 'when', 'then', 'source', 'seam'];

function cells(line) {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}

function readRow(row, flow, scenarios, covered) {
  const [id, covers] = row;
  const missing = COLUMNS.filter((_, index) => !row[index]);
  if (row.length !== COLUMNS.length || missing.length) {
    return [['scenario', `场景 ${id || '（无 id）'} 行不完整：${missing.join(', ') || '列数不符'}`]];
  }
  const errors = [];
  if (scenarios.has(id)) errors.push(['scenario', `场景 ${id} 定义多次`]);
  const references = ids(covers);
  const remainder = covers.replace(RANGE, '').replace(ID, '').replace(/[,，、\s]/g, '');
  if ((!references.size || remainder) && !(covers === 'N/A' && flow.size === 0)) errors.push(['scenario', `${id} 的 covers 需要 T/R：${covers}`]);
  for (const ref of references) {
    if (!flow.has(ref)) errors.push(['scenario', `${id} 的 covers 引用未定义的 ${ref}`]);
    covered.add(ref);
  }
  scenarios.set(id, references);
  return errors;
}

// L4：从 Testing Decisions 读场景 id → covers，连同结构诊断交给两端检查器。
// 历史正文没有场景表时可读回；required 用于新草稿的发布前核对。
function readScenarios(sections, required = false) {
  const testing = sections.get('Testing Decisions') || '';
  const flow = ids(sections.get('Business Flow') || '');
  const scenarios = new Map();
  const covered = new Set();
  const errors = [];
  let present = false;
  for (const [table] of testing.matchAll(/^(?:[ \t]*\|[^\n]*(?:\n|$))+/gm)) {
    const [header, divider, ...rows] = table.trim().split('\n').map(cells);
    if (!header.includes('covers') && !['given', 'when', 'then'].every(name => header.includes(name))) continue;
    present = true;
    if (header.join() !== COLUMNS.join() || divider?.length !== COLUMNS.length || !divider.every(cell => /^:?-+:?$/.test(cell))) {
      errors.push(['scenario', `场景表需要 Markdown 表头 ${COLUMNS.join(', ')}`]);
      continue;
    }
    for (const row of rows) errors.push(...readRow(row, flow, scenarios, covered));
  }
  if (present || required) {
    if (!scenarios.size) errors.push(['scenario', 'Testing Decisions 缺少完整的场景行']);
    for (const ref of flow) if (!covered.has(ref)) errors.push(['scenario', `${ref} 没有场景覆盖`]);
  }
  return { present, scenarios, errors };
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

function states(flow) {
  const found = new Set();
  for (const line of flow.split("\n")) {
    const names = [STATE_ALIAS.exec(line)?.[1], ...(ARROW.exec(line)?.slice(1) || [])];
    for (const name of names) if (name && name !== "[*]") found.add(name);
  }
  return found;
}

// 每个 T/R 编号和每个状态 token（键加 state: 前缀）出现在几条 owner 行
function ownerCounts(decisions) {
  const counts = new Map();
  const bump = (key) => counts.set(key, (counts.get(key) || 0) + 1);
  for (const line of decisions.split("\n")) {
    const match = OWNER_LINE.exec(line);
    if (!match) continue;
    const owned = match[2].split(/Participants|参与/)[0];
    for (const id of ids(owned)) bump(id);
    for (const token of new Set(owned.split(TOKEN).filter(Boolean))) bump(`state:${token}`);
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
  for (const state of states(flow)) {
    const count = owners.get(`state:${state}`) || 0;
    if (count !== 1) errors.push(["state", `${state} 应恰好出现在一条 Owns: 行，实际 ${count} 条`]);
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

function checkSpec(text, requireScenarios = false) {
  const sections = splitSections(text);
  return [...checkSections(sections), ...checkDependencies(sections), ...checkTraceability(sections), ...readScenarios(sections, requireScenarios).errors, ...checkPaths(text)];
}

// ---- 入口 ---------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const required = args[0] === '--require-scenarios';
  const source = fs.readFileSync(args[required ? 1 : 0] || 0, 'utf8');
  const errors = checkSpec(source, required);
  for (const [rule, message] of errors) console.log(`error\t${rule}\t${message}`);
  if (errors.length === 0) console.log("ok");
  process.exitCode = errors.length ? 1 : 0;
}

module.exports = { checkSpec, splitSections, ids, readScenarios };
