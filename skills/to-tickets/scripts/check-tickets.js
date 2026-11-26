#!/usr/bin/env node
// ==========================================================================
// L3
//   COORD: skills/to-tickets/scripts/check-tickets.js
//   INPUT: [--require-scenarios] [--preview <锁定版 JSON>] <Spec Markdown> <票草稿 Markdown>
//   OUTPUT: 每行 "<error|warn|info>\t<规则>\t<说明>"；有 error 退出 1，否则退出 0
//   POS: to-tickets 发布前的确定性核对；只读，不改文件、不访问 tracker
//   DEPS: check-spec.js 的 splitSections、ids、readScenarios、readPreviewLock；spec-preview 的 changeItems
//   EXPORT: checkTickets(specText, ticketText, requireScenarios?, previewBytes?) -> [level, rule, message][]
//   EXPORT: parseTicket、ticketFindings、readScenarioContract、isUnknownDependency 供派发入口读回同一份票面合同
//   TEST: node --test skills/to-tickets/tests/check-tickets.test.js
// L4
//   INVARIANT: 核对预览时，每个改动项恰好由一张已列出的票认领。
// L5
//   PARAM: 票字段 = 每个块首个 ### 小节之前，以 Kind/Owns/Respects/Stories/Modules/Blocked by 加冒号开头的行，字段名忽略大小写
//   PARAM: 字段名或字段名连冒号可用 Markdown 加粗；正文同名行不作字段，仍检查 token 数字
//   PARAM: Kind ∈ contract | behavior | structure | spike，缺省 behavior
//   PARAM: Blocked by 取值 = 票 id 列表、None/无，或 Unknown（非空原因）
//   PARAM: Spec 侧 T/R 取自 Business Flow，User Story 编号取自 User Stories 的有序列表
//   FAIL: Spec 的 T/R 不恰好出现在一张行为票的 Owns → owner
//   FAIL: Owns/Respects 引用 Spec 未定义的 T/R → undefined
//   FAIL: 场景表、What to build 的场景或接口字段、验收小节的场景与 T/R 覆盖有缺口 → scenario
//   PARAM: 没有场景表与场景字段的历史输入沿原规则读回；新草稿用 --require-scenarios
//   PARAM: --preview 启用票头 Preview 字段，改动项 id 用逗号、顿号或空白分隔。
//   FAIL: 锁缺失或 JSON 字节哈希、版本不符 → preview-lock
//   FAIL: 漏认领、跨票重复或认领未知改动项 → preview-uncovered、preview-duplicate、preview-unknown
//   FAIL: Spec 的 User Story 没有任何票的 Stories 指向 → stories
//   FAIL: Kind 不在取值范围 → kind；同一字段行出现多次 → field
//   FAIL: behavior 票 Owns 为空 → empty
//   FAIL: 合同票多于一张、Owns 含 T/R 或有阻塞边 → contract；structure/spike 认领 T/R → owner
//   FAIL: 缺 Blocked by 行、引用不存在的票 id、或依赖成环 → edges
//   FAIL: 标题或正文出现 token 估算数字（如 95k、120k tokens）→ token
//   WARN: Blocked by 为 Unknown（原因）→ edges；本票及下游不可派发，不参与波次与关键路径
//   WARN: 同一波次两张非合同票声明同一 Module → overlap
//   INFO: waves（每波的票）、critical-path（最长依赖链）
// L6
//   CHAIN: 先核验 Spec 的锁与 JSON，再检查票面及改动项归属。锁不符时停止核对。
// ==========================================================================
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { splitSections, ids, readScenarios, readPreviewLock } = require("../../to-spec/scripts/check-spec.js");
const { changeItems } = require("../../spec-preview/lib/change-items.cjs");

const fieldNames = ['Kind', 'Owns', 'Respects', 'Stories', 'Modules', 'Blocked by'];
const previewFields = [...fieldNames, 'Preview'];
const FIELD = /^[\s>*-]*\**([a-z ]+?)\**\s*[:：]\**\s*(.*)$/i;
const TOKEN = /\b\d+(?:\.\d+)?\s*[kK]\b|\b\d[\d,]*\s*tokens?\b/;
const NONE = /^(none|无)$/i;
const isUnknownDependency = value => /^Unknown（[^）]+）$/i.test(value);
const KINDS = new Set(["contract", "behavior", "structure", "spike"]);

