const { PacketSchema } = require('../../acceptance/ledger');
const { ReleaseReadinessSchema, textSetSha256 } = require('../review/review-item-record');

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^[a-f0-9]{128}$/;
const HOST_CARRY_IDS = new Set(['DV-INS-002', 'DV-INS-003']);
const USER_STOP_ISSUES = new Set([79, 80]);

function failure(error) {
  return { success: false, error };
}

function auditArtifactFreeze(record) {
  const requiredTools = ['node', 'npm', 'git', 'tar'];
  if (!record || !SHA40.test(record.source_commit) || record.source_clean !== true) {
    return failure('artifact source must be one clean frozen commit');
  }
  if (record.artifact_paths?.length !== 1) {
    return failure('artifact freeze must contain exactly one artifact path');
  }
  if (!record.name || !Number.isInteger(record.size) || record.size <= 0
    || !SHA512.test(record.sha512) || !record.npm_integrity?.startsWith('sha512-')) {
    return failure('artifact identity, size, SHA-512, and npm integrity are required');
  }
  const inventory = Array.isArray(record.inventory) ? record.inventory : [];
  const paths = inventory.map((entry) => entry?.path);
  if (!inventory.length || paths.some((entry) => !entry)
    || new Set(paths).size !== paths.length || inventory.some((entry) => (
      !Number.isInteger(entry.size) || entry.size < 0 || !Number.isInteger(entry.mode)
      || !SHA256.test(entry.sha256)
    ))) {
    return failure('artifact inventory must be complete and unique');
  }
  if (record.repack?.sha512 !== record.sha512
    || record.repack?.npm_integrity !== record.npm_integrity) {
    return failure('independent repack must be byte-identical');
  }
  if (!Array.isArray(record.procedure) || record.procedure.length < 2
    || requiredTools.some((tool) => !record.tools?.[tool]?.trim())) {
    return failure('artifact procedure and tool versions are required');
  }
  return {
    success: true,
    artifact: {
      source_commit: record.source_commit,
      path: record.artifact_paths[0],
      name: record.name,
      size: record.size,
      sha512: record.sha512,
      npm_integrity: record.npm_integrity,
      inventory_count: inventory.length,
      repack_byte_identical: true
    }
  };
}

function acceptanceIds(catalog) {
  return catalog?.rows?.map((row) => row.acceptance_id) || [];
}

function parsePrimaryOwners(body) {
  const line = String(body).split('\n')
    .find((entry) => entry.includes('Primary acceptance owner:'));
  if (!line) throw new Error('Primary acceptance owner line is missing');
  const ids = line.match(/DV-[A-Z]+-\d{3}/g) || [];
  if (!ids.length || new Set(ids).size !== ids.length) {
    throw new Error('Primary acceptance owner line is invalid');
  }
  return ids;
}

function expectedPreReleaseOutcome(row) {
  if (HOST_CARRY_IDS.has(row.acceptance_id)) return 'host-carry';
  return /live/i.test(row.execution_class) ? 'pending' : 'pass';
}

function setAudit(canonicalIds, entries) {
  const expected = new Set(canonicalIds);
  const supplied = entries.map((entry) => entry.acceptance_id);
  const counts = supplied.reduce((map, id) => map.set(id, (map.get(id) || 0) + 1), new Map());
  return {
    canonical: canonicalIds.length,
    entries: entries.length,
    unique: new Set(supplied).size,
    missing: canonicalIds.filter((id) => !counts.has(id)),
    duplicates: [...counts].filter(([, count]) => count > 1).map(([id]) => id).sort(),
    unexpected: [...counts.keys()].filter((id) => !expected.has(id)).sort()
  };
}

