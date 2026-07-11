const { z } = require('zod');
const {
  CloseoutIntentSchema,
  createSubmitReviewItemRecord,
  sameTextSet
} = require('./review-item-record');

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const text = z.string().trim().min(1);

const SourceProofSchema = z.object({
  source: text,
  target: text,
  target_head: sha,
  base: sha,
  head: sha,
  clean: z.boolean(),
  behind: z.number().int().nonnegative(),
  ahead_commits: z.array(sha),
  touched_paths: z.array(text).min(1)
}).strict();

const HandoffSchema = z.object({
  source: text,
  target: text,
  base: sha,
  head: sha,
  ahead_commits: z.array(sha).min(1),
  scope_source: z.object({
    kind: z.enum(['wayfinder', 'repair']),
    url: z.string().url()
  }).strict(),
  spec: z.string().url().nullable(),
  issues: z.array(z.string().url()).min(1),
  checks: z.array(z.object({
    command: text,
    status: z.literal('pass')
  }).strict()).min(1),
  local_review: z.object({
    status: z.literal('pass'),
    base: sha,
    head: sha
  }).strict(),
  touched_paths: z.array(text).min(1),
  risks: z.array(text),
  closeout_intent: CloseoutIntentSchema,
  remote_actions_performed: z.literal('none')
}).strict();

const AuthoritySchema = z.object({
  repo: text,
  source: text,
  target: text,
  review_item: z.object({
    id: text.nullable(),
    title: text
  }).strict(),
  push: z.literal(true),
  create_or_update: z.literal(true),
  max_review_items: z.literal(1),
  approve: z.literal(false),
  land: z.literal(false),
  close_issue: z.literal(false)
}).strict();

function mutationAudit() {
  return { requested: [], performed: [], readback: [] };
}

function blocked(error, audit) {
  return { success: false, error, mutation_audit: audit };
}

function issueText(error) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

async function readOnlyDiscovery(provider, input, audit) {
  try {
    const result = await provider.discover({
      repo: input.repo,
      source: input.source || null,
      target: input.target || null,
      item: input.authority?.review_item?.id || null,
      read_only: true
    });
    audit.readback.push({ operation: 'discover', result });
  } catch (error) {
    audit.readback.push({ operation: 'discover', error: issueText(error) });
  }
}

function validateProof(proof, input) {
  const parsed = SourceProofSchema.parse(proof);
  if (parsed.source !== input.source || parsed.target !== input.target) {
    throw new Error('source proof does not match the named source and target');
  }
  if (!parsed.clean) throw new Error('source proof is dirty');
  if (parsed.ahead_commits.length === 0) throw new Error('source proof is not ahead');
  if (parsed.behind !== 0 || parsed.base !== parsed.target_head) {
    throw new Error('source proof is stale against the live target');
  }
  if (parsed.ahead_commits.at(-1) !== parsed.head) {
    throw new Error('source proof ahead range does not end at head');
  }
  return parsed;
}

function validateHandoff(handoff, proof) {
  const parsed = HandoffSchema.parse(handoff);
  const identityMatches = parsed.source === proof.source
    && parsed.target === proof.target
    && parsed.base === proof.base
    && parsed.head === proof.head
    && JSON.stringify(parsed.ahead_commits) === JSON.stringify(proof.ahead_commits);
  if (!identityMatches) throw new Error('handoff source proof is stale or incomplete');
  if (parsed.local_review.base !== proof.base || parsed.local_review.head !== proof.head) {
    throw new Error('handoff local review is stale for the source proof');
  }
  if (!sameTextSet(parsed.touched_paths, proof.touched_paths)) {
    throw new Error('handoff touched paths do not match the source proof');
  }
  return parsed;
}

function validateAuthority(authority, input) {
  const parsed = AuthoritySchema.parse(authority);
  const matches = parsed.repo === input.repo
    && parsed.source === input.source
    && parsed.target === input.target;
  if (!matches) throw new Error('authority does not match named repo, source, and target');
  return parsed;
}

