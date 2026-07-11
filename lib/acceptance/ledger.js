const crypto = require('crypto');
const { z } = require('zod');

const CATALOG_SCHEMA_VERSION = 1;
const CATALOG_ID_SET_SHA256 = '2aff02377bcb8fc50d3ebcbb2f1a382860da19780a83972a4df8c97e7efca2ab';
const TRUTH_TO_MAIN_SHA256 = 'da6fd4001d4976aa27942d180741667d0576672ce442a5d05a21ac0f09e26491';

const requiredText = (message) => z.string().trim().min(1, message);
const ExecutorSchema = z.object({
  runner: z.literal('jest'),
  assertions: z.array(z.object({
    file: requiredText('executor file is required'),
    full_name: requiredText('executor assertion name is required')
  }).strict()).min(1)
}).strict();

const CatalogRowSchema = z.object({
  acceptance_id: z.string().regex(/^DV-[A-Z]+-\d{3}$/),
  contract_sources: z.array(requiredText('contract source is required')).min(1),
  stage: requiredText('stage is required'),
  fixture: requiredText('fixture is required'),
  procedure: requiredText('procedure is required'),
  expected_evidence: z.object({
    durable: z.array(requiredText('durable evidence is required')).min(1),
    transient: z.array(requiredText('transient evidence is required'))
  }).strict(),
  pass_condition: requiredText('pass condition is required'),
  fail_or_blocked_condition: requiredText('failure condition is required'),
  false_green_prevented: requiredText('false-green semantics are required'),
  mutation_authority: requiredText('authority semantics are required'),
  owner: requiredText('owner semantics are required'),
  consumers: z.array(requiredText('consumer is required')).min(1),
  freshness_keys: z.array(requiredText('freshness key is required'))
    .min(1, 'freshness semantics are required'),
  execution_class: requiredText('execution class is required'),
  executor: ExecutorSchema.optional(),
  required: z.literal(true)
}).strict().superRefine((row, context) => {
  if (!/live/i.test(row.execution_class) && !row.executor) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executor'],
      message: 'local acceptance row requires a canonical executor'
    });
  }
});

const CatalogSchema = z.object({
  schema_version: z.literal(CATALOG_SCHEMA_VERSION),
  contract_source: z.string().url(),
  id_set_sha256: z.literal(CATALOG_ID_SET_SHA256),
  rows: z.array(CatalogRowSchema).min(1)
}).strict();

const OutcomeSchema = z.enum(['pass', 'fail', 'blocked', 'unknown', 'pending']);

const EvidenceRefSchema = z.object({
  kind: requiredText('evidence kind is required'),
  uri: requiredText('evidence URI is required'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

const MutationSchema = z.object({
  before_gate: z.unknown().nullable(),
  requested: z.array(z.unknown()),
  performed: z.array(z.unknown()),
  readback: z.array(z.unknown()),
  rollback_or_fix_forward_boundary: z.unknown().nullable()
}).strict();

const ResultSchema = z.object({
  acceptance_id: z.string().regex(/^DV-[A-Z]+-\d{3}$/),
  outcome: OutcomeSchema,
  started_at: z.string().datetime().nullable(),
  finished_at: z.string().datetime().nullable(),
  freshness: z.record(z.unknown()),
  authority: z.record(z.unknown()),
  evidence_refs: z.array(EvidenceRefSchema),
  mutation: MutationSchema
}).strict().superRefine((result, context) => {
  if (result.outcome === 'pending') return;
  const complete = result.started_at
    && result.finished_at
    && Object.keys(result.freshness).length
    && Object.keys(result.authority).length
    && result.evidence_refs.length;
  if (!complete) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'terminal result requires timestamps, freshness, authority, and evidence'
    });
  }
});

const MetadataSchema = z.object({
  run_id: requiredText('run ID is required'),
  created_at: z.string().datetime(),
  repo: requiredText('repo is required'),
  source_commit: requiredText('source commit is required'),
  artifact: z.object({
    name: requiredText('artifact name is required'),
    sha512: requiredText('artifact SHA-512 is required'),
    npm_integrity: requiredText('npm integrity is required')
  }).strict(),
  environment: z.object({
    node: requiredText('Node version is required'),
    npm: requiredText('npm version is required'),
    os: requiredText('OS is required'),
    host_versions: z.record(z.string())
  }).strict()
}).strict();

const RollupSchema = z.object({
  pass: z.number().int().nonnegative(),
  fail: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative()
}).strict();

const PacketSchema = MetadataSchema.extend({
  schema_version: z.literal(1),
  results: z.array(ResultSchema),
  rollup: RollupSchema
}).strict();

// ---------------------------------------------------------------------------
// Truth-to-Main 合同
// ---------------------------------------------------------------------------

