const { z } = require('zod');
const {
  createReviewItemRecord,
  parseBoundReview,
  sameReviewItemIdentity,
  sameTextSet
} = require('./review-item-record');

const text = z.string().trim().min(1);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const AuthoritySchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  repo: text,
  item: text,
  source: text,
  target: text,
  land: z.literal(true),
  close_issues: z.boolean(),
  direct_issues: z.array(text),
  max_review_items: z.literal(1)
}).strict();
const CloseoutSchema = z.array(z.object({
  issue: text,
  relation: z.enum(['direct', 'parent', 'sibling', 'blocker', 'partial', 'related']),
  action: z.enum(['close-after-merge', 'related-only'])
}).strict());
const LandingSchema = z.object({
  provider: text,
  repo: text,
  item: z.object({ id: text, url: z.string().url() }).strict(),
  head: sha,
  target: text,
  auth_actor: text,
  merged: z.literal(true),
  merge_sha: sha
}).strict();
const RemoteTargetSchema = z.object({ repo: text, target: text, head: sha }).strict();
const LocalRefSchema = z.object({ ref: text, target: text, head: sha }).strict();
const ActiveWorktreeSchema = z.object({ target: text, head: sha, clean: z.boolean() }).strict();
const CheckSchema = z.object({ state: text, sha, url: z.string().url() }).strict();
const GitHubNoGatesSchema = z.object({
  provider: z.literal('github'),
  auth_actor: text,
  repo: text,
  target: text,
  head: sha,
  base: sha,
  queries: z.object({
    protection: z.object({
      endpoint: z.literal('branch-protection'),
      status: z.literal('not-found')
    }).strict(),
    rulesets: z.object({
      endpoint: z.literal('rulesets'),
      status: z.literal('complete'),
      matching: z.array(z.unknown()).length(0)
    }).strict(),
    required_reviews: z.object({
      endpoint: z.literal('required-reviews'),
      status: z.literal('complete'),
      count: z.literal(0)
    }).strict(),
    required_checks: z.object({
      endpoint: z.literal('required-checks'),
      status: z.literal('complete'),
      contexts: z.array(text).length(0)
    }).strict()
  }).strict()
}).strict();
const HeadPassSchema = z.object({ status: z.literal('pass'), head: sha }).strict();
const LocalReadinessSchema = z.object({
  head: sha,
  frozen: z.literal(true),
  full: HeadPassSchema,
  publish: HeadPassSchema,
  production_audit: HeadPassSchema,
  artifact: z.object({
    status: z.literal('pass'),
    source_commit: sha,
    sha512: z.string().regex(/^[a-f0-9]{128}$/)
  }).strict()
}).strict();
const IssueReadbackSchema = z.object({
  provider: text,
  repo: text,
  issue: text,
  state: z.enum(['open', 'closed']),
  auth_actor: text
}).strict();

function issueText(error) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

function blocked(reason, extra = {}) {
  return { success: false, terminal: 'blocked', reason, ...extra };
}

function adaptedRecord(priorInput, fields) {
  const prior = createReviewItemRecord(priorInput);
  const record = createReviewItemRecord({
    ...prior,
    ...fields,
    current_head_review: prior.current_head_review,
    closeout_intent: prior.closeout_intent,
    mutation_scope: prior.mutation_scope
  });
  const sameHead = record.head === prior.head && record.base === prior.base;
  if (!sameReviewItemIdentity(prior, record) || !sameHead) {
    throw new Error('provider adapter readback does not match the named item and head');
  }
  return record;
}

function adapt(factory) {
  try {
    return { success: true, terminal: 'adapted', record: factory() };
  } catch (error) {
    return blocked(issueText(error));
  }
}

function requireIdentity(identity) {
  if (!identity?.actor) throw new Error('authenticated actor is required');
  const capabilities = identity.capabilities || [];
  if (!capabilities.includes('review-item-land')) {
    throw new Error('review-item-land capability is required');
  }
  return { actor: identity.actor, capabilities };
}

function githubApproval(value) {
  if (value === 'APPROVED') return { state: 'approved' };
  if (value === 'CHANGES_REQUESTED') return { state: 'blocked' };
  if (value === 'REVIEW_REQUIRED') return { state: 'pending' };
  return { state: 'unknown' };
}

