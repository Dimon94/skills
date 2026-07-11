const path = require('path');
const { z } = require('zod');
const { inspectOwnership, resolveScope } = require('../lifecycle');

const text = z.string().trim().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const hostSet = z.array(z.enum(['agents', 'claude'])).length(2).refine(
  (hosts) => new Set(hosts).size === 2,
  'hosts must contain agents and claude exactly once'
);

const DownstreamEntrySchema = z.object({
  id: text,
  enabled: z.boolean(),
  target: z.object({
    provider: z.enum(['github', 'gitlab']),
    repo: text,
    branch: text
  }).strict(),
  install_root: text.refine(path.isAbsolute, 'install_root must be absolute'),
  hosts: hostSet,
  owner_evidence: z.object({ uri: z.string().url(), sha256 }).strict(),
  source: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), hash: sha256 }).strict(),
  sync: z.object({ method: text }).strict(),
  readback: z.object({ method: text }).strict()
}).strict();

const TargetProofSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  repo: text,
  branch: text,
  auth_actor: text,
  capability: z.array(text)
}).strict();

const OwnerProofSchema = z.object({
  uri: z.string().url(),
  sha256,
  verified: z.literal(true)
}).strict();

const ReadbackSchema = z.object({
  provider: z.enum(['github', 'gitlab']),
  repo: text,
  branch: text,
  source_hash: sha256,
  status: z.literal('current'),
  receipt: text
}).strict();

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateTarget(entry, proof) {
  const parsed = TargetProofSchema.parse(proof);
  if (!sameJson(entry.target, pickTarget(parsed))) {
    throw new Error('authenticated target proof mismatch');
  }
  if (!parsed.capability.includes('downstream-sync')) {
    throw new Error('downstream-sync capability is required');
  }
  return parsed;
}

function pickTarget(value) {
  return { provider: value.provider, repo: value.repo, branch: value.branch };
}

function validateOwner(entry, proof) {
  const parsed = OwnerProofSchema.parse(proof);
  if (!sameJson(parsed, { ...entry.owner_evidence, verified: true })) {
    throw new Error('owner evidence proof mismatch');
  }
}

function validateManifest(entry, manifest) {
  const roots = (manifest?.projections || []).map(({ root }) => root).sort();
  const expectedRoots = entry.hosts.map((host) => `.${host}/skills`).sort();
  const matches = manifest?.package?.name === 'dverity'
    && manifest?.package?.version === entry.source.version
    && manifest?.source?.hash === entry.source.hash
    && sameJson(roots, expectedRoots);
  if (!matches) throw new Error('downstream one-root ownership proof mismatch');
  return manifest;
}

function validateReadback(entry, receipt, value) {
  const parsed = ReadbackSchema.parse(value);
  const matches = sameJson(entry.target, pickTarget(parsed))
    && parsed.source_hash === entry.source.hash
    && parsed.receipt === receipt.receipt;
  if (!matches) throw new Error('downstream readback does not match named entry');
  return parsed;
}

function issueText(error) {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

async function authorize(entry, dependencies) {
  const target = validateTarget(entry, await dependencies.target.read(entry));
  validateOwner(entry, await dependencies.ownership.readOwnerEvidence(entry));
  const inspectManifest = dependencies.ownership.inspectManifest
    || ((root) => inspectOwnership(resolveScope(['--project', root])));
  const manifest = validateManifest(entry, inspectManifest(entry.install_root));
  const sync = dependencies.syncMethods?.[entry.sync.method];
  const readback = dependencies.readbackMethods?.[entry.readback.method];
  if (!sync || !readback) throw new Error('named sync and readback methods are required');
  return { target, manifest, sync, readback };
}

async function performSync(entry, authorized, audit) {
  const { target, manifest, sync } = authorized;
  audit.requested.push({ entry: entry.id, operation: entry.sync.method });
  try {
    const receipt = await sync({ entry, target, manifest });
    audit.performed.push({ entry: entry.id, operation: entry.sync.method, receipt: receipt.receipt });
    return { receipt };
  } catch (error) {
    return { result: { id: entry.id, outcome: 'fail', reason: issueText(error) } };
  }
}

async function proveSync(entry, authorized, receipt, audit) {
  const { target, manifest, readback } = authorized;
  try {
    const value = await readback({ entry, target, manifest, receipt });
    const proof = validateReadback(entry, receipt, value);
    audit.readback.push({ entry: entry.id, status: proof.status, receipt: proof.receipt });
    return { id: entry.id, outcome: 'success', readback: proof };
  } catch (error) {
    return { id: entry.id, outcome: 'unknown', reason: issueText(error) };
  }
}

async function runEntry(entry, dependencies, audit) {
  if (!entry.enabled) return { id: entry.id, outcome: 'blocked', reason: 'entry is disabled' };
  let authorized;
  try {
    authorized = await authorize(entry, dependencies);
  } catch (error) {
    return { id: entry.id, outcome: 'blocked', reason: issueText(error) };
  }
  const mutation = await performSync(entry, authorized, audit);
  return mutation.result || proveSync(entry, authorized, mutation.receipt, audit);
}

function resultPacket(results, audit) {
  const rollup = { success: 0, fail: 0, blocked: 0, unknown: 0 };
  results.forEach((result) => { rollup[result.outcome] += 1; });
  return {
    success: rollup.fail + rollup.blocked + rollup.unknown === 0,
    terminal: results.length ? 'completed' : 'no-op',
    results,
    rollup,
    mutation_audit: audit
  };
}

async function runDownstreamSync(input) {
  const { plan } = input;
  if (!Array.isArray(plan)) throw new Error('managed downstream plan must be an array');
  const entries = plan.map((entry) => DownstreamEntrySchema.parse(entry));
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw new Error('managed downstream entry IDs must be unique');
  }
  const audit = { requested: [], performed: [], readback: [] };
  const results = [];
  for (const entry of entries) results.push(await runEntry(entry, input, audit));

  return resultPacket(results, audit);
}

module.exports = { DownstreamEntrySchema, runDownstreamSync };