function auditPrimaryOwnership(catalog, ownership) {
  if (!Array.isArray(ownership)) return failure('primary ownership rows are required');
  const audit = setAudit(acceptanceIds(catalog), ownership);
  const malformed = ownership.some((row) => !Number.isInteger(row.primary_issue)
    || row.primary_issue < 65 || row.primary_issue > 80 || !row.source?.startsWith('https://'));
  if (malformed || audit.entries !== audit.canonical || audit.unique !== audit.canonical
    || audit.missing.length || audit.duplicates.length || audit.unexpected.length) {
    return failure(`primary ownership is not exact-once: ${JSON.stringify(audit)}`);
  }
  return { success: true, ...audit };
}

function actualRollup(results) {
  return results.reduce((counts, result) => {
    counts[result.outcome] += 1;
    return counts;
  }, { pass: 0, fail: 0, blocked: 0, unknown: 0, pending: 0 });
}

function hostCarryIsComplete(result) {
  const proof = result.freshness?.host_carry_forward;
  const required = [
    'evidence_head_ancestor', 'skill_bytes_identical',
    'artifact_digest_match', 'host_version_unchanged'
  ];
  return proof && required.every((key) => proof[key] === true);
}

function executorEvidenceIsComplete(result) {
  const executor = result.freshness?.executor;
  const required = [
    'owner_evidence_verified', 'integrated_commit_ancestor',
    'current_full_gate_pass', 'current_publish_gate_pass',
    'row_executor_pass', 'predicate_bound'
  ];
  return executor && required.every((key) => executor[key] === true)
    && result.evidence_refs.some((ref) => ref.kind === 'executor-result');
}

function cycleFrom(issues) {
  const graph = new Map(issues.map((entry) => [entry.issue, entry.blocked_by || []]));
  const active = new Set();
  const done = new Set();
  function visit(issue, path = []) {
    if (active.has(issue)) return [...path.slice(path.indexOf(issue)), issue];
    if (done.has(issue)) return null;
    active.add(issue);
    for (const blocker of graph.get(issue) || []) {
      const cycle = visit(blocker, [...path, issue]);
      if (cycle) return cycle;
    }
    active.delete(issue);
    done.add(issue);
    return null;
  }
  for (const issue of graph.keys()) {
    const cycle = visit(issue);
    if (cycle) return cycle;
  }
  return [];
}

function auditDependencyOrder(issues, history, integratedIssues = new Set(history.map(([issue]) => Number(issue)))) {
  const cycles = cycleFrom(issues);
  if (cycles.length) return failure(`dependency order contains cycle: ${cycles.join(' -> ')}`);
  const positions = new Map();
  history.forEach(([issue], index) => {
    const list = positions.get(Number(issue)) || [];
    list.push(index);
    positions.set(Number(issue), list);
  });
  const integrated = new Set([...integratedIssues].map(Number));
  const historical = new Set(history.map(([issue]) => Number(issue)));
  if (integrated.size !== historical.size || [...integrated].some((issue) => !historical.has(issue))) {
    return failure('integrated issue set does not match integration history');
  }
  for (const entry of issues.filter((item) => integrated.has(item.issue))) {
    const ticket = positions.get(entry.issue);
    if (!ticket) return failure(`dependency order lacks integrated issue #${entry.issue}`);
    for (const blocker of entry.blocked_by || []) {
      const blockerPositions = positions.get(blocker);
      if (!blockerPositions || Math.max(...blockerPositions) >= Math.min(...ticket)) {
        return failure(`dependency order violates #${blocker} -> #${entry.issue}`);
      }
    }
  }
  return {
    success: true,
    edges: issues.reduce((count, entry) => count + (entry.blocked_by?.length || 0), 0),
    cycles,
    integrated_issues: [...integrated].sort((left, right) => left - right)
  };
}