function githubMergeability(item) {
  if (item.mergeable === 'MERGEABLE') return { state: 'mergeable' };
  if (item.mergeable === 'CONFLICTING') return { state: 'conflicting' };
  return { state: item.mergeStateStatus === 'UNKNOWN' ? 'unknown' : 'pending' };
}

function checksState(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return { state: 'unknown' };
  if (checks.some((check) => check.status !== 'COMPLETED')) return { state: 'pending' };
  const passing = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
  return { state: checks.every((check) => passing.has(check.conclusion)) ? 'passed' : 'failed' };
}

function githubQueue(snapshot) {
  if (typeof snapshot.protection?.requires_queue !== 'boolean') {
    return { mode: 'unknown', state: 'unknown' };
  }
  if (!snapshot.protection.requires_queue) return { mode: 'direct', state: 'ready' };
  if (!snapshot.queue) return { mode: 'queue', state: 'required' };
  if (snapshot.queue.state === 'MERGED') return { mode: 'queue', state: 'merged' };
  const pending = ['QUEUED', 'AWAITING_CHECKS', 'AWAITING_REVIEW'];
  return { mode: 'queue', state: pending.includes(snapshot.queue.state) ? 'pending' : 'blocked' };
}

function adaptGitHubReviewItem(snapshot, prior) {
  return adapt(() => {
    const identity = requireIdentity(snapshot.identity);
    const item = snapshot.item || {};
    return adaptedRecord(prior, {
      provider: 'github',
      repo: item.repo,
      item: { id: String(item.id), url: item.url },
      source: item.source,
      target: item.target,
      head: item.head,
      base: item.base,
      auth_actor: identity.actor,
      capability: identity.capabilities,
      draft: item.draft,
      approvals: githubApproval(item.reviewDecision),
      unresolved_discussions: Number.isInteger(snapshot.unresolved_discussions)
        ? Array(snapshot.unresolved_discussions).fill('unresolved')
        : null,
      mergeability: githubMergeability(item),
      protection_or_queue: githubQueue(snapshot),
      ci_state: checksState(snapshot.checks),
      landing_policy: snapshot.gate_queries
        ? {
          provider: 'github',
          auth_actor: identity.actor,
          repo: item.repo,
          target: item.target,
          head: item.head,
          base: item.base,
          queries: snapshot.gate_queries
        }
        : null,
      local_readiness: prior.local_readiness
    });
  });
}

function gitlabApproval(approvals) {
  if (!approvals || !Number.isInteger(approvals.approvals_left)) return { state: 'unknown' };
  return { state: approvals.approvals_left === 0 ? 'approved' : 'blocked' };
}

function gitlabMergeability(item) {
  if (item.detailed_merge_status === 'mergeable') return { state: 'mergeable' };
  if (item.detailed_merge_status === 'conflict') return { state: 'conflicting' };
  const pending = ['checking', 'preparing', 'unchecked'];
  return { state: pending.includes(item.detailed_merge_status) ? 'pending' : 'unknown' };
}

function gitlabPipeline(pipeline) {
  if (!pipeline?.status) return { state: 'unknown' };
  if (pipeline.status === 'success') return { state: 'passed' };
  if (['running', 'pending', 'created', 'preparing'].includes(pipeline.status)) {
    return { state: 'pending' };
  }
  return { state: 'failed' };
}

function gitlabTrain(snapshot) {
  if (typeof snapshot.protection?.requires_train !== 'boolean') {
    return { mode: 'unknown', state: 'unknown' };
  }
  if (!snapshot.protection.requires_train) return { mode: 'direct', state: 'ready' };
  if (!snapshot.train) return { mode: 'train', state: 'required' };
  if (snapshot.train.status === 'merged') return { mode: 'train', state: 'merged' };
  const pending = ['checking', 'queued', 'merging'];
  return { mode: 'train', state: pending.includes(snapshot.train.status) ? 'pending' : 'blocked' };
}

function adaptGitLabReviewItem(snapshot, prior) {
  return adapt(() => {
    const identity = requireIdentity(snapshot.identity);
    const item = snapshot.item || {};
    return adaptedRecord(prior, {
      provider: 'gitlab',
      repo: item.repo,
      item: { id: String(item.iid), url: item.web_url },
      source: item.source_branch,
      target: item.target_branch,
      head: item.sha,
      base: item.base_sha,
      auth_actor: identity.actor,
      capability: identity.capabilities,
      draft: item.work_in_progress,
      approvals: gitlabApproval(snapshot.approvals),
      unresolved_discussions: Array.isArray(snapshot.discussions)
        ? snapshot.discussions.filter((item) => !item.resolved)
        : null,
      mergeability: gitlabMergeability(item),
      protection_or_queue: gitlabTrain(snapshot),
      ci_state: gitlabPipeline(snapshot.pipeline)
    });
  });
}

