#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/to-tickets/scripts/check-tickets.js
//   INPUT: argv[2] = Spec（Markdown），argv[3] = 票草稿（Markdown，每票一个 "## <id>: <标题>" 块）
//   OUTPUT: 每行 "<error|warn|info>\t<规则>\t<说明>"；有 error 退出 1，否则退出 0
//   POS: to-tickets 发布前的确定性核对；只读，不改文件、不访问 tracker
//   DEPS: ../../to-spec/scripts/check-spec.js 的 splitSections、ids
//   EXPORT: checkTickets(specText, ticketText) -> [level, rule, message][]
//   TEST: node --test skills/to-tickets/tests/check-tickets.test.js
// L5
//   PARAM: 票字段 = 块内以 Kind/Owns/Respects/Stories/Modules/Blocked by 加冒号开头的行
//   PARAM: Kind ∈ contract | behavior | structure | spike，缺省 behavior
//   PARAM: Blocked by 取值 = 票 id 列表，或 None/无
//   PARAM: Spec 侧 T/R 取自 Business Flow，User Story 编号取自 User Stories 的有序列表
//   FAIL: Spec 的 T/R 不恰好出现在一张票的 Owns → owner
//   FAIL: Owns/Respects 引用 Spec 未定义的 T/R → undefined
//   FAIL: Spec 的 User Story 没有任何票的 Stories 指向 → stories
//   FAIL: Kind 不在取值范围 → kind；同一字段行出现多次 → field
//   FAIL: behavior 票 Owns 为空 → empty
//   FAIL: 合同票多于一张、Owns 含 T、或有阻塞边 → contract
//   FAIL: 缺 Blocked by 行、引用不存在的票、或依赖成环 → edges
//   FAIL: 标题或正文出现 token 估算数字（如 95k、120k tokens）→ token
//   WARN: 同一波次两张非合同票声明同一 Module → overlap
//   INFO: waves（每波的票）、critical-path（最长依赖链）
// ==========================================================================
const fs = require("node:fs");
const { splitSections, ids } = require("../../to-spec/scripts/check-spec.js");

const FIELD = /^[\s>*-]*\**(Kind|Owns|Respects|Stories|Modules|Blocked by)\**\s*[:：]\s*(.*)$/;
const TOKEN = /\b\d+(?:\.\d+)?\s*[kK]\b|\b\d[\d,]*\s*tokens?\b/;
const NONE = /^(none|无)\b/i;
const KINDS = new Set(["contract", "behavior", "structure", "spike"]);

// ---- 解析 ---------------------------------------------------------------
function parseTicket(id, title, body) {
  const ticket = { id, title, body, kind: "behavior", owns: new Set(), respects: new Set(), stories: [], modules: [], blockedBy: null, seen: new Set(), repeated: [] };
  for (const line of body.split("\n")) {
    const match = FIELD.exec(line);
    if (!match) continue;
    if (ticket.seen.has(match[1])) ticket.repeated.push(match[1]);
    ticket.seen.add(match[1]);
    applyField(ticket, match[1], match[2].trim());
  }
  return ticket;
}

function applyField(ticket, name, value) {
  const list = () => value.split(/[,，、\s]+/).filter(Boolean);
  if (name === "Kind") ticket.kind = value.toLowerCase();
  if (name === "Owns") ticket.owns = ids(value);
  if (name === "Respects") ticket.respects = ids(value);
  if (name === "Stories") ticket.stories = list().map(Number).filter(Number.isInteger);
  if (name === "Modules") ticket.modules = list();
  if (name === "Blocked by") ticket.blockedBy = NONE.test(value) ? [] : list();
}

function parseTickets(text) {
  const tickets = [];
  for (const [heading, body] of splitSections(text)) {
    const match = /^(\S+?)[:：]\s*(.*)$/.exec(heading);
    if (match) tickets.push(parseTicket(match[1], match[2], body));
  }
  return tickets;
}

function specItems(text) {
  const sections = splitSections(text);
  const stories = [...(sections.get("User Stories") || "").matchAll(/^\s*(\d+)\./gm)].map((m) => Number(m[1]));
  return { flow: ids(sections.get("Business Flow") || ""), stories };
}

// ---- 覆盖 ---------------------------------------------------------------
function checkCoverage(spec, tickets) {
  const errors = [];
  for (const id of spec.flow) {
    const owners = tickets.filter((t) => t.owns.has(id)).map((t) => t.id);
    if (owners.length !== 1) errors.push(["error", "owner", `${id} 应恰有一张票 Owns，实际 ${owners.length}：${owners.join(", ") || "无"}`]);
  }
  for (const t of tickets)
    for (const id of [...t.owns, ...t.respects])
      if (!spec.flow.has(id)) errors.push(["error", "undefined", `${t.id} 引用了 Spec 未定义的 ${id}`]);
  const told = new Set(tickets.flatMap((t) => t.stories));
  for (const n of spec.stories) if (!told.has(n)) errors.push(["error", "stories", `User Story ${n} 没有票指向`]);
  return errors;
}