function auditProviderMerge({
  repository, pullNumber, merge, expectedBase, expectedHead,
  parents, mergeTree, sourceTree, pull
}) {
  if (!repository || !Number.isInteger(pullNumber) || !SHA40.test(merge)
    || !SHA40.test(expectedBase) || !SHA40.test(expectedHead)) {
    return failure('provider merge coordinates are invalid');
  }
  if (!Array.isArray(parents) || parents.length !== 2
    || parents[0] !== expectedBase || parents[1] !== expectedHead) {
    return failure('provider merge parent proof mismatch');
  }
  if (!SHA40.test(mergeTree) || mergeTree !== sourceTree) {
    return failure('provider merge/source tree mismatch');
  }
  if (pull?.number !== pullNumber || pull?.merge_commit_sha !== merge || !pull?.merged_at
    || pull?.base?.ref !== 'main' || pull?.base?.sha !== expectedBase
    || pull?.base?.repo?.full_name !== repository || pull?.head?.sha !== expectedHead) {
    return failure('authenticated provider PR merge proof mismatch');
  }
  return {
    success: true,
    data: { pull: pullNumber, merge, base: expectedBase, source: expectedHead }
  };
}

function auditOutcomes(catalog, results, ownerById) {
  let localRequired = 0;
  let localPass = 0;
  let livePending = 0;
  let liveCarried = 0;
  for (const row of catalog.rows) {
    const result = results.find((entry) => entry.acceptance_id === row.acceptance_id);
    if (result.outcome === 'pending' && (!Object.keys(result.freshness).length
      || !Object.keys(result.authority).length || !result.evidence_refs.length)) {
      return failure(`pending row requires freshness, authority, and evidence: ${row.acceptance_id}`);
    }
    if (result.outcome === 'pass' && !executorEvidenceIsComplete(result)) {
      return failure(`PASS row requires row-bound executor evidence: ${row.acceptance_id}`);
    }
    if (result.authority?.primary_owner_issue !== ownerById.get(row.acceptance_id)) {
      return failure(`primary owner mismatch for ${row.acceptance_id}`);
    }
    const expected = expectedPreReleaseOutcome(row);
    if (expected === 'pass') {
      localRequired += 1;
      if (result.outcome !== 'pass') return failure(`required local row must PASS: ${row.acceptance_id}`);
      localPass += 1;
      continue;
    }
    if (expected === 'host-carry' && result.outcome === 'pass'
      && hostCarryIsComplete(result)) {
      localRequired += 1;
      localPass += 1;
      liveCarried += 1;
      continue;
    }
    if (USER_STOP_ISSUES.has(ownerById.get(row.acceptance_id)) && result.outcome !== 'pending') {
      return failure(`user-authority stop must remain pending: ${row.acceptance_id}`);
    }
    if (result.outcome !== 'pending') {
      return failure(`live row must remain pending without complete carry-forward: ${row.acceptance_id}`);
    }
    if (USER_STOP_ISSUES.has(ownerById.get(row.acceptance_id))
      && result.authority?.user_authority !== 'explicit-stop') {
      return failure(`user-authority stop must remain explicit for ${row.acceptance_id}`);
    }
    livePending += 1;
  }
  return { success: true, localRequired, localPass, livePending, liveCarried };
}

function auditPreReleasePacket({ catalog, packet, ownership }) {
  const ownerAudit = auditPrimaryOwnership(catalog, ownership);
  if (!ownerAudit.success) return ownerAudit;
  const parsed = PacketSchema.safeParse(packet);
  if (!parsed.success) return failure('acceptance packet schema is invalid');
  const resultAudit = setAudit(acceptanceIds(catalog), parsed.data.results);
  if (resultAudit.entries !== resultAudit.canonical || resultAudit.unique !== resultAudit.canonical
    || resultAudit.missing.length || resultAudit.duplicates.length || resultAudit.unexpected.length) {
    return failure(`acceptance result set is not canonical: ${JSON.stringify(resultAudit)}`);
  }
  const ownerById = new Map(ownership.map((row) => [row.acceptance_id, row.primary_issue]));
  const outcomes = auditOutcomes(catalog, parsed.data.results, ownerById);
  if (!outcomes.success) return outcomes;
  const rollup = actualRollup(parsed.data.results);
  if (JSON.stringify(rollup) !== JSON.stringify(parsed.data.rollup)) {
    return failure('acceptance packet rollup does not match its rows');
  }
  return {
    success: true,
    ...resultAudit,
    local: { required: outcomes.localRequired, pass: outcomes.localPass },
    live: { pending: outcomes.livePending, carried: outcomes.liveCarried },
    rollup,
    verdict: outcomes.livePending ? 'blocked-pending-live' : 'release-ready'
  };
}

