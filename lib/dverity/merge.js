const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { z } = require('zod');
const { createReviewItemRecord, sameTextSet } = require('./review-item-record');
const {
  routeRepairWork
} = require('../../skills/dverity-repair/scripts/repair-contract');

const text = z.string().trim().min(1);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ReviewRecordSchema = z.object({
  schema_version: z.literal(1),
  provider: text,
  repo: text,
  item: z.object({ id: text, url: z.string().url() }).strict(),
  head: sha,
  task_session: text,
  facets: z.array(text).min(1),
  findings: z.array(z.unknown()),
  verdict: z.enum(['pass', 'fail', 'blocked', 'unknown']),
  mode: z.enum(['fresh', 'carry-forward']),
  carried_from: text.nullable(),
  read_only: z.literal(true)
}).strict();
const MaterialitySchema = z.object({
  conflict: z.literal(false),
  content: z.literal(false),
  generated: z.literal(false),
  bug_fix: z.literal(false),
  unknown: z.literal(false)
}).strict();
const CarryEvidenceSchema = z.object({
  schema_version: z.literal(1),
  old_base: sha,
  old_head: sha,
  new_base: sha,
  new_head: sha,
  range_diff: z.object({
    complete: z.literal(true),
    command: text,
    exit_code: z.literal(0),
    stdout_sha256: digest,
    entries: z.array(z.object({
      status: z.literal('='),
      line: text
    }).strict()).min(1)
  }).strict(),
  patch_ids: z.object({
    stable: z.literal(true),
    old: z.array(text).min(1),
    new: z.array(text).min(1)
  }).strict(),
  trees: z.object({
    equivalent: z.literal(true),
    old: digest,
    new: digest,
    commands: z.array(text).length(2)
  }).strict(),
  paths: z.object({
    equivalent: z.literal(true),
    old: z.array(text),
    new: z.array(text),
    commands: z.array(text).length(2)
  }).strict(),
  validation: z.object({
    status: z.literal('pass'),
    head: sha,
    command: text,
    exit_code: z.literal(0),
    stdout_sha256: digest,
    stderr_sha256: digest,
    commands: z.array(text).length(1)
  }).strict(),
  materiality: MaterialitySchema
}).strict();

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runGit(cwd, args, input) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', input });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return { command: `git ${args.join(' ')}`, exit_code: result.status, stdout: result.stdout };
}

function lines(value) {
  return value.trim() ? value.trim().split('\n') : [];
}

function patchIds(cwd, base, head) {
  const commits = lines(runGit(cwd, ['rev-list', '--reverse', `${base}..${head}`]).stdout);
  return commits.map((commit) => {
    const patch = runGit(cwd, ['show', '--pretty=format:', '--patch', '--binary', commit]);
    return lines(runGit(cwd, ['patch-id', '--stable'], patch.stdout).stdout)[0]?.split(' ')[0];
  });
}

function rangeDiffEntries(output) {
  return lines(output).map((line) => {
    const match = line.match(/^\s*\d+:\s+[0-9a-f]+\s+([=<>!])\s+\d+:/);
    return match ? { status: match[1], line } : null;
  }).filter(Boolean);
}

function diffEvidence(cwd, base, head) {
  const tree = runGit(cwd, ['diff', '--binary', `${base}..${head}`]);
  const paths = runGit(cwd, ['diff', '--name-only', `${base}..${head}`]);
  return {
    tree: { command: tree.command, sha256: sha256(tree.stdout) },
    paths: { command: paths.command, values: lines(paths.stdout) }
  };
}

