'use strict';

// ============================================================================
// L3-L6 Contract: herdr-autopilot 按模型配置启动 lane agent
// - Owns: stage → 任务类型映射、启动计划获取、launch 记录（ledger.launches[pane]）。
// - 启动参数只由 delivery-pipeline-setup 的 model_config.py（probe + resolve + start）生成；
//   本模块不拼 --kind / --model，也不提供默认 agent。
// - launch 从 herdr pane get 读取目标 pane 当前 cwd，经 model_config.py start --cwd <cwd> --pretrust
//   统一注入目录信任（agy --settings、codex -c、claude 原子预写 ~/.claude.json、pi --approve）。
// - epic / spec / tickets / pipeline 默认任务类型为 planning；bugfix 必须显式 --task。
// - register --pane 只接受经 launch 启动的 pane，且 agent 名一致；否则 fail-close。
// - agent_not_ready 时保留待就绪记录。重跑只复用同名、同 kind、同 pane 的原终端，
//   最多再等 30 秒。确认交互就绪后，register 才能消费记录。
// - probe 的 stdin 是本机网关模型清单（GET 127.0.0.1:3425/v1/models，可用
//   HERDR_AUTOPILOT_GATEWAY_MODELS 覆盖）；读取失败传 status unknown，经网关的 pi lane 随之 fail-close。
// - Depends on: model_config.py（默认 ~/.claude/skills/delivery-pipeline-setup，
//   可用 HERDR_AUTOPILOT_MODEL_CONFIG 覆盖）、python3、herdr CLI。
// ============================================================================

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const STAGE_TASK = { epic: 'planning', spec: 'planning', tickets: 'planning', pipeline: 'planning' };

function modelConfigScript(env = process.env) {
  return env.HERDR_AUTOPILOT_MODEL_CONFIG ||
    path.join(os.homedir(), '.claude', 'skills', 'delivery-pipeline-setup', 'scripts', 'model_config.py');
}

function modelRolesPath(env = process.env) {
  return env.HERDR_AUTOPILOT_MODEL_ROLES ||
    path.join(os.homedir(), '.config', 'delivery-pipeline', 'model-roles.json');
}

function resolveTask(stage, task) {
  const chosen = String(task || STAGE_TASK[stage] || '').trim();
  if (!chosen) {
    throw new Error(`stage "${stage}" 没有默认任务类型，launch 需要显式 --task <planning|design|frontend|backend|testing>`);
  }
  return chosen;
}

function runModelConfig(args, input) {
  const res = spawnSync('python3', [modelConfigScript(), ...args], { encoding: 'utf8', input, timeout: 120000 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`model_config.py ${args[0]} 失败：${(res.stdout || res.stderr).trim()}`);
  }
  return JSON.parse(res.stdout);
}

// setup 合同：probe 只信调用方交来的网关清单；不给清单，经网关的 harness（pi）能力为空。
function gatewaySource(env = process.env) {
  const url = env.HERDR_AUTOPILOT_GATEWAY_MODELS || 'http://127.0.0.1:3425/v1/models';
  const res = spawnSync('curl', ['-sf', '-m', '5', url], { encoding: 'utf8' });
  try {
    const data = res.status === 0 ? JSON.parse(res.stdout).data : null;
    if (Array.isArray(data)) return { gateway: { status: 'ok', data } };
  } catch { /* 非 JSON 视同不可达 */ }
  return { gateway: { status: 'unknown' } };
}

function readPane(session, paneId, runner) {
  try {
    const parsed = JSON.parse(runner(session, ['pane', 'get', paneId]));
    return parsed?.result?.pane || parsed?.pane || parsed;
  } catch {
    return null;
  }
}

function herdrErrorCode(error) {
  try {
    return JSON.parse(error.stderr)?.error?.code;
  } catch {
    return null;
  }
}

function notReady(agent, pane, cause) {
  return Object.assign(new Error(`agent_not_ready: agent "${agent}" 在 pane ${pane} 尚未就绪`, { cause }), {
    code: 'agent_not_ready',
  });
}

function findLaunchAgent(session, runner, pane, record) {
  let raw;
  try {
    raw = runner(session, ['agent', 'get', record.agent_name]);
  } catch (error) {
    if (herdrErrorCode(error) === 'agent_not_found') return null;
    throw error;
  }
  const live = JSON.parse(raw).result?.agent;
  if (live?.name !== record.agent_name || live.pane_id !== pane || live.agent !== record.kind ||
      (record.terminal_id && live.terminal_id !== record.terminal_id)) {
    throw new Error(`agent_name_taken: agent "${record.agent_name}" 的现场身份与 pane ${pane} 的 launch 记录不符（当前 pane ${live?.pane_id || 'Unknown'}）`);
  }
  return live;
}