function requiredCapabilities(discovery) {
  if (!discovery?.auth_actor) throw new Error('authenticated actor is required');
  const capabilities = new Set(discovery.capability || []);
  if (!capabilities.has('push') || !capabilities.has('review-item-write')) {
    throw new Error('push and review-item-write capability are required');
  }
  if (!discovery.provider) throw new Error('authenticated provider identity is required');
}

function selectReviewItem(discovery, authority, input) {
  const sameSource = (discovery.items || []).filter((item) => (
    item.repo === input.repo && item.source === input.source
  ));
  if (sameSource.length > 1) throw new Error('multiple same-source review items found');
  const existing = sameSource[0] || null;
  if (existing && existing.target !== input.target) {
    throw new Error('same-source review item targets a different branch');
  }
  if (authority.review_item.id && existing?.id !== authority.review_item.id) {
    throw new Error('named review item does not match same-source discovery');
  }
  if (authority.review_item.id && !existing) {
    throw new Error('named review item was not found');
  }
  return existing;
}

function proofIdentity(proof) {
  return {
    source: proof.source,
    target: proof.target,
    target_head: proof.target_head,
    base: proof.base,
    head: proof.head,
    clean: proof.clean,
    behind: proof.behind,
    ahead_commits: proof.ahead_commits,
    touched_paths: proof.touched_paths
  };
}

function validateFreshProof(initial, current) {
  if (JSON.stringify(proofIdentity(initial)) !== JSON.stringify(proofIdentity(current))) {
    throw new Error('source or target changed during submit preflight');
  }
}

function validateReadback(readback, discovery, submitted, input, proof) {
  const required = ['provider', 'repo', 'id', 'url', 'source', 'target', 'head', 'auth_actor'];
  if (required.some((key) => !readback?.[key])) {
    throw new Error('authenticated provider readback is incomplete');
  }
  const matches = readback.provider === discovery.provider
    && readback.repo === input.repo
    && readback.id === submitted.id
    && readback.source === input.source
    && readback.target === input.target
    && readback.head === proof.head
    && readback.auth_actor === discovery.auth_actor;
  if (!matches) throw new Error('authenticated provider readback does not match submitted scope');
  if (typeof readback.draft !== 'boolean') throw new Error('provider readback draft state is missing');
  if (readback.draft) throw new Error('draft provider readback is not Review Ready');
}

function reviewRecord({ discovery, readback, handoff, proof }) {
  return createSubmitReviewItemRecord({
    provider: discovery.provider,
    repo: readback.repo,
    item: { id: readback.id, url: readback.url },
    source: readback.source,
    target: readback.target,
    head: readback.head,
    base: proof.base,
    auth_actor: readback.auth_actor,
    capability: discovery.capability,
    draft: readback.draft,
    approvals: null,
    unresolved_discussions: null,
    mergeability: null,
    protection_or_queue: null,
    ci_state: null,
    current_head_review: null,
    closeout_intent: handoff.closeout_intent,
    mutation_scope: {
      repo: readback.repo,
      source: readback.source,
      target: readback.target,
      item: readback.id,
      allowed: ['push', 'review-item:create-or-update']
    }
  });
}

function scopeBlocker(input) {
  if (!input.source) return 'source scope is required';
  if (!input.authority) return 'required authority for one review item is missing';
  return null;
}

async function attempt(operation) {
  try {
    return { value: await operation() };
  } catch (error) {
    return { error: issueText(error) };
  }
}