function validateCurrentReview(record) {
  const review = parseBoundReview(record.current_head_review, record);
  const validCarry = review.mode === 'fresh'
    ? review.carried_from === null
    : /^[a-f0-9]{40}$/.test(review.carried_from || '');
  if (review.verdict !== 'pass' || !validCarry) {
    throw new Error('current-head Independent Review pass is required');
  }
}

function validateGitHubNoGates(record) {
  const policy = GitHubNoGatesSchema.parse(record.landing_policy);
  const readiness = LocalReadinessSchema.parse(record.local_readiness);
  if (policy.repo !== record.repo || policy.target !== record.target
    || policy.head !== record.head || policy.base !== record.base) {
    throw new Error('GitHub no-gates proof is stale for the current head or base');
  }
  if (policy.auth_actor !== record.auth_actor) {
    throw new Error('GitHub no-gates proof is not authenticated for the review item actor');
  }
  const heads = [readiness.head, readiness.full.head, readiness.publish.head,
    readiness.production_audit.head, readiness.artifact.source_commit];
  if (heads.some((head) => head !== record.head)) {
    throw new Error('frozen local readiness is stale for the current head');
  }
  const review = parseBoundReview(record.current_head_review, record);
  if (review.verdict !== 'pass' || review.mode !== 'fresh' || review.carried_from !== null) {
    throw new Error('fresh current-head Independent Review pass is required');
  }
}

function requireState(value, expected, label) {
  if (value?.state !== expected) {
    throw new Error(`${label} is ${value?.state || 'unknown'}, expected ${expected}`);
  }
}

function landingStrategy(protection) {
  const mode = protection?.mode;
  const state = protection?.state;
  if (!['direct', 'queue', 'train'].includes(mode)) {
    throw new Error('protection, queue, or train truth is unknown');
  }
  if (state === 'pending') throw new Error(`${mode} is pending`);
  if (state === 'blocked' || state === 'unknown') throw new Error(`${mode} is ${state}`);
  const allowed = mode === 'direct' ? ['ready', 'merged'] : ['required', 'ready', 'merged'];
  if (!allowed.includes(state)) throw new Error(`${mode} state is incomplete`);
  return { strategy: mode, already_merged: state === 'merged' };
}

function evaluateLandingGate(input) {
  try {
    const record = createReviewItemRecord(input);
    if (!record.capability.includes('review-item-land')) {
      throw new Error('review-item-land capability is required');
    }
    if (record.draft) throw new Error('draft review item cannot land');
    const approvalState = record.approvals?.state || 'unknown';
    const checkState = record.ci_state?.state || 'unknown';
    const nativeGatesPass = approvalState === 'approved' && checkState === 'passed';
    const noNativeGates = approvalState === 'unknown' && checkState === 'unknown';
    if (!nativeGatesPass && noNativeGates) validateGitHubNoGates(record);
    if (!nativeGatesPass && !noNativeGates) {
      requireState(record.approvals, 'approved', 'approval');
      requireState(record.ci_state, 'passed', 'checks');
    }
    if (!Array.isArray(record.unresolved_discussions) || record.unresolved_discussions.length) {
      throw new Error('unresolved discussion blocks landing');
    }
    requireState(record.mergeability, 'mergeable', 'mergeability');
    if (nativeGatesPass) {
      requireState(record.approvals, 'approved', 'approval');
      requireState(record.ci_state, 'passed', 'checks');
    }
    validateCurrentReview(record);
    return { success: true, terminal: 'landing-ready', ...landingStrategy(record.protection_or_queue) };
  } catch (error) {
    return blocked(issueText(error));
  }
}

function validateAuthority(input, record) {
  const authority = AuthoritySchema.parse(input);
  const matches = authority.provider === record.provider
    && authority.repo === record.repo
    && authority.item === record.item.id
    && authority.source === record.source
    && authority.target === record.target;
  if (!matches) throw new Error('landing authority does not match the named provider item');
  return authority;
}