function waitForLaunch(session, runner, pane, record, live) {
  if (live.interactive_ready && live.agent_status !== 'blocked') return;
  if (live.agent_status === 'blocked') throw notReady(record.agent_name, pane);
  try {
    runner(session, ['agent', 'wait', record.agent_name, '--until', 'idle', '--until', 'done', '--timeout', '30000']);
  } catch (error) {
    if (herdrErrorCode(error) !== 'timeout') throw error;
    throw notReady(record.agent_name, pane, error);
  }
  const ready = findLaunchAgent(session, runner, pane, record);
  if (!ready?.interactive_ready || ready.agent_status === 'blocked') throw notReady(record.agent_name, pane);
}

function launchDetails({ terminal_id, pending, ...details }) {
  return details;
}

// 默认 planner：实时探测能力 → 解析 work 项 → 生成 Herdr 原生启动请求（附带目录信任）。
function defaultPlanner({ task, workerName, paneId, cwd }) {
  const probe = runModelConfig(['probe'], JSON.stringify(gatewaySource()));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-autopilot-cap-'));
  const evidence = path.join(dir, 'capabilities.json');
  fs.writeFileSync(evidence, JSON.stringify(probe.capabilities));
  try {
    const common = [modelRolesPath(), task, '--evidence', evidence];
    const plan = runModelConfig(['resolve', ...common]);
    const startArgs = ['start', ...common, '--worker-name', workerName, '--pane-id', paneId];
    if (cwd) startArgs.push('--cwd', cwd, '--pretrust');
    const argv = runModelConfig(startArgs);
    return { agent: plan.agent, model: plan.model, effort: plan.effort, argv };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function launchAgent(ledger, options, { session, runner, planner = defaultPlanner, checkpoint }) {
  const { stage, task, agent, pane, cwd } = options;
  if (!pane || !agent) throw new Error('launch 需要 --pane 与 --agent');
  const resolved = resolveTask(stage, task);
  const record = ledger.launches?.[pane];
  const live = record?.agent_name === agent ? findLaunchAgent(session, runner, pane, record) : null;
  if (live) {
    waitForLaunch(session, runner, pane, record, live);
    delete record.pending;
    return { pane, ...launchDetails(record) };
  }

  const details = startLaunch({ pane, agent, cwd, resolved }, { session, runner, planner }, (pending) => {
    ledger.launches = { ...(ledger.launches || {}), [pane]: pending };
    checkpoint();
  });
  ledger.launches = { ...(ledger.launches || {}), [pane]: details };
  return { pane, ...launchDetails(details) };
}

function startLaunch({ pane, agent, cwd, resolved }, { session, runner, planner }, checkpointPending) {
  const target = readPane(session, pane, runner);
  const paneCwd = target?.foreground_cwd || target?.cwd;
  const resolvedCwd = cwd || (typeof paneCwd === 'string' ? paneCwd.trim() || null : null);
  const plan = planner({ task: resolved, workerName: agent, paneId: pane, cwd: resolvedCwd });
  if (!Array.isArray(plan.argv) || plan.argv.slice(0, 3).join(' ') !== 'herdr agent start') {
    throw new Error('启动计划不是 herdr agent start 请求');
  }
  const record = { task: resolved, agent_name: agent, kind: plan.agent, model: plan.model, effort: plan.effort,
    launched_at: new Date().toISOString(), terminal_id: target?.terminal_id };
  try {
    runner(session, plan.argv.slice(1));
  } catch (error) {
    if (herdrErrorCode(error) !== 'agent_not_ready') throw error;
    if (record.terminal_id) checkpointPending({ ...record, pending: true });
    throw notReady(agent, pane, error);
  }
  return record;
}

// register 消费 launch 记录：没有记录或 agent 名不符即拒绝登记。
function claimLaunch(ledger, pane, agent) {
  const record = ledger.launches?.[pane];
  if (!record) throw new Error(`pane ${pane} 不是经 launch 按模型配置启动的；先运行 launch`);
  if (record.agent_name !== agent) {
    throw new Error(`pane ${pane} 的 launch 记录属于 agent "${record.agent_name}"，与 --agent "${agent}" 不符`);
  }
  if (record.pending) throw new Error(`pane ${pane} 的 launch 尚未就绪；重跑 launch 后再登记`);
  delete ledger.launches[pane];
  return launchDetails(record);
}

module.exports = { STAGE_TASK, resolveTask, launchAgent, claimLaunch, defaultPlanner };
