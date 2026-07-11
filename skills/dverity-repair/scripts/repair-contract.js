function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function outputIncludes(evidence, symptom) {
  return `${evidence?.stdout || ''}\n${evidence?.stderr || ''}`.includes(symptom);
}

function redEvidence(evidence, symptom) {
  return Number.isInteger(evidence?.exit_code)
    && evidence.exit_code !== 0
    && hasText(evidence.command)
    && outputIncludes(evidence, symptom);
}

function greenEvidence(evidence) {
  return evidence?.exit_code === 0 && hasText(evidence.command);
}

function validateReproduction(packet, errors) {
  const original = packet.reproduction?.original_red;
  const minimized = packet.reproduction?.minimized_red;
  const rate = minimized?.reproduction_rate;
  const validRate = typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1;
  const usefulRate = minimized?.deterministic === true ? rate === 1 : rate >= 0.5;
  if (!redEvidence(original, packet.symptom)) errors.push('original symptom is not red');
  if (!redEvidence(minimized, packet.symptom)) errors.push('minimized symptom is not red');
  if (!minimized?.load_bearing) errors.push('minimal reproduction is not load-bearing');
  if (!validRate || !usefulRate) {
    errors.push('reproduction is not deterministic enough');
  }
}

function hypothesisComplete(hypothesis) {
  if (!hypothesis || typeof hypothesis !== 'object') return false;
  const confirmationPlanned = hasText(hypothesis.confirm_test?.command)
    || hasText(hypothesis.missing_confirmation);
  return hasText(hypothesis.id)
    && hasText(hypothesis.cause)
    && hasText(hypothesis.observed_result)
    && hasText(hypothesis.abductive_ece)
    && hasText(hypothesis.next_check)
    && hasText(hypothesis.evidence)
    && hasText(hypothesis.kill_probe?.prediction)
    && hasText(hypothesis.kill_probe?.command)
    && hasText(hypothesis.kill_probe?.observed)
    && confirmationPlanned;
}

function validateBoardShape(packet, errors) {
  const board = Array.isArray(packet.hypothesis_board) ? packet.hypothesis_board : [];
  if (board.length === 0) return errors.push('hypothesis board is missing');
  if (board.length === 1 && !hasText(packet.single_candidate_reason)) {
    errors.push('single hypothesis requires a non-fabrication reason');
  }
  if (board.length === 2 || board.length > 5) errors.push('hypothesis board must contain 3-5 candidates');
  if (board.some((hypothesis) => !hypothesisComplete(hypothesis))) {
    errors.push('hypothesis evidence is incomplete');
  }
  if (board.some((hypothesis) => ![
    'conjectured', 'standing', 'corroborated', 'confirmed', 'refuted'
  ].includes(hypothesis?.rung))) {
    errors.push('hypothesis rung is invalid');
  }
}

function validateTrust(packet, errors) {
  const board = Array.isArray(packet.hypothesis_board) ? packet.hypothesis_board : [];
  validateBoardTrust(board, errors);
  const active = board.find((hypothesis) => hypothesis?.rung === 'confirmed')
    || board.find((hypothesis) => hypothesis?.rung === 'corroborated');
  if (!active) return errors.push('no confirmed or probable cause');
  if (active.rung === 'confirmed') validateConfirmed(active, packet, errors);
  if (active.rung === 'corroborated') validateProbable(active, packet, errors);
}

function executedProbe(probe) {
  return hasText(probe?.command) && hasText(probe?.observed) && probe?.exit_code === 0;
}

function observedProbe(probe) {
  return hasText(probe?.command)
    && hasText(probe?.observed)
    && Number.isInteger(probe?.exit_code);
}

function validateBoardTrust(board, errors) {
  for (const hypothesis of board.filter((row) => row && typeof row === 'object')) {
    if (hypothesis.rung === 'refuted') validateRefuted(hypothesis, errors);
    if (hypothesis.rung === 'standing') validateStanding(hypothesis, errors);
    if (['corroborated', 'confirmed'].includes(hypothesis.rung)) {
      validateKillAndCorroboration(hypothesis, errors);
    }
    if (['conjectured', 'standing', 'corroborated'].includes(hypothesis.rung)) {
      validateUnconfirmed(hypothesis, errors);
    }
    if (hypothesis.rung === 'confirmed') validateConfirmProbe(hypothesis, errors);
  }
}

function validateUnconfirmed(hypothesis, errors) {
  if (hypothesis.confirm_test?.result === 'confirmed') {
    errors.push(`${hypothesis.id || 'hypothesis'} has evidence above its rung`);
  }
}

function validateRefuted(hypothesis, errors) {
  if (hypothesis.kill_probe?.result !== 'refuted'
    || !observedProbe(hypothesis.kill_probe)
    || hypothesis.confirm_test?.result === 'confirmed') {
    errors.push(`${hypothesis.id || 'hypothesis'} lacks a killing fact`);
  }
}