function validateCloseout(input, record, authority) {
  const plan = CloseoutSchema.parse(input);
  const keys = plan.map((item) => `${item.issue}:${item.action}`);
  if (new Set(keys).size !== keys.length) throw new Error('duplicate closeout item');
  const intent = record.closeout_intent.map((item) => `${item.issue}:${item.action}`);
  if (!sameTextSet(keys, intent)) throw new Error('closeout plan does not match Submit intent');
  const invalid = plan.find((item) => (
    item.action === 'close-after-merge' ? item.relation !== 'direct' : item.relation === 'direct'
  ));
  if (invalid) throw new Error('only a direct completed issue may close after merge');
  const direct = plan.filter((item) => item.relation === 'direct').map((item) => item.issue);
  if (!sameTextSet(direct, authority.direct_issues)) {
    throw new Error('closeout direct issues exceed explicit authority');
  }
  if (direct.length && !authority.close_issues) throw new Error('issue close authority is required');
  if (direct.length && !record.capability.includes('issue-close')) {
    throw new Error('issue-close capability is required');
  }
  if (!record.capability.includes('issue-read')) throw new Error('issue-read capability is required');
  return plan;
}

function audit() {
  return { requested: [], performed: [], readback: [] };
}

function validateCurrentRecord(candidate, current) {
  const sameHead = candidate.head === current.head && candidate.base === current.base;
  if (!sameReviewItemIdentity(candidate, current) || !sameHead) {
    throw new Error('provider readback does not match the reviewed item and head');
  }
  if (candidate.current_head_review !== current.current_head_review
    && JSON.stringify(candidate.current_head_review) !== JSON.stringify(current.current_head_review)) {
    throw new Error('provider readback changed the current-head review record');
  }
}

async function landItem(provider, record, gate, mutation) {
  if (gate.already_merged) return;
  const call = { operation: 'land-review-item', item: record.item.id };
  mutation.requested.push(call);
  try {
    await provider.landReviewItem({
      provider: record.provider,
      repo: record.repo,
      item: record.item,
      head: record.head,
      strategy: gate.strategy
    });
    mutation.performed.push(call);
  } catch (error) {
    mutation.performed.push({ ...call, error: issueText(error) });
    throw error;
  }
}

function validateLanding(input, record) {
  const landing = LandingSchema.parse(input);
  const sameItem = landing.provider === record.provider
    && landing.repo === record.repo
    && landing.item.id === record.item.id
    && landing.item.url === record.item.url
    && landing.head === record.head
    && landing.target === record.target
    && landing.auth_actor === record.auth_actor;
  if (!sameItem) throw new Error('provider landing readback does not match the named item');
  return landing;
}

function parityPacket(record, landing, target, tracking, localTarget, active, checks) {
  if (target.repo !== record.repo || target.target !== record.target) {
    throw new Error('remote target identity mismatch');
  }
  if (tracking.target !== record.target) throw new Error('tracking ref target mismatch');
  if (localTarget.target !== record.target) throw new Error('local target identity mismatch');
  if (active.target !== record.target) throw new Error('active worktree target mismatch');
  if (target.head !== landing.merge_sha) throw new Error('remote target parity mismatch');
  if (tracking.head !== landing.merge_sha) throw new Error('tracking ref parity mismatch');
  if (localTarget.head !== landing.merge_sha) throw new Error('local target parity mismatch');
  if (active.head !== landing.merge_sha) throw new Error('active worktree head parity mismatch');
  if (!active.clean) throw new Error('active worktree is dirty');
  if (checks.sha !== landing.merge_sha || checks.state !== 'passed') {
    throw new Error('post-merge checks are not bound terminal success');
  }
  return {
    schema_version: 1,
    status: 'parity-proven',
    provider: record.provider,
    repo: record.repo,
    item: record.item,
    reviewed_head: record.head,
    merge_sha: landing.merge_sha,
    provider_item: { merged: landing.merged, merge_sha: landing.merge_sha },
    remote_target: target,
    tracking_ref: tracking,
    local_target: localTarget,
    active_worktree: active,
    post_merge_checks: checks,
    closeout: []
  };
}