// ---- 解析 ---------------------------------------------------------------
function parseTicket(id, title, body, includePreview = false) {
  const ticket = { id, title, body, kind: "behavior", owns: new Set(), respects: new Set(), stories: [], modules: [], blockedBy: null, seen: new Set(), repeated: [] };
  const fields = includePreview ? previewFields : fieldNames;
  for (const line of body.split("\n")) {
    if (/^###(?:\s|$)/.test(line)) break;
    const match = FIELD.exec(line);
    if (!match) continue;
    const name = fields.find(field => field.toLowerCase() === match[1].toLowerCase());
    if (!name) continue;
    if (ticket.seen.has(name)) ticket.repeated.push(name);
    ticket.seen.add(name);
    applyField(ticket, name, match[2].trim());
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
  if (name === "Preview") ticket.preview = new Set(list());
  if (name === "Blocked by") ticket.blockedBy = NONE.test(value) ? [] : isUnknownDependency(value) ? [value] : value ? list() : null;
}

function parseTickets(text, includePreview) {
  const tickets = [];
  for (const [heading, body] of splitSections(text)) {
    const match = /^(\S+?)[:：]\s*(.*)$/.exec(heading);
    if (match) tickets.push(parseTicket(match[1], match[2], body, includePreview));
  }
  return tickets;
}

function specItems(sections, required) {
  const stories = [...(sections.get("User Stories") || "").matchAll(/^\s*(\d+)\./gm)].map((m) => Number(m[1]));
  return { flow: ids(sections.get("Business Flow") || ""), stories, ...readScenarios(sections, required) };
}

// ---- 覆盖 ---------------------------------------------------------------
function checkCoverage(spec, tickets) {
  const errors = [];
  for (const id of spec.flow) {
    const owners = tickets.filter((t) => t.kind === "behavior" && t.owns.has(id)).map((t) => t.id);
    if (owners.length !== 1) errors.push(["error", "owner", `${id} 应恰有一张行为票 Owns，实际 ${owners.length}：${owners.join(", ") || "无"}`]);
  }
  for (const t of tickets)
    for (const id of [...t.owns, ...t.respects])
      if (!spec.flow.has(id)) errors.push(["error", "undefined", `${t.id} 引用了 Spec 未定义的 ${id}`]);
  const told = new Set(tickets.flatMap((t) => t.stories));
  for (const n of spec.stories) if (!told.has(n)) errors.push(["error", "stories", `User Story ${n} 没有票指向`]);
  return errors;
}

function lockedPreview(bytes, lock) {
  if (!lock || createHash('sha256').update(bytes).digest('hex') !== lock.sha256) return;
  let spec;
  try {
    spec = JSON.parse(bytes);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return;
  }
  if (spec?.version === lock.version) return spec;
}

function checkPreviewCoverage(preview, tickets) {
  const owners = new Map(changeItems(preview).map(({ id }) => [id, new Set()]));
  const errors = [];
  for (const ticket of tickets) {
    for (const id of ticket.preview ?? []) {
      const holders = owners.get(id);
      if (holders) holders.add(ticket.id);
      else errors.push(['error', 'preview-unknown', `${id} 不在锁定预览中。请修正 ${ticket.id} 的 Preview 字段。`]);
    }
  }
  for (const [id, holders] of owners) {
    if (!holders.size) errors.push(['error', 'preview-uncovered', `${id} 无票认领。请分配给一张票。`]);
    if (holders.size > 1) errors.push(['error', 'preview-duplicate', `${id} 被 ${[...holders].join(', ')} 认领。请只保留一张责任票。`]);
  }
  return errors;
}

// ---- 实施合同 -----------------------------------------------------------
function scenarioFields(build, issue) {
  const fields = new Map();
  for (const line of build.split('\n')) {
    const field = /^[\s>*-]*\**(Scenarios|Interface|Ensures)\**\s*[:：]\**\s*(.*)$/.exec(line);
    if (!field) continue;
    if (fields.has(field[1])) issue(field[1], `${field[1]} 重复`);
    fields.set(field[1], field[2].trim());
  }
  return fields;
}

function readScenarioContract(ticket, scenarios, required) {
  const references = new Set();
  const missing = [];
  const issue = (field, reason) => missing.push({ field, reason });
  const sections = splitSections(ticket.body, '### ');
  const fields = scenarioFields(sections.get('What to build') || '', issue);
  const declaration = fields.get('Scenarios') || '';
  const noScenario = KINDS.has(ticket.kind) && ticket.kind !== 'behavior' && /^N\/A\s*(?:（[^）]+）|\([^)]+\))$/.test(declaration);
  if ((!required && !fields.has('Scenarios')) || noScenario) return { references, missing };
  for (const id of declaration.split(/[,，、\s]+/).filter(Boolean)) {
    references.add(id);
    if (!scenarios.has(id)) issue('Scenarios', `Scenarios 引用了未定义的场景 ${id}`);
  }
  if (!references.size) issue('Scenarios', 'What to build 缺 Scenarios');
  if (ticket.kind === 'behavior') {
    for (const name of ['Interface', 'Ensures']) if (!fields.get(name)) issue(name, `What to build 缺 ${name}`);
    checkAcceptance(ticket, sections.get('Acceptance criteria') || '', scenarios, references,
      reason => issue('Acceptance criteria', reason));
  }
  return { references, missing };
}

function checkAcceptance(ticket, acceptance, scenarios, references, issue) {
  const criteria = acceptance.split(/^\s*[-*]\s+\[[ xX]\]\s*/m).slice(1);
  for (const item of criteria) {
    const cited = item.match(/^([^\s（(：:]+)\s*[（(]/)?.[1];
    if (cited && !references.has(cited)) issue(`验收项引用了 Scenarios 中没有的 ${cited}`);
  }
  for (const [id, covers] of scenarios) {
    const owns = [...covers].filter(ref => ticket.owns.has(ref));
    if (!references.has(id)) {
      if (owns.length) issue(`本票负责 ${owns.join(', ')}，缺少场景 ${id}`);
      continue;
    }
    const matches = criteria.filter(item => item.split(/[\s（()），,、：:。;；`]+/).includes(id));
    if (!matches.length) issue(`验收项缺少场景 ${id}`);
    const tested = ids(matches.join('\n'));
    for (const ref of owns) if (!tested.has(ref)) issue(`场景 ${id} 的验收项缺少 ${ref}`);
  }
}

// L4：对照 Spec 场景、票级 Owns 与验收项检查引用。自然语言结果由发布前对账裁决。
function checkScenarioContracts(spec, tickets, required) {
  const referenced = new Set();
  const errors = spec.errors.map(([rule, message]) => ['error', rule, message]);
  for (const ticket of tickets) {
    const { references, missing } = readScenarioContract(ticket, spec.scenarios, required);
    for (const id of references) referenced.add(id);
    for (const item of missing) errors.push(['error', 'scenario', `${ticket.id}：${item.reason}`]);
  }
  for (const id of spec.scenarios.keys()) {
    if (required && !referenced.has(id)) errors.push(['error', 'scenario', `场景 ${id} 没有票引用`]);
  }
  return errors;
}

// L4：规划与派发共用单票判定。跨票的归属数量和依赖图留在规划侧。
function ticketFindings(ticket) {
  const { kind, owns, repeated, blockedBy } = ticket;
  const findings = [];
  const issue = (rule, field, reason) => findings.push({ rule, field, reason });
  for (const field of new Set(repeated)) issue('field', field, `${field} 行出现多次；票面每个字段只写一行`);
  if (!KINDS.has(kind)) issue('kind', 'Kind', `Kind「${kind}」不在 contract|behavior|structure|spike 内`);
  else if (kind === 'behavior' && !owns.size) issue('empty', 'owns', '行为票缺少 Owns；请分配本票实现的 T/R');
  else if (kind !== 'behavior' && owns.size) {
    issue(kind === 'contract' ? 'contract' : 'owner', 'owns', `请把 ${kind} 票的 ${[...owns].join(', ')} 分给实现它的行为票，遵守的规则写 Respects`);
  }
  if (kind === 'contract' && blockedBy?.length) issue('contract', 'Blocked by', '合同票不能有阻塞边');
  return findings;
}

function checkKinds(tickets) {
  const errors = tickets.flatMap(t => ticketFindings(t).map(({ rule, reason }) => ['error', rule, `${t.id}：${reason}`]));
  const contracts = tickets.filter((t) => t.kind === "contract");
  if (contracts.length > 1) errors.push(["error", "contract", `合同票只能有一张，实际 ${contracts.map((t) => t.id).join(", ")}`]);
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
      if (isUnknownDependency(dep)) errors.push(["warn", "edges", `${t.id} 的阻塞票为 ${dep}；本票及下游不可派发，不计入波次；创建依赖票后填入票 id`]);
      else if (!known.has(dep)) errors.push(["error", "edges", `${t.id} 的阻塞票 ${dep} 不存在`]);
  }
  return errors;
}

// 波次 = 最长前驱链长度 + 1；保留 Unknown 前驱时，无层级的票也可能是待建票阻塞。
function layer(tickets, includeUnknown = false) {
  const deps = new Map(tickets.map((t) => [t.id, (t.blockedBy || []).filter((d) => (includeUnknown && isUnknownDependency(d)) || tickets.some((x) => x.id === d))]));
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
  let graph = layer(tickets);
  if (graph.cyclic.length) return [["error", "edges", `依赖成环或挂在环上：${graph.cyclic.join(", ")}`]];
  // 先检查真实依赖环，再保留 Unknown 前驱阻止本票及下游进入波次。
  graph = layer(tickets, true);
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
function checkTickets(specText, ticketText, requireScenarios = false, previewBytes) {
  const sections = splitSections(specText);
  const preview = previewBytes === undefined ? undefined : lockedPreview(previewBytes, readPreviewLock(sections));
  if (previewBytes !== undefined && !preview) {
    return [['error', 'preview-lock', 'Spec Dependencies 缺少有效锁定行，或 JSON 的版本、SHA-256 与锁定行不一致。请核对锁定版。']];
  }
  const spec = specItems(sections, requireScenarios);
  const tickets = parseTickets(ticketText, Boolean(preview));
  if (tickets.length === 0) return [["error", "edges", "票草稿里没有 \"## <id>: <标题>\" 块"]];
  const errors = [...checkCoverage(spec, tickets), ...checkScenarioContracts(spec, tickets, requireScenarios), ...checkKinds(tickets), ...checkTokens(tickets), ...checkEdges(tickets)];
  if (preview) errors.push(...checkPreviewCoverage(preview, tickets));
  return [...errors, ...report(tickets)];
}

function main(args) {
  let required = false;
  let previewPath;
  while (args[0] === '--require-scenarios' || args[0] === '--preview') {
    if (args.shift() === '--require-scenarios') required = true;
    else previewPath = args.shift() ?? '';
  }
  const [specPath, ticketPath] = args;
  if (!specPath || !ticketPath || previewPath === '' || previewPath?.startsWith('--')) {
    console.error("usage: check-tickets.js [--require-scenarios] [--preview <spec-vN.json>] <spec.md> <tickets.md>");
    return 2;
  }
  let previewBytes;
  if (previewPath) {
    try {
      previewBytes = fs.readFileSync(previewPath);
    } catch (error) {
      if (!error.code) throw error;
      console.log(`error\tpreview-lock\t无法读取 ${previewPath}（${error.code}）。请传入锁定版 JSON 路径。`);
      return 1;
    }
  }
  const lines = checkTickets(fs.readFileSync(specPath, "utf8"), fs.readFileSync(ticketPath, "utf8"), required, previewBytes);
  for (const line of lines) console.log(line.join("\t"));
  return lines.some(([level]) => level === "error") ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { checkTickets, parseTicket, ticketFindings, readScenarioContract, isUnknownDependency };