function markerValues(markdown, name) {
  const pattern = new RegExp(`<!--\\s*dverity:${name}\\s+([^]*?)\\s*-->`, 'g');
  return [...markdown.matchAll(pattern)].map((match) => match[1].trim());
}

function chainHash(chain) {
  return crypto.createHash('sha256').update(`${JSON.stringify(chain)}\n`).digest('hex');
}

function parseChainMarker(markdown) {
  const markers = markerValues(markdown, 'truth-to-main');
  if (markers.length !== 1) return null;
  try {
    const chain = JSON.parse(markers[0]);
    return Array.isArray(chain) && chain.every((state) => typeof state === 'string') ? chain : null;
  } catch {
    return null;
  }
}

function visibleChains(markdown) {
  const blocks = [...markdown.matchAll(/```(?:text)?\s*\n([^]*?)```/g)];
  const inline = markdown.match(/[^\n]*(?:->[^\n]*){2,}/g) || [];
  return [...blocks.map((match) => match[1]), ...inline]
    .map((block) => block.split(/\s*->\s*/).map((state) => state.trim()))
    .filter((chain) => chain.length > 1);
}

function canonicalChainCount(markdown, chain) {
  if (!chain) return 0;
  const sequence = chain.map(escapeRegex).join('\\s*->\\s*');
  return [...markdown.matchAll(new RegExp(sequence, 'g'))].length;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateOwner(owner) {
  const errors = [];
  const chain = parseChainMarker(owner.content);
  if (!chain || chainHash(chain) !== TRUTH_TO_MAIN_SHA256) {
    errors.push('DVERITY.md must define exactly one canonical chain');
  }
  if (markerValues(owner.content, 'repair-terminal').join() !== 'Verified Local') {
    errors.push('Repair must default to Verified Local');
  }
  if (markerValues(owner.content, 'wayfinder-entry').join() !== 'Submit') {
    errors.push('Wayfinder must enter at Submit');
  }
  if (markerValues(owner.content, 'remote-promotion').join() !== 'explicit') {
    errors.push('Remote promotion must require explicit authority');
  }
  return { chain, errors };
}

function validateSurfaceCorpus(documents, chain) {
  const errors = [];
  const visible = documents.flatMap((document) => (
    visibleChains(document.content).map((candidate) => ({ ...document, chain: candidate }))
  ));
  const canonical = documents.flatMap((document) => (
    Array(canonicalChainCount(document.content, chain)).fill(document.path)
  ));
  if (canonical.length !== 1 || canonical[0] !== 'DVERITY.md') {
    errors.push('The full visible chain must exist only in DVERITY.md');
  }
  if (documents.slice(1).some((document) => markerValues(document.content, 'truth-to-main').length)) {
    errors.push('The full machine chain must exist only in DVERITY.md');
  }
  if (visible.some((candidate) => candidate.chain[0] === 'Repair'
    && candidate.chain.at(-1) === 'Verified Remote Main'
    && chainHash(candidate.chain) !== TRUTH_TO_MAIN_SHA256)) {
    errors.push('A visible Truth-to-Main chain does not match the canonical contract');
  }
  return chain ? errors : [];
}

function hasImplicitPromotion(markdown) {
  return markdown
    .split(/[.!?。！？\n]+/)
    .some((sentence) => isImplicitPromotionSentence(sentence));
}

function isImplicitPromotionSentence(sentence) {
  const relatesRepairToRemote = /\bRepair\b.*\b(?:Submit|remote)/i.test(sentence);
  const transitions = /\b(?:promot\w*|send\w*|advance\w*|continue\w*|move\w*|route\w*)\b/i
    .test(sentence);
  const explicit = /explicit\s+(?:remote\s+)?authority/i.test(sentence);
  const denied = /\b(?:does not|doesn't|never|will not|won't|must not)\s+(?:automatically\s+|implicitly\s+)?(?:promot\w*|send\w*|advance\w*|continue\w*|move\w*|route\w*)\b/i
    .test(sentence);
  return relatesRepairToRemote && transitions && !explicit && !denied;
}

function validateRouteCorpus(documents) {
  const errors = [];
  const rules = [
    ['repair-terminal', 'Verified Local', 'Repair must default to Verified Local'],
    ['wayfinder-entry', 'Submit', 'Wayfinder must enter at Submit'],
    ['remote-promotion', 'explicit', 'Remote promotion must require explicit authority']
  ];
  for (const [marker, expected, message] of rules) {
    const values = documents.flatMap((document) => markerValues(document.content, marker));
    if (values.some((value) => value !== expected)) errors.push(message);
  }
  if (documents.some((document) => hasImplicitPromotion(document.content))) {
    errors.push('Remote promotion must require explicit authority');
  }
  return errors;
}

function validateTruthToMainContract({ owner, surfaces = [] }) {
  const ownerResult = validateOwner(owner);
  const documents = [owner, ...surfaces];
  const errors = [
    ...ownerResult.errors,
    ...validateSurfaceCorpus(documents, ownerResult.chain),
    ...validateRouteCorpus(documents)
  ];

  return errors.length
    ? { success: false, error: errors.join('; ') }
    : validTruthToMain(ownerResult.chain);
}

function validTruthToMain(chain) {
  return {
    success: true,
    chain,
    repair_terminal: 'Verified Local',
    wayfinder_entry: 'Submit',
    remote_promotion: 'explicit'
  };
}

// ---------------------------------------------------------------------------
// Acceptance catalog 校验
// ---------------------------------------------------------------------------

function formatIssues(issues) {
  return issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

function acceptanceIdSetHash(ids) {
  const canonical = `${[...ids].sort().join('\n')}\n`;
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function validateCatalog(input) {
  const parsed = CatalogSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: formatIssues(parsed.error.issues) };
  }

  const ids = parsed.data.rows.map((row) => row.acceptance_id);
  if (new Set(ids).size !== ids.length) {
    return { success: false, error: 'duplicate acceptance ID' };
  }
  if (acceptanceIdSetHash(ids) !== CATALOG_ID_SET_SHA256) {
    return { success: false, error: 'catalog does not match the canonical acceptance ID set' };
  }

  return { success: true, data: parsed.data };
}

// ---------------------------------------------------------------------------
// 生成 acceptance packet
// ---------------------------------------------------------------------------

function pendingResult(acceptanceId) {
  return {
    acceptance_id: acceptanceId,
    outcome: 'pending',
    started_at: null,
    finished_at: null,
    freshness: {},
    authority: {},
    evidence_refs: [],
    mutation: {
      before_gate: null,
      requested: [],
      performed: [],
      readback: [],
      rollback_or_fix_forward_boundary: null
    }
  };
}

function rollup(results) {
  const counts = { pass: 0, fail: 0, blocked: 0, unknown: 0, pending: 0 };
  for (const result of results) counts[result.outcome] += 1;
  return counts;
}

function validatePacketInputs(catalog, metadata, results) {
  const validCatalog = validateCatalog(catalog);
  if (!validCatalog.success) return validCatalog;
  const validMetadata = MetadataSchema.safeParse(metadata);
  const validResults = z.array(ResultSchema).safeParse(results);
  if (!validMetadata.success || !validResults.success) {
    const issues = validMetadata.success ? validResults.error.issues : validMetadata.error.issues;
    return { success: false, error: formatIssues(issues) };
  }
  return { success: true, catalog: validCatalog.data, metadata: validMetadata.data, results: validResults.data };
}

function validateSuppliedIds(catalog, results) {
  const catalogIds = new Set(catalog.rows.map((row) => row.acceptance_id));
  const suppliedIds = results.map((result) => result.acceptance_id);
  if (new Set(suppliedIds).size !== suppliedIds.length) {
    return { success: false, error: 'duplicate executor result' };
  }
  if (suppliedIds.some((id) => !catalogIds.has(id))) {
    return { success: false, error: 'unexpected executor result' };
  }
  return { success: true };
}

function generateAcceptancePacket({ catalog, metadata, results }) {
  const inputs = validatePacketInputs(catalog, metadata, results);
  if (!inputs.success) return inputs;
  const suppliedIds = validateSuppliedIds(inputs.catalog, inputs.results);
  if (!suppliedIds.success) return suppliedIds;
  const supplied = new Map(inputs.results.map((result) => [result.acceptance_id, result]));
  const packetResults = inputs.catalog.rows.map((row) => (
    supplied.get(row.acceptance_id) || pendingResult(row.acceptance_id)
  ));
  const packet = PacketSchema.parse({
    schema_version: 1,
    ...inputs.metadata,
    results: packetResults,
    rollup: rollup(packetResults)
  });
  return { success: true, data: packet };
}

function canDeclareReleaseSuccess(packet) {
  const parsed = PacketSchema.safeParse(packet);
  if (!parsed.success) return false;

  const ids = parsed.data.results.map((result) => result.acceptance_id);
  if (new Set(ids).size !== ids.length || acceptanceIdSetHash(ids) !== CATALOG_ID_SET_SHA256) {
    return false;
  }

  const actual = rollup(parsed.data.results);
  if (JSON.stringify(actual) !== JSON.stringify(parsed.data.rollup)) return false;
  return actual.pass === ids.length
    && actual.fail === 0
    && actual.blocked === 0
    && actual.unknown === 0
    && actual.pending === 0;
}

module.exports = {
  CATALOG_ID_SET_SHA256,
  CatalogRowSchema,
  CatalogSchema,
  PacketSchema,
  ResultSchema,
  TRUTH_TO_MAIN_SHA256,
  acceptanceIdSetHash,
  canDeclareReleaseSuccess,
  generateAcceptancePacket,
  validateCatalog,
  validateTruthToMainContract,
};