function collectCarryForwardEvidence({
  repo_path: repoPath,
  old_base: oldBase,
  old_head: oldHead,
  new_base: newBase,
  new_head: newHead,
  validation_runner: validationRunner,
  materiality
}) {
  if (typeof validationRunner !== 'function') {
    throw new Error('new-head validation runner is required');
  }
  const range = runGit(repoPath, [
    'range-diff', `${oldBase}..${oldHead}`, `${newBase}..${newHead}`
  ]);
  const entries = rangeDiffEntries(range.stdout);
  const oldDiff = diffEvidence(repoPath, oldBase, oldHead);
  const newDiff = diffEvidence(repoPath, newBase, newHead);
  const validation = validationRunner({ cwd: repoPath, head: newHead });
  const validationPass = validation?.head === newHead && validation?.exit_code === 0;
  return {
    schema_version: 1,
    old_base: oldBase,
    old_head: oldHead,
    new_base: newBase,
    new_head: newHead,
    range_diff: {
      complete: range.exit_code === 0 && entries.length > 0,
      command: range.command,
      exit_code: range.exit_code,
      stdout_sha256: sha256(range.stdout),
      entries
    },
    patch_ids: {
      stable: true,
      old: patchIds(repoPath, oldBase, oldHead),
      new: patchIds(repoPath, newBase, newHead)
    },
    trees: {
      equivalent: oldDiff.tree.sha256 === newDiff.tree.sha256,
      old: oldDiff.tree.sha256,
      new: newDiff.tree.sha256,
      commands: [oldDiff.tree.command, newDiff.tree.command]
    },
    paths: {
      equivalent: sameTextSet(oldDiff.paths.values, newDiff.paths.values),
      old: oldDiff.paths.values,
      new: newDiff.paths.values,
      commands: [oldDiff.paths.command, newDiff.paths.command]
    },
    validation: {
      status: validationPass ? 'pass' : 'fail',
      head: validation?.head,
      command: validation?.command,
      exit_code: validation?.exit_code,
      stdout_sha256: sha256(validation?.stdout || ''),
      stderr_sha256: sha256(validation?.stderr || ''),
      commands: validation?.command ? [validation.command] : []
    },
    materiality
  };
}

function rerouteSubmit(reason) {
  return {
    success: false,
    terminal: 'reroute',
    target: 'submit-remote-review',
    reason,
    remote_actions_performed: []
  };
}

function blocked(reason) {
  return {
    success: false,
    terminal: 'blocked',
    target: null,
    reason,
    remote_actions_performed: []
  };
}

function requireFreshReview(reason) {
  return { ...blocked(reason), next_owner: 'independent-review' };
}

function sameItem(left, right) {
  return left.provider === right.provider
    && left.repo === right.repo
    && left.item.id === right.item.id
    && left.item.url === right.item.url
    && left.source === right.source
    && left.target === right.target;
}

function requireCurrentProviderTruth(record) {
  const fields = [
    'approvals',
    'unresolved_discussions',
    'mergeability',
    'protection_or_queue',
    'ci_state'
  ];
  const missing = fields.find((field) => record[field] === null);
  if (missing) throw new Error(`${missing} current provider truth is missing`);
}

