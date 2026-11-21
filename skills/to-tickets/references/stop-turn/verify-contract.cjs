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

try {
  fs.cpSync(path.join(__dirname, 'example'), repo, { recursive: true });
  process.chdir(repo);
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  git('add', 'check.cjs', 'status.js', 'turn.js', 'results.js');
  git('commit', '-qm', '冻结 S1 入口');
  const base = head();
  const groups = examples(base);
  const dispatch = (slices, decisions = []) => prepare(ticket, scenarios, base, { slices, decisions });
  assert.deepEqual(dispatch(groups.single), groups.single);
  assert.match(dispatch(groups.missingResult).missing.map(x => x.reason).join(' '), /R1/);
  const noPrecedent = dispatch([{ ...groups.single[0], read_first: ['absent.js'] }]);
  assert.equal(noPrecedent.ticket, ticket.id);
  assert.match(noPrecedent.missing[0].reason, /absent.js/);
  const conflict = { field: 'S1', reason: '新期望要求清空第一段，与原场景矛盾', owner: '需求作者' };
  assert.deepEqual(dispatch(groups.split, [conflict]).missing, [conflict]);
  const briefs = dispatch(groups.split);
  assert.deepEqual(briefs, groups.split);

  const [status, results] = briefs;
  assert.equal(run(status.check).ok, false);
  commit('status.js', "module.exports = () => 'stopped';\n");
  const first = implement(status, { run: run(status.check) });
  assert.equal(first.commit, head());
  assert.deepEqual(first.gaps, []);
  assert.match(first.observed, /stopped/);
  git('checkout', '-qb', 'results', base);
  assert.equal(run(results.check).ok, false);
  commit('results.js', 'module.exports = turn => turn.results;\n');
  const second = implement(results, { run: run(results.check) });
  assert.deepEqual(second.gaps, []);
  assert.match(second.observed, /第一段/);
  git('merge', '--no-edit', first.commit);

  // 两片都绿。集成接线丢弃结果，必须重新从回合详情读回。
  const integration = fs.readFileSync('turn.js', 'utf8');
  commit('turn.js', integration.replace('stoppedResults(turn)', '[]'));
  const plan = { mmf: 'TURN', base: head(), scenarios, briefs, evidence: [first, second] };
  const wholeCheck = groups.single[0].check;
  const whole = () => ({ ...run(wholeCheck), id: 'S1' });
  const bad = implement(plan, { observations: [whole()] });
  assert.equal(bad.verdict, 'return');
  assert.match(bad.scenarios[0].observed, /第一段/);
  assert.ok(bad.gaps.some(gap => gap.includes('S1')));

  plan.base = commit('turn.js', integration);
  const observation = whole();
  assert.equal(observation.ok, true);
  // 这里只测试回执核收。两轴输入是 code-review 的样例，不声称实际审查。
  const gates = ['E2E', 'full', 'ablation', 'Standards', 'Spec'].map(name => ({
    name, base: head(), status: 'pass', detail: `样例回执 ${name} @ ${head()}`,
  }));
  const record = { observations: [observation], gates };
  const missing = implement({ ...plan, evidence: [first] }, record);
  assert.equal(missing.verdict, 'return');
  assert.ok(missing.gaps.some(gap => gap.includes(results.slice_id)));
  assert.equal(implement(plan, { observations: [observation] }).verdict, 'return');
  const verdict = implement(plan, record);
  assert.equal(verdict.verdict, 'pass', JSON.stringify(verdict));
  assert.match(verdict.scenarios[0].observed, /stopped.*第一段/s);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ticket, scenarios, briefs, evidence: plan.evidence, bad, verdict }, null, 2));
  else console.log('TURN-1 / S1 ok: 单片、多片、缺项、收齐回执、集成丢结果退回、修复后复验');
} finally {
  process.chdir(origin);
  fs.rmSync(repo, { recursive: true, force: true });
}
