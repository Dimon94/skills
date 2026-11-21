// 从固定的 Spec、票与例子项目走完委派、单片回交与集成验收；仅写临时仓库。
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const examples = require('./briefs.cjs');
const { prepare } = require('../../../delegate-ticket/scripts/prepare.js');
const { implement } = require('../../../implement/scripts/implement.js');

const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const [id, covers, given, when, then, source, seam] = read('spec.md').split('\n')
  .find(line => line.startsWith('| S1 |')).split('|').slice(1, -1).map(cell => cell.trim());
const scenarios = [{ id, covers: covers.split(', '), given, when, then, source, seam }];
const ticket = { id: 'TURN-1', body: read('ticket.md') };
const origin = process.cwd();
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-contract-'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const head = () => git('rev-parse', 'HEAD');
function commit(file, content) {
  fs.writeFileSync(file, content);
  git('add', '--', file);
  git('commit', '-qm', file);
  return head();
}
function run(check) {
  const result = spawnSync(check[0], check.slice(1), { encoding: 'utf8' });
  return { base: head(), check, ok: result.status === 0, observed: (result.stdout || result.stderr).trim() };
}

// 收集相互独立的回归，以便一次运行能看到全部误放行。
const unexpected = [];
function rejects(label, result, gap) {
  if (result.verdict !== 'return' || !result.gaps.some(item => item.includes(gap))) unexpected.push(label);
}
function cli(script, payload, status = 0) {
  const result = spawnSync(process.execPath, [require.resolve(script)], { input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(result.status, status, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

try {
  fs.cpSync(path.join(__dirname, 'example'), repo, { recursive: true });
  process.chdir(repo);
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  git('add', 'check.cjs', 'status.js', 'turn.js', 'results.js');
  git('commit', '-qm', '冻结 S1 入口');
  const base = head();
  const groups = examples();
  const dispatch = (slices, decisions = []) => prepare(ticket, scenarios, base, { slices, decisions });
  const single = dispatch(groups.single);
  assert.deepEqual(cli('../../../delegate-ticket/scripts/prepare.js', { ticket, scenarios, base, site: { slices: groups.single } }), single);
  assert.equal(single[0].ticket, ticket.id);
  assert.equal(single[0].base, base);
  const blocked = (dependency, dependencies = []) => prepare({ ...ticket, body: ticket.body.replace('Blocked by: None', `Blocked by: ${dependency}`) }, scenarios, base, { slices: groups.single, dependencies });
  for (const dependency of ['Unknown（依赖尚未建票）', 'TURN-0']) {
    const result = blocked(dependency);
    if (result.ticket !== ticket.id || !result.missing?.some(item => item.reason.includes(dependency))) unexpected.push(dependency);
  }
  assert.deepEqual(blocked('TURN-0', [{ ticket: 'TURN-0', commit: base }]), single);
  assert.deepEqual(blocked('无'), single);
  assert.match(dispatch(groups.missingResult).missing.map(x => x.reason).join(' '), /R1/);
  const noPrecedent = dispatch([{ ...groups.single[0], read_first: ['absent.js'] }]);
  assert.equal(noPrecedent.ticket, ticket.id);
  assert.match(noPrecedent.missing[0].reason, /absent.js/);
  const conflict = { field: 'S1', reason: '新期望要求清空第一段，与原场景矛盾', owner: '需求作者' };
  assert.deepEqual(dispatch(groups.split, [conflict]).missing, [conflict]);
  const weak = { ...ticket, body: read('ticket-missing-result.md') };
  const omission = { field: 'S1', reason: '验收句缺少停止后仍可读到第一段', owner: '拆票者' };
  assert.deepEqual(prepare(weak, scenarios, base, { slices: groups.single, decisions: [omission] }), { ticket: weak.id, missing: [omission] });
  const briefs = dispatch(groups.split);
  assert.deepEqual(briefs.map(slice => slice.slice_id), ['state', 'results']);
  const wholeCheck = ['node', 'check.cjs', 'all'];
  const scenarioChecks = [{ id, seam, expected: then, covers: ['T1', 'R1'], check: wholeCheck }];

  const [status, results] = briefs;
  assert.equal(run(status.check).ok, false);
  commit('status.js', "module.exports = () => 'stopped';\n");
  const first = cli('../../../implement/scripts/implement.js', { input: status, record: { run: run(status.check) } });
  assert.equal(first.commit, head());
  assert.deepEqual(first.gaps, []);
  assert.match(first.observed, /stopped/);
  git('checkout', '-qb', 'results', base);
  assert.equal(run(results.check).ok, false);
  commit('results.js', 'module.exports = turn => turn.results;\n');
  const second = implement(results, { run: run(results.check) });
  assert.deepEqual(second.gaps, []);
  assert.match(second.observed, /第一段/);
  git('checkout', '-qb', 'side', base);
  commit('results.js', 'module.exports = turn => [...turn.results];\n');
  const side = implement(results, { run: run(results.check) });
  assert.deepEqual(side.gaps, []);
  assert.ok(blocked('TURN-0', [{ ticket: 'TURN-0', commit: side.commit }]).missing.some(item => item.reason.includes('TURN-0')));
  git('checkout', 'results');
  git('merge', '--no-edit', first.commit);

  // 两片都绿。集成接线丢弃结果，必须重新从回合详情读回。
  const integration = fs.readFileSync('turn.js', 'utf8');
  commit('turn.js', integration.replace('stoppedResults(turn)', '[]'));
  const plan = { mmf: 'TURN', base: head(), scenarios, scenarioChecks, briefs, evidence: [first, second] };
  const whole = () => ({ ...run(wholeCheck), id: 'S1' });
  // 只模拟门禁回执。片级与场景观察均来自实际子进程和临时仓库。
  const gates = () => ['E2E', 'full', 'ablation', 'Standards', 'Spec'].map(name => ({
    name, base: head(), status: 'pass', detail: `样例回执 ${name} @ ${head()}`,
  }));
  const integrated = () => ({ observations: [whole()], gates: gates() });
  const partial = { ...run(status.check), id };
  assert.equal(partial.ok, true);
  rejects('局部命令冒充 S1', implement(plan, { observations: [partial], gates: gates() }), id);
  const bad = implement(plan, integrated());
  assert.equal(bad.verdict, 'return');
  assert.match(bad.scenarios[0].observed, /第一段/);
  assert.ok(bad.gaps.some(gap => gap.includes('S1')));

  plan.base = commit('turn.js', integration);
  const observation = whole();
  assert.equal(observation.ok, true);
  const record = { observations: [observation], gates: gates() };
  const [binding] = scenarioChecks;
  for (const [label, checks] of [['缺绑定', undefined], ['缺 R1', [{ ...binding, covers: ['T1'] }]],
    ['错入口', [{ ...binding, seam: '状态徽标' }]], ['错预期', [{ ...binding, expected: '显示已停止' }]]]) {
    rejects(label, implement({ ...plan, scenarioChecks: checks }, record), id);
  }
  rejects('已绿旁支未落入集成提交', implement({ ...plan, evidence: [first, side] }, record), results.slice_id);
  const missing = implement({ ...plan, evidence: [first] }, record);
  assert.equal(missing.verdict, 'return');
  assert.ok(missing.gaps.some(gap => gap.includes(results.slice_id)));
  assert.equal(implement(plan, { observations: [observation] }).verdict, 'return');
  const verdict = implement(plan, record);
  assert.equal(verdict.verdict, 'pass', JSON.stringify(verdict));
  assert.match(verdict.scenarios[0].observed, /stopped.*第一段/s);
  assert.equal(implement({ ...plan, briefs: [], evidence: [] }, record).verdict, 'pass');
  git('checkout', '-qb', 'picked', first.commit);
  git('cherry-pick', second.commit);
  assert.notEqual(head(), second.commit);
  const pickedPlan = { ...plan, base: head() };
  const picked = cli('../../../implement/scripts/implement.js', { input: pickedPlan, record: integrated() });
  assert.equal(picked.verdict, 'pass');
  assert.deepEqual(unexpected, [], '不应放行的输入');
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ticket, scenarios, briefs, evidence: plan.evidence, bad, verdict }, null, 2));
  else console.log('TURN-1 / S1 ok: 依赖、单片、多片、场景绑定、旁支退回、合并与 cherry-pick 落地、同入口复验');
} finally {
  process.chdir(origin);
  fs.rmSync(repo, { recursive: true, force: true });
}