function requireAuthenticatedReadback(record) {
  if (!record.capability.includes('review-item-read')) {
    throw new Error('authenticated review-item-read capability is required');
  }
  const scope = record.mutation_scope;
  const scopeMatches = scope.repo === record.repo
    && scope.source === record.source
    && scope.target === record.target
    && scope.item === record.item.id;
  if (!scopeMatches) throw new Error('provider mutation scope is not bound to the review item');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function reviewMatchesRecord(review, record) {
  return review.provider === record.provider
    && review.repo === record.repo
    && review.item.id === record.item.id
    && review.item.url === record.item.url
    && review.head === record.head;
}

function validateReview(review, record, taskSession) {
  const parsed = ReviewRecordSchema.parse(review);
  const matches = reviewMatchesRecord(parsed, record)
    && parsed.task_session === taskSession;
  if (!matches || parsed.mode !== 'fresh' || parsed.carried_from !== null) {
    throw new Error('Independent Review is not bound to the current item, head, and task session');
  }
  return parsed;
}

function requireFreshTaskSession(record, taskSession) {
  if (record.current_head_review === null) return;
  const previous = ReviewRecordSchema.parse(record.current_head_review);
  if (previous.task_session === taskSession) {
    throw new Error('Independent Review requires a fresh task session');
  }
}

function sameOrderedList(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCarryEvidence(evidence, previous, current) {
  const parsed = CarryEvidenceSchema.parse(evidence);
  const headsMatch = parsed.old_base === previous.base
    && parsed.old_head === previous.head
    && parsed.new_base === current.base
    && parsed.new_head === current.head;
  if (!headsMatch || previous.head === current.head) {
    throw new Error('carry-forward evidence does not bind the old and new heads');
  }
  const patchesMatch = sameOrderedList(parsed.patch_ids.old, parsed.patch_ids.new)
    && parsed.range_diff.entries.length === parsed.patch_ids.old.length;
  const treesMatch = parsed.trees.old === parsed.trees.new;
  const pathsMatch = sameTextSet(parsed.paths.old, parsed.paths.new);
  const validationMatches = parsed.validation.head === current.head;
  if (!patchesMatch || !treesMatch || !pathsMatch || !validationMatches) {
    throw new Error('carry-forward evidence does not prove a semantic no-op');
  }
  return parsed;
}

function carryForwardReview({
  previous_record: previousInput,
  current_record: currentInput,
  task_session: taskSession,
  repo_path: repoPath,
  validation_runner: validationRunner,
  materiality: materialityInput
}) {
  try {
    const previous = createReviewItemRecord(previousInput);
    const current = createReviewItemRecord(currentInput);
    if (!sameItem(previous, current)) {
      return requireFreshReview('carry-forward records do not identify the same provider item');
    }
    requireAuthenticatedReadback(current);
    requireCurrentProviderTruth(current);
    const oldReview = ReviewRecordSchema.parse(previous.current_head_review);
    if (!reviewMatchesRecord(oldReview, previous)) {
      return requireFreshReview('previous review is not bound to its provider item and head');
    }
    if (oldReview.task_session === taskSession) {
      return requireFreshReview('carry-forward requires a fresh task session');
    }
    const materiality = MaterialitySchema.parse(materialityInput);
    const evidence = validateCarryEvidence(collectCarryForwardEvidence({
      repo_path: repoPath,
      old_base: previous.base,
      old_head: previous.head,
      new_base: current.base,
      new_head: current.head,
      validation_runner: validationRunner,
      materiality
    }), previous, current);
    const review = ReviewRecordSchema.parse({
      ...oldReview,
      head: current.head,
      task_session: taskSession,
      mode: 'carry-forward',
      carried_from: previous.head
    });
    const record = createReviewItemRecord({ ...current, current_head_review: review });
    return {
      success: review.verdict === 'pass',
      terminal: review.verdict === 'pass'
        ? 'review-carry-forward-passed'
        : `review-carry-forward-${review.verdict}`,
      record: deepFreeze(record),
      evidence: deepFreeze(evidence),
      remote_actions_performed: []
    };
  } catch (error) {
    return requireFreshReview(error instanceof Error ? error.message : String(error));
  }
}

function routeMergeWork(signal) {
  const decision = signal.kind === 'conflict'
    ? signal.intent_status === 'proven'
      ? { status: 'route', target: 'resolving-merge-conflicts' }
      : { status: 'blocked', target: null }
    : routeRepairWork(signal);
  return { ...decision, product_mutations_performed: [] };
}

async function reviewMergeItem({ candidate, provider, reviewer, task_session: taskSession }) {
  if (candidate?.kind !== 'provider-item' || !candidate.record) {
    return rerouteSubmit('Merge requires an authenticated provider-native review item');
  }
  let submitted;
  try {
    submitted = createReviewItemRecord(candidate.record);
  } catch (_error) {
    return rerouteSubmit('Merge requires an authenticated provider-native review item record');
  }
  try {
    requireFreshTaskSession(submitted, taskSession);
    const current = createReviewItemRecord(await provider.readReviewItem({
      provider: submitted.provider,
      repo: submitted.repo,
      item: submitted.item,
      read_only: true
    }));
    if (!sameItem(submitted, current)) {
      return blocked('Provider readback does not match the named review item');
    }
    requireAuthenticatedReadback(current);
    requireCurrentProviderTruth(current);
    requireFreshTaskSession(current, taskSession);
    const trustedCurrent = deepFreeze(current);
    const review = validateReview(await reviewer.review({
      record: trustedCurrent,
      task_session: taskSession,
      read_only: true
    }), trustedCurrent, taskSession);
    const record = createReviewItemRecord({ ...trustedCurrent, current_head_review: review });
    return {
      success: review.verdict === 'pass',
      terminal: review.verdict === 'pass'
        ? 'independent-review-passed'
        : `independent-review-${review.verdict}`,
      record: deepFreeze(record),
      remote_actions_performed: []
    };
  } catch (error) {
    return blocked(error instanceof Error ? error.message : String(error));
  }
}

module.exports = {
  carryForwardReview,
  collectCarryForwardEvidence,
  reviewMergeItem,
  routeMergeWork
};