function sameArtifact(handoff, artifact) {
  const current = handoff.release_readiness?.artifact;
  return current?.sha512 === artifact.sha512
    && current?.npm_integrity === artifact.npm_integrity
    && current?.source_commit === artifact.source_commit
    && artifact.source_commit === handoff.head;
}

function reviewIsBound(handoff, dispatchBase) {
  const review = handoff.release_readiness?.ticket_review;
  return review?.status === 'pass' && review.base === dispatchBase
    && review.head === handoff.head
    && ['Standards', 'Spec'].every((axis) => review.axes?.includes(axis));
}

function validateReleaseHandoff({
  handoff, dispatchBase, artifact, packetSha256, expectedIntegratedIssues
}) {
  const release = ReleaseReadinessSchema.safeParse(handoff?.release_readiness);
  if (!release.success) return failure('handoff release-readiness schema is invalid');
  if (!handoff || handoff.remote_actions_performed !== 'none'
    || handoff.release_readiness?.source_clean !== true) {
    return failure('handoff must bind a clean local-only source');
  }
  const integratedIssues = [...new Set(expectedIntegratedIssues || [])].sort((left, right) => left - right);
  const deliveredIssues = (handoff.issues || []).map((url) => Number(String(url).split('/').at(-1)))
    .sort((left, right) => left - right);
  const closeoutIssues = (handoff.closeout_intent || []).map((entry) => Number(entry.issue?.slice(1)))
    .sort((left, right) => left - right);
  if (!integratedIssues.length || JSON.stringify(deliveredIssues) !== JSON.stringify(integratedIssues)
    || JSON.stringify(closeoutIssues) !== JSON.stringify(integratedIssues)) {
    return failure('handoff delivered scope drifted from integration history');
  }
  if (!SHA40.test(handoff.base) || !SHA40.test(handoff.head)
    || !Array.isArray(handoff.ahead_commits) || handoff.ahead_commits.length === 0
    || handoff.ahead_commits.at(-1) !== handoff.head) {
    return failure('handoff must preserve clean-but-ahead base/head proof');
  }
  if (handoff.local_review?.status !== 'pass' || handoff.local_review.base !== handoff.base
    || handoff.local_review.head !== handoff.head || !reviewIsBound(handoff, dispatchBase)) {
    return failure('handoff reviews are stale or incomplete');
  }
  if (!sameArtifact(handoff, artifact)
    || handoff.release_readiness?.acceptance_packet?.sha256 !== packetSha256) {
    return failure('handoff artifact or acceptance packet identity drifted');
  }
  if (release.data.dispatch_base !== dispatchBase
    || release.data.target !== handoff.target
    || release.data.integration_branch !== handoff.source
    || release.data.diff.base !== handoff.base
    || release.data.diff.head !== handoff.head
    || release.data.diff.touched_paths_sha256 !== textSetSha256(handoff.touched_paths)) {
    return failure('handoff release boundary is incomplete');
  }
  return { success: true, data: handoff };
}

module.exports = {
  HOST_CARRY_IDS,
  ReleaseReadinessSchema,
  USER_STOP_ISSUES,
  auditArtifactFreeze,
  auditDependencyOrder,
  auditProviderMerge,
  auditPreReleasePacket,
  auditPrimaryOwnership,
  expectedPreReleaseOutcome,
  parsePrimaryOwners,
  validateReleaseHandoff
};