async function withContext(context, operation) {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${context}: ${issueText(error)}`);
  }
}

async function prepareInput(input) {
  const proof = await withContext('source proof', async () => (
    validateProof(await input.sourceReader(), input)
  ));
  const handoff = await withContext('handoff', async () => validateHandoff(input.handoff, proof));
  const authority = await withContext('authority', async () => (
    validateAuthority(input.authority, input)
  ));
  return { proof, handoff, authority };
}

async function discoverRemote(input, authority, proof, audit) {
  const discovery = await input.provider.discover({
    repo: input.repo,
    source: input.source,
    target: input.target,
    item: authority.review_item.id,
    read_only: true
  });
  audit.readback.push({ operation: 'discover', result: discovery });
  requiredCapabilities(discovery);
  const existing = selectReviewItem(discovery, authority, input);
  const currentProof = validateProof(await input.sourceReader(), input);
  validateFreshProof(proof, currentProof);
  return { discovery, existing };
}

function requestMutations(audit, input, proof, existing) {
  audit.requested.push(
    { operation: 'push', source: input.source, head: proof.head },
    { operation: existing ? 'update-review-item' : 'create-review-item', item: existing?.id || null }
  );
}

function mutationResult(operation, existing, submitted) {
  if (existing) return { operation, item: existing.id, result_item: submitted?.id || null };
  return { operation, item: submitted?.id || null };
}

async function writeReviewItem(input, authority, proof, existing, audit) {
  const scope = {
    repo: input.repo,
    source: input.source,
    target: input.target,
    head: proof.head,
    title: authority.review_item.title
  };
  const operation = existing ? 'update-review-item' : 'create-review-item';
  try {
    const submitted = existing
      ? await input.provider.updateReviewItem({ ...scope, item: existing })
      : await input.provider.createReviewItem(scope);
    audit.performed.push(mutationResult(operation, existing, submitted));
    return submitted;
  } catch (error) {
    audit.performed.push({ ...mutationResult(operation, existing), error: issueText(error) });
    throw error;
  }
}

function validateSubmittedItem(submitted, existing) {
  if (!submitted?.id) throw new Error('provider did not return the submitted review item');
  if (existing && submitted.id !== existing.id) {
    throw new Error('provider update switched the existing review item');
  }
}

async function performMutation(input, prepared, remote, audit) {
  const { authority, proof } = prepared;
  const { discovery, existing } = remote;
  await pushSource(input, proof, audit);
  const submitted = await writeReviewItem(input, authority, proof, existing, audit);
  validateSubmittedItem(submitted, existing);
  const readback = await input.provider.readReviewItem({ repo: input.repo, item: submitted });
  audit.readback.push({ operation: 'review-item', result: readback });
  validateReadback(readback, discovery, submitted, input, proof);
  return readback;
}

async function pushSource(input, proof, audit) {
  const call = { operation: 'push', source: input.source, head: proof.head };
  try {
    await input.provider.push({ repo: input.repo, source: input.source, head: proof.head });
    audit.performed.push(call);
  } catch (error) {
    audit.performed.push({ ...call, error: issueText(error) });
    throw error;
  }
}

function readyResult(prepared, remote, readback, audit) {
  const { handoff, proof } = prepared;
  return {
    success: true,
    record: reviewRecord({ discovery: remote.discovery, readback, handoff, proof }),
    evidence: { source_proof: proof, handoff },
    mutation_audit: audit
  };
}

async function submitRemoteReview(input) {
  const audit = mutationAudit();
  const scopeError = scopeBlocker(input);
  if (scopeError) {
    await readOnlyDiscovery(input.provider, input, audit);
    return blocked(`${scopeError}; discovery remained read-only`, audit);
  }
  const prepared = await attempt(() => prepareInput(input));
  if (prepared.error) return blocked(prepared.error, audit);
  const remote = await attempt(() => discoverRemote(
    input, prepared.value.authority, prepared.value.proof, audit
  ));
  if (remote.error) return blocked(remote.error, audit);
  requestMutations(audit, input, prepared.value.proof, remote.value.existing);
  const mutation = await attempt(() => performMutation(input, prepared.value, remote.value, audit));
  if (mutation.error) return blocked(mutation.error, audit);
  const ready = await attempt(() => readyResult(
    prepared.value, remote.value, mutation.value, audit
  ));
  return ready.error ? blocked(`record: ${ready.error}`, audit) : ready.value;
}

module.exports = {
  submitRemoteReview
};
