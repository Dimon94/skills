const { z } = require('zod');

const REVIEW_ITEM_RECORD_FIELDS = [
  'provider',
  'repo',
  'item',
  'source',
  'target',
  'head',
  'base',
  'auth_actor',
  'capability',
  'draft',
  'approvals',
  'unresolved_discussions',
  'mergeability',
  'protection_or_queue',
  'ci_state',
  'current_head_review',
  'closeout_intent',
  'mutation_scope'
];

const requiredText = z.string().trim().min(1);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const ReviewRecordSchema = z.object({
  schema_version: z.literal(1),
  provider: requiredText,
  repo: requiredText,
  item: z.object({ id: requiredText, url: z.string().url() }).strict(),
  head: sha,
  task_session: requiredText,
  facets: z.array(requiredText).min(1),
  findings: z.array(z.unknown()),
  verdict: z.enum(['pass', 'fail', 'blocked', 'unknown']),
  mode: z.enum(['fresh', 'carry-forward']),
  carried_from: requiredText.nullable(),
  read_only: z.literal(true)
}).strict();
const CloseoutIntentSchema = z.array(z.object({
  issue: requiredText,
  action: requiredText
}).strict());

const ReviewItemRecordSchema = z.object({
  provider: requiredText,
  repo: requiredText,
  item: z.object({
    id: requiredText,
    url: z.string().url()
  }).strict(),
  source: requiredText,
  target: requiredText,
  head: requiredText,
  base: requiredText,
  auth_actor: requiredText,
  capability: z.array(requiredText).min(1),
  draft: z.boolean(),
  approvals: z.unknown().nullable(),
  unresolved_discussions: z.unknown().nullable(),
  mergeability: z.unknown().nullable(),
  protection_or_queue: z.unknown().nullable(),
  ci_state: z.unknown().nullable(),
  current_head_review: z.unknown().nullable(),
  closeout_intent: CloseoutIntentSchema,
  mutation_scope: z.object({
    repo: requiredText,
    source: requiredText,
    target: requiredText,
    item: requiredText,
    allowed: z.array(requiredText).min(1)
  }).strict()
}).strict().superRefine((record, context) => {
  if (new Set(record.capability).size !== record.capability.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate capability' });
  }
  if (new Set(record.mutation_scope.allowed).size !== record.mutation_scope.allowed.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate mutation scope' });
  }
});

function createReviewItemRecord(input) {
  return ReviewItemRecordSchema.parse(input);
}

function sameTextSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function sameReviewItemIdentity(left, right) {
  return left.provider === right.provider
    && left.repo === right.repo
    && left.item.id === right.item.id
    && left.item.url === right.item.url
    && left.source === right.source
    && left.target === right.target;
}

function parseBoundReview(review, record) {
  const parsed = ReviewRecordSchema.parse(review);
  const matches = parsed.provider === record.provider
    && parsed.repo === record.repo
    && parsed.item.id === record.item.id
    && parsed.item.url === record.item.url
    && parsed.head === record.head;
  if (!matches) {
    throw new Error('Independent Review is not bound to the current item, head, and task session');
  }
  return parsed;
}

function createSubmitReviewItemRecord(input) {
  const record = createReviewItemRecord(input);
  if (record.current_head_review !== null) {
    throw new Error('Submit must not own current-head review');
  }
  return record;
}

module.exports = {
  CloseoutIntentSchema,
  REVIEW_ITEM_RECORD_FIELDS,
  ReviewRecordSchema,
  createReviewItemRecord,
  createSubmitReviewItemRecord,
  parseBoundReview,
  sameReviewItemIdentity,
  sameTextSet
};