async function readParity(provider, local, record, mutation) {
  const landing = validateLanding(await provider.readLanding({
    repo: record.repo,
    item: record.item,
    read_only: true
  }), record);
  mutation.readback.push({ operation: 'provider-item', result: landing });
  const target = RemoteTargetSchema.parse(await provider.readTarget({
    repo: record.repo,
    target: record.target,
    read_only: true
  }));
  const tracking = LocalRefSchema.parse(await local.readTrackingRef({ target: record.target }));
  const localTarget = LocalRefSchema.parse(await local.readLocalTarget({ target: record.target }));
  const active = ActiveWorktreeSchema.parse(await local.readActiveWorktree());
  const checks = CheckSchema.parse(await provider.readPostMergeChecks({
    repo: record.repo,
    sha: landing.merge_sha,
    read_only: true
  }));
  mutation.readback.push(
    { operation: 'remote-target', result: target },
    { operation: 'tracking-ref', result: tracking },
    { operation: 'local-target', result: localTarget },
    { operation: 'active-worktree', result: active },
    { operation: 'post-merge-checks', result: checks }
  );
  return parityPacket(record, landing, target, tracking, localTarget, active, checks);
}

function validateIssueReadback(input, record, issue) {
  const result = IssueReadbackSchema.parse(input);
  const matches = result.provider === record.provider
    && result.repo === record.repo
    && result.issue === issue
    && result.auth_actor === record.auth_actor;
  if (!matches) throw new Error(`issue readback for ${issue} does not match provider scope`);
  return result;
}

async function closeDirectIssue(provider, record, item, mutation) {
  const scope = { provider: record.provider, repo: record.repo, issue: item.issue };
  const before = validateIssueReadback(await provider.readIssue({ ...scope, read_only: true }),
    record, item.issue);
  mutation.readback.push({ operation: 'issue-before', issue: item.issue, result: before });
  if (before.state !== 'closed') {
    mutation.requested.push({ operation: 'close-issue', issue: item.issue });
    await provider.closeIssue(scope);
    mutation.performed.push({ operation: 'close-issue', issue: item.issue });
  }
  const after = validateIssueReadback(await provider.readIssue({ ...scope, read_only: true }),
    record, item.issue);
  mutation.readback.push({ operation: 'issue-after', issue: item.issue, result: after });
  if (after.state !== 'closed') throw new Error(`closeout readback for ${item.issue} is not closed`);
  return { issue: item.issue, relation: 'direct', action: 'closed', state: after.state };
}

async function readRelatedIssue(provider, record, item, mutation) {
  const result = validateIssueReadback(await provider.readIssue({
    provider: record.provider,
    repo: record.repo,
    issue: item.issue,
    read_only: true
  }), record, item.issue);
  mutation.readback.push({ operation: 'issue-related', issue: item.issue, result });
  return { issue: item.issue, relation: item.relation, action: 'related-only', state: result.state };
}

async function runCloseout(provider, record, plan, mutation) {
  const results = [];
  for (const item of plan) {
    results.push(item.relation === 'direct'
      ? await closeDirectIssue(provider, record, item, mutation)
      : await readRelatedIssue(provider, record, item, mutation));
  }
  return results;
}

async function landRemoteReview({ candidate, provider, local, authority: inputAuthority, closeout }) {
  const mutation = audit();
  let packet;
  try {
    if (candidate?.kind !== 'provider-item' || !candidate.record) {
      throw new Error('landing requires one reviewed provider-native item');
    }
    const submitted = createReviewItemRecord(candidate.record);
    const authority = validateAuthority(inputAuthority, submitted);
    const current = createReviewItemRecord(await provider.readReviewItem({
      provider: submitted.provider,
      repo: submitted.repo,
      item: submitted.item,
      read_only: true
    }));
    mutation.readback.push({ operation: 'review-item-before', result: current });
    validateCurrentRecord(submitted, current);
    const plan = validateCloseout(closeout, current, authority);
    const gate = evaluateLandingGate(current);
    if (!gate.success) return blocked(gate.reason, { mutation_audit: mutation });
    await landItem(provider, current, gate, mutation);
    packet = await readParity(provider, local, current, mutation);
    packet.closeout = await runCloseout(provider, current, plan, mutation);
    packet.status = 'landed-parity-proven';
    return {
      success: true,
      terminal: 'landed-parity-proven',
      packet,
      mutation_audit: mutation
    };
  } catch (error) {
    return blocked(issueText(error), { packet, mutation_audit: mutation });
  }
}

module.exports = {
  adaptGitHubReviewItem,
  adaptGitLabReviewItem,
  evaluateLandingGate,
  landRemoteReview
};