function checkFields(tickets) {
  const errors = [];
  for (const t of tickets) {
    if (!KINDS.has(t.kind)) errors.push(["error", "kind", `${t.id} 的 Kind「${t.kind}」不在 contract|behavior|structure|spike 内`]);
    for (const name of new Set(t.repeated)) errors.push(["error", "field", `${t.id} 的 ${name} 行出现多次；票面每个字段只写一行`]);
  }
  return errors;
}

function checkKinds(tickets) {
  const errors = tickets
    .filter((t) => t.kind === "behavior" && t.owns.size === 0)
    .map((t) => ["error", "empty", `${t.id} 是行为票却不负责任何 T/R；并入相邻票或改为 structure/spike`]);
  const contracts = tickets.filter((t) => t.kind === "contract");
  if (contracts.length > 1) errors.push(["error", "contract", `合同票只能有一张，实际 ${contracts.map((t) => t.id).join(", ")}`]);
  for (const c of contracts) {
    if ([...c.owns].some((id) => id.startsWith("T"))) errors.push(["error", "contract", `${c.id} 合同票不能负责行为 T`]);
    if (c.blockedBy?.length) errors.push(["error", "contract", `${c.id} 合同票不能有阻塞边`]);
  }
  return errors;
}

function checkTokens(tickets) {
  return tickets
    .filter((t) => TOKEN.test(`${t.title}\n${t.body}`))
    .map((t) => ["error", "token", `${t.id} 票面出现 token 估算数字；估算只留在规划侧`]);
}

// ---- 依赖图 -------------------------------------------------------------
function checkEdges(tickets) {
  const known = new Set(tickets.map((t) => t.id));
  const errors = [];
  for (const t of tickets) {
    if (t.blockedBy === null) errors.push(["error", "edges", `${t.id} 缺 Blocked by: 行；没有阻塞写 None`]);
    for (const dep of t.blockedBy || [])
      if (!known.has(dep)) errors.push(["error", "edges", `${t.id} 的阻塞票 ${dep} 不存在`]);
  }
  return errors;
}

// 返回 { level: Map<id, 波次>, cyclic: id[] }；波次 = 最长前驱链长度 + 1
function layer(tickets) {
  const deps = new Map(tickets.map((t) => [t.id, (t.blockedBy || []).filter((d) => tickets.some((x) => x.id === d))]));
  const level = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, ds] of deps) {
      if (level.has(id) || !ds.every((d) => level.has(d))) continue;
      level.set(id, 1 + Math.max(0, ...ds.map((d) => level.get(d))));
      changed = true;
    }
  }
  return { level, deps, cyclic: [...deps.keys()].filter((id) => !level.has(id)) };
}

function criticalPath({ level, deps }) {
  let id = [...level.keys()].sort((a, b) => level.get(b) - level.get(a))[0];
  const path = [];
  while (id) {
    path.unshift(id);
    id = deps.get(id).find((d) => level.get(d) === level.get(id) - 1);
  }
  return path;
}

function report(tickets) {
  const graph = layer(tickets);
  if (graph.cyclic.length) return [["error", "edges", `依赖成环或挂在环上：${graph.cyclic.join(", ")}`]];
  const waves = [];
  for (const [id, n] of graph.level) (waves[n - 1] ||= []).push(id);
  return [
    ["info", "waves", waves.map((w, i) => `${i + 1}:${w.join(",")}`).join("  ")],
    ["info", "critical-path", `${criticalPath(graph).join(" → ")}（${waves.length} 波）`],
    ...overlaps(tickets, waves),
  ];
}

function overlaps(tickets, waves) {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const warnings = [];
  waves.forEach((wave, i) => {
    const holders = new Map();
    for (const t of wave.map((id) => byId.get(id)).filter((t) => t.kind !== "contract"))
      for (const m of t.modules) holders.set(m, [...(holders.get(m) || []), t.id]);
    for (const [m, ts] of holders)
      if (ts.length > 1) warnings.push(["warn", "overlap", `第 ${i + 1} 波 ${ts.join(", ")} 都改 ${m}；把共享部分前移到合同票`]);
  });
  return warnings;
}

// ---- 入口 ---------------------------------------------------------------
function checkTickets(specText, ticketText) {
  const spec = specItems(specText);
  const tickets = parseTickets(ticketText);
  if (tickets.length === 0) return [["error", "edges", "票草稿里没有 \"## <id>: <标题>\" 块"]];
  const errors = [...checkCoverage(spec, tickets), ...checkFields(tickets), ...checkKinds(tickets), ...checkTokens(tickets), ...checkEdges(tickets)];
  return [...errors, ...report(tickets)];
}

if (require.main === module) {
  const [specPath, ticketPath] = process.argv.slice(2);
  if (!specPath || !ticketPath) {
    console.error("usage: check-tickets.js <spec.md> <tickets.md>");
    process.exit(2);
  }
  const lines = checkTickets(fs.readFileSync(specPath, "utf8"), fs.readFileSync(ticketPath, "utf8"));
  for (const line of lines) console.log(line.join("\t"));
  process.exitCode = lines.some(([level]) => level === "error") ? 1 : 0;
}

module.exports = { checkTickets };
