// L3/L4  核收目标仓库的局部运行记录或集成记录。不启动开发者，不执行输入中的命令。
// L5     input 是 Brief 或 MmfPlan。record 由执行 Skill 传入，格式见 delivery-contract.md。
// L6     核对片提交已落入集成 HEAD；按观察前批准的场景检查核收同一提交上的运行和门禁。
// TEST   node skills/to-tickets/references/stop-turn/verify-contract.cjs
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual: equal } = require('node:util');

const text = value => typeof value === 'string' && value.trim() !== '';
const revision = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const command = value => Array.isArray(value) && value.length > 0 && value.every(text);
function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trimEnd() : null;
}

function sliceEvidence(brief, record, head) {
  const { ticket, slice_id, scenarios, base, check } = brief;
  const gaps = [...(record.gaps || [])];
  const run = record.run;
  const commit = head === base ? null : head;
  if (!commit) gaps.push('缺本片提交');
  if (!command(check) || !equal(check, run?.check) || run?.base !== head || run?.ok !== true || !text(run?.observed)) {
    gaps.push(`${ticket}/${slice_id} 缺当前提交上合同命令的通过记录与实际结果`);
  }
  if (!revision(base) || git('merge-base', '--is-ancestor', base, head) === null) gaps.push(`当前提交未基于 ${base}`);
  else {
    const diff = git('diff', '--no-renames', '--name-only', '-z', base, head, '--');
    if (diff === null) gaps.push('无法读取提交范围');
    else for (const file of diff.split('\0').filter(Boolean)) {
      if (!brief.writable?.includes(file)) gaps.push(`超出可写范围 ${file}`);
    }
  }
  if (git('status', '--porcelain') !== '') gaps.push('工作区有未提交内容，检查结果无法绑定到提交');
  return { ticket, slice_id, scenarios, base, commit, check, observed: run?.observed || '', gaps };
}

// 祖先关系直接证明落地。改写的提交先由 Git 筛出补丁候选，再核对路径、模式与前后 blob。
function landed(base, commit, head) {
  if (git('merge-base', '--is-ancestor', commit, head) !== null) return true;
  const pending = git('rev-list', `${base}..${commit}`, '--not', head);
  const candidates = git('rev-list', '--cherry-mark', '--right-only', '--no-merges', `${commit}...${head}`);
  if (!pending || !candidates) return false;
  const delta = sha => git('-c', 'core.quotePath=true', 'diff-tree', '--raw', '-r', '--no-commit-id', '--no-renames', '--no-abbrev', sha);
  const remaining = pending.split('\n').map(delta);
  if (remaining.some(change => !change)) return false;
  for (const line of candidates.split('\n')) {
    if (!line.startsWith('=')) continue;
    const index = remaining.indexOf(delta(line.slice(1)));
    if (index !== -1) remaining.splice(index, 1);
    if (!remaining.length) return true;
  }
  return false;
}

function collect(briefs, evidence, head, gaps) {
  const accepted = [];
  for (const brief of briefs) {
    const key = `${brief.ticket}/${brief.slice_id}`;
    const same = e => e.ticket === brief.ticket && e.slice_id === brief.slice_id;
    const matches = evidence.filter(same);
    const [e] = matches;
    if (matches.length !== 1 || briefs.filter(same).length !== 1 || e.base !== brief.base
        || !equal(e.scenarios, brief.scenarios) || !equal(e.check, brief.check) || !text(e.observed)
        || !equal(e.gaps, []) || !revision(e.commit) || e.base === e.commit
        || !revision(e.base) || git('merge-base', '--is-ancestor', e.base, e.commit) === null) {
      gaps.push(`${key} 缺少与派发合同一致的唯一通过回执`);
    } else if (!landed(e.base, e.commit, head)) {
      gaps.push(`${key} 无法证明 ${e.commit} 已落入集成提交 ${head}`);
    } else accepted.push(e);
  }
  for (const e of evidence) if (!briefs.some(b => b.ticket === e.ticket && b.slice_id === e.slice_id)) {
    gaps.push(`回执没有对应派发合同 ${e.ticket}/${e.slice_id}`);
  }
  return accepted;
}

function approvedCheck(bindings, scenario) {
  const matches = Array.isArray(bindings) ? bindings.filter(item => item?.id === scenario.id) : [];
  const [binding] = matches;
  if (matches.length !== 1 || !text(scenario.seam) || binding.seam !== scenario.seam
      || !text(scenario.then) || binding.expected !== scenario.then || !command(binding.check)
      || !Array.isArray(scenario.covers) || !Array.isArray(binding.covers)
      || !equal(new Set(binding.covers), new Set(scenario.covers))) return null;
  return binding.check;
}

function mmfVerdict(plan, record, head) {
  const { mmf, base, briefs, evidence } = plan;
  const gaps = [...(record.gaps || [])];
  const checks = [];
  if (head !== base || !revision(base) || git('status', '--porcelain') !== '') gaps.push(`请在干净的集成提交 ${base} 核验`);
  if (!plan.scenarios.length) gaps.push('缺原 Spec 场景');
  const accepted = collect(briefs, evidence, head, gaps);
  const scenarios = plan.scenarios.map(s => {
    const matches = (record.observations || []).filter(o => o.id === s.id && o.base === base);
    const [run] = matches;
    const linked = accepted.filter(e => e.scenarios.includes(s.id));
    if (briefs.length) {
      for (const id of s.covers) if (!briefs.some(b => b.scenarios.includes(s.id) && b.owns.includes(id))) {
        gaps.push(`${s.id} 缺 ${id} 的执行片`);
      }
    }
    const check = approvedCheck(plan.scenarioChecks, s);
    if (!check) gaps.push(`${s.id} 缺少在 ${s.seam} 覆盖原场景全部预期的批准检查`);
    else if (matches.length !== 1 || !equal(run?.check, check) || !text(run?.observed) || run.ok !== true) {
      gaps.push(`${s.id} 在 ${s.seam} 未证实「${s.then}」`);
    }
    const coordinates = linked.map(e => `${e.ticket}/${e.slice_id}@${e.commit}`);
    if (command(run?.check)) coordinates.push(`${base} ${JSON.stringify(run.check)}`);
    return { id: s.id, expected: s.then, observed: run?.observed || '', evidence: coordinates };
  });
  for (const name of ['E2E', 'ablation', 'full', 'Standards', 'Spec']) {
    const matches = (record.gates || []).filter(gate => gate.name === name && gate.base === base);
    const [gate] = matches;
    const exempt = ['E2E', 'ablation'].includes(name) && gate?.status === 'n/a';
    if (matches.length !== 1 || !text(gate?.detail) || !(exempt || gate.status === 'pass')) gaps.push(`${name} 缺集成基线的通过记录或有阻断项`);
    if (gate) checks.push(`${name} ${gate.status} ${gate.detail}`);
  }
  return { mmf, base, verdict: gaps.length ? 'return' : 'pass', scenarios, checks, gaps };
}

function implement(input, record = {}) {
  const head = git('rev-parse', 'HEAD');
  return 'mmf' in input ? mmfVerdict(input, record, head) : sliceEvidence(input, record, head);
}

if (require.main === module) {
  const { input, record } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const result = implement(input, record);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.gaps.length ? 1 : 0;
}
module.exports = { implement };