function validateStanding(hypothesis, errors) {
  if (hypothesis.kill_probe?.result !== 'survived'
    || !executedProbe(hypothesis.kill_probe)) {
    errors.push(`${hypothesis.id || 'hypothesis'} has invalid standing evidence`);
  }
}

function validateKillAndCorroboration(hypothesis, errors) {
  if (hypothesis.kill_probe?.result !== 'survived' || !executedProbe(hypothesis.kill_probe)) {
    errors.push('disconfirming kill probe did not survive');
  }
  if (!hasText(hypothesis.corroboration?.prediction)
    || !executedProbe(hypothesis.corroboration)) {
    errors.push('independent corroborating co-effect is missing');
  }
  if (hypothesis.kill_probe?.command === hypothesis.corroboration?.command) {
    errors.push('kill probe and corroboration must be independent');
  }
}

function validateConfirmed(hypothesis, packet, errors) {
  if (!/^(?:root cause|根因):/i.test(packet.cause_statement || '')) {
    errors.push('confirmed cause must use root cause language');
  }
}

function validateConfirmProbe(hypothesis, errors) {
  const confirm = hypothesis.confirm_test;
  const independent = ![hypothesis.kill_probe?.command, hypothesis.corroboration?.command]
    .includes(confirm?.command);
  if (confirm?.result !== 'confirmed'
    || !['removal', 'action'].includes(confirm?.kind)
    || !executedProbe(confirm)
    || !independent) {
    errors.push('confirmed cause lacks an independent confirm test');
  }
}

function validateProbable(hypothesis, packet, errors) {
  if (!/^(?:probable cause|可能原因):/i.test(packet.cause_statement || '')) {
    errors.push('corroborated cause must use probable cause language');
  }
  if (!hasText(hypothesis.missing_confirmation)) {
    errors.push('probable cause must name the missing confirm test');
  }
  if (hypothesis.confirm_test?.result === 'confirmed') {
    errors.push('probable cause already has confirmed evidence');
  }
}

function validateRepairProof(packet, errors) {
  if (!hasText(packet.injection?.causal_edge) || !hasText(packet.injection?.change)) {
    errors.push('Injection is missing');
  }
  if (!hasText(packet.frt_nbr?.desired_effect)
    || !hasText(packet.frt_nbr?.negative_branch)
    || !hasText(packet.frt_nbr?.prevention_check)) {
    errors.push('FRT/NBR is missing');
  }
  const sameBoundary = packet.regression?.before?.command === packet.regression?.after?.command;
  const symptomGone = !outputIncludes(packet.regression?.after, packet.symptom);
  if (!hasText(packet.regression?.boundary)
    || !redEvidence(packet.regression?.before, packet.symptom)
    || !greenEvidence(packet.regression?.after)
    || !sameBoundary
    || !symptomGone) {
    errors.push('regression boundary is not proven red then green');
  }
}

function validateCloseout(packet, errors) {
  const originalCommand = packet.reproduction?.original_red?.command;
  const sameOriginal = packet.original_recheck?.command === originalCommand;
  if (!greenEvidence(packet.original_recheck)
    || !sameOriginal
    || outputIncludes(packet.original_recheck, packet.symptom)) {
    errors.push('original symptom was not rerun green');
  }
  if (!executedProbe(packet.cleanup?.verification)
    || !Array.isArray(packet.cleanup?.scanned_paths)
    || packet.cleanup.scanned_paths.length === 0
    || packet.cleanup?.prototypes !== 'removed') {
    errors.push('debug cleanup is incomplete');
  }
  if (!Array.isArray(packet.authority?.remote_actions_performed)
    || packet.authority.remote_actions_performed.length !== 0) {
    errors.push('Repair cannot perform remote actions');
  }
}

function blocked(packet, errors) {
  return {
    success: false,
    terminal: 'blocked',
    blockers: errors,
    attempted_loops: [
      packet.reproduction?.original_red?.command,
      packet.reproduction?.minimized_red?.command
    ].filter(hasText),
    missing_artifact: errors[0],
    next_owner: 'user-or-external-executor',
    product_mutations_performed: []
  };
}

function validateRepairPacket(packet) {
  const errors = [];
  if (packet?.schema_version !== 1 || !hasText(packet.symptom)) {
    return blocked(packet || {}, ['repair packet identity is invalid']);
  }
  validateReproduction(packet, errors);
  validateBoardShape(packet, errors);
  validateTrust(packet, errors);
  validateRepairProof(packet, errors);
  validateCloseout(packet, errors);
  return errors.length ? blocked(packet, errors) : {
    success: true,
    terminal: 'verified-local-repair'
  };
}

function routeRepairWork({ kind, evidence_status: evidenceStatus }) {
  if (kind === 'confirmed-defect' && evidenceStatus === 'confirmed') {
    return { status: 'route', target: 'dverity-repair' };
  }
  if (['feature-gap', 'requirement-change', 'product-intent-gap'].includes(kind)) {
    return { status: 'route', target: 'external-wayfinder-executor' };
  }
  return { status: 'blocked', target: null };
}

module.exports = {
  routeRepairWork,
  validateRepairPacket
};
