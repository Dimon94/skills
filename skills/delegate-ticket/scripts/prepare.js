// L3/L4  技术负责人补现场，prepare 把现场与原票绑定。只读目标仓库，不执行合同中的命令。
// L5     cwd = 目标仓库根。site 携带草案、语义缺项和已满足依赖的集成提交。
// L6     按规划侧票面规则核对场景与承诺，再核对范围与合计覆盖。补齐后以原票号重跑。
// TEST   node skills/to-tickets/references/stop-turn/verify-contract.cjs
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseTicket, readScenarioContract, isUnknownDependency } = require('../../to-tickets/scripts/check-tickets.js');

const text = value => typeof value === 'string' && value.trim() !== '';
const strings = value => Array.isArray(value) && value.every(text);
const listed = value => strings(value) && value.length > 0;
const relativeFile = file => text(file) && !path.isAbsolute(file) && !/[\\\x00]/u.test(file)
  && file.split('/').every(part => part && !['.', '..', '.git'].includes(part));

const revision = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
function atRevision(base, args) {
  if (!revision(base)) return false;
  return spawnSync('git', args, { encoding: 'utf8' }).status === 0;
}

function prepare(ticket, scenarios, base, site = {}) {
  const missing = [];
  const lack = (field, reason, owner = '技术负责人') => missing.push({ field, reason, owner });
  const body = ticket?.body || '';
  const parsed = parseTicket(ticket?.id, '', body);
  const { kind, owns, blockedBy, repeated } = parsed;
  if (blockedBy === null || repeated.includes('Blocked by')) lack('Blocked by', '请在原票确认唯一的依赖字段；无依赖写 None', '拆票者');
  for (const dep of blockedBy || []) {
    if (isUnknownDependency(dep)) lack('Blocked by', `请先在原票确定 ${dep} 的票号`, '拆票者');
    else if (dep === ticket.id || !revision(base) || !site.dependencies?.some(item => item?.ticket === dep
      && atRevision(item.commit, ['merge-base', '--is-ancestor', item.commit, base]))) {
      lack('Blocked by', `${dep} 缺派发基线已包含其交付的提交证据`);
    }
  }
  const known = new Map((scenarios || []).map(s => [s.id, s]));
  const coverage = new Map([...known].map(([id, s]) => [id, Array.isArray(s.covers) ? s.covers : []]));
  const { references, missing: contractGaps } = readScenarioContract(parsed, coverage, true);
  for (const item of contractGaps) lack(item.field, item.reason, '拆票者');
  const noFlow = ['contract', 'structure', 'spike'].includes(kind) && !owns.size && !parsed.respects.size
    && [...coverage.values()].every(refs => !refs.length);
  if (!text(ticket?.id) || !text(body)) lack('ticket', '补原票号和读回的票面');
  if (kind === 'behavior' && !owns.size) lack('owns', '行为票缺少 Owns', '拆票者');
  for (const id of references) {
    const scenario = known.get(id);
    if (!scenario) continue; // 未定义的引用已由票面检查指出。
    if (!strings(scenario.covers) || !scenario.covers.every(ref => /^[TR]\d+$/.test(ref)) || (!noFlow && !scenario.covers.length)) {
      lack('covers', `${id} 需列出 T/R；无业务流的保持场景可写空数组`, '需求作者');
    }
    for (const key of ['given', 'when', 'then', 'source', 'seam']) {
      if (!text(scenario[key])) lack(key, `${id} 缺 ${key}`, '需求作者');
    }
  }
  if (kind === 'behavior') {
    const covered = new Set([...references].flatMap(id => coverage.get(id) || []));
    for (const id of owns) if (!covered.has(id)) lack('owns', `${id} 缺负责的场景`, '拆票者');
  }
  if (!atRevision(base, ['cat-file', '-e', `${base}^{commit}`])) lack('base', `无法读取基线提交 ${base}`);
  for (const item of site.decisions || []) {
    if (['field', 'reason', 'owner'].every(key => text(item?.[key]))) missing.push(item);
    else lack('decisions', '指出原合同的具体缺项、原因和决定者');
  }
  if (!Array.isArray(site.slices) || site.slices.length === 0) lack('slices', '按票面补一份现场草案；独立可验收时可拆多份');
  if (missing.length) return { ticket: ticket?.id, missing };

  const slices = [];
  const writes = new Set();
  const covered = new Set();
  for (const draft of site.slices) {
    const slice = { ...draft, ticket: ticket.id, base };
    for (const key of ['slice_id', 'title', 'goal', 'expected']) {
      if (!text(slice[key])) lack(key, `${slice.slice_id || ticket.id} 缺 ${key}`);
    }
    if (slices.some(s => s.slice_id === slice.slice_id)) lack('slice_id', `片标识重复 ${slice.slice_id}`);
    if (!strings(slice.exclusions)) lack('exclusions', `${slice.slice_id} 需说明范围边界`);
    if (!listed(slice.check)) lack('check', `${slice.slice_id} 缺验收命令参数`);
    if (!listed(slice.read_first)) lack('read_first', `${slice.slice_id} 缺先例`);
    else for (const file of slice.read_first) {
      if (!relativeFile(file) || !atRevision(base, ['cat-file', '-e', `${base}:${file}`])) lack('read_first', `${base} 缺先例 ${file}`);
    }
    if (!listed(slice.writable)) lack('writable', `${slice.slice_id} 缺可写文件`);
    else for (const file of slice.writable) {
      if (!relativeFile(file) || writes.has(file)) lack('writable', `${file} 路径无效或写入重叠；先集中共享改动再派发`);
      writes.add(file);
    }
    if (!strings(slice.scenarios) || slice.scenarios.some(id => !references.has(id)) || (references.size && !slice.scenarios.length)) {
      lack('scenarios', `${slice.slice_id} 应引用父票场景 ${[...references].join(', ')}`);
    }
    if (!strings(slice.owns) || slice.owns.some(id => !owns.has(id))) lack('owns', `${slice.slice_id} 超出父票归属`);
    else slice.owns.forEach(id => covered.add(id));
    slices.push(slice);
  }
  for (const id of owns) if (!covered.has(id)) lack('owns', `所有执行片均未覆盖 ${id}`);
  for (const id of references) if (!slices.some(s => s.scenarios?.includes(id))) lack('scenarios', `所有执行片均未覆盖 ${id}`);
  return missing.length ? { ticket: ticket.id, missing } : slices;
}

if (require.main === module) {
  const { ticket, scenarios, base, site } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const result = prepare(ticket, scenarios, base, site);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = Array.isArray(result) ? 0 : 1;
}
module.exports = { prepare };
