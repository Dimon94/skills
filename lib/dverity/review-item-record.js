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
  createReviewItemRecord,
  createSubmitReviewItemRecord
};
