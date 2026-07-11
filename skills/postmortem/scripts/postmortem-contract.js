const fs = require('fs');
const path = require('path');

const RECALL_TRIGGERS = new Set([
  'recurrence',
  'failed-verification',
  'review-escape'
]);

function decidePostmortem({ trigger, root_cause_status: rootCauseStatus, reusable }) {
  const confirmedReusable = trigger === 'confirmed-reusable-lesson'
    && rootCauseStatus === 'confirmed'
    && reusable === true;
  const directRecord = trigger === 'review-escape' || trigger === 'explicit-request';
  return {
    status: 'ready',
    recall: RECALL_TRIGGERS.has(trigger),
    record: confirmedReusable || directRecord
  };
}

function rejectSymlink(target) {
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new Error(`evidence path cannot be a symlink: ${target}`);
  }
}

function evidenceTarget(projectRoot, slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '')) {
    throw new Error('postmortem slug must be lowercase kebab-case');
  }
  const root = fs.realpathSync(projectRoot);
  const docs = path.join(root, 'docs');
  const parent = path.join(docs, 'postmortems');
  const target = path.join(parent, `${slug}.md`);
  [docs, parent, target].forEach(rejectSymlink);
  return { root, target };
}

function createParent({ root, target }) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const relative = path.relative(root, fs.realpathSync(path.dirname(target)));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('evidence path is outside project root');
  }
}

function recordPostmortem({ projectRoot, decision, slug, markdown }) {
  if (decision?.record !== true) return { written: false, path: null };
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new Error('postmortem markdown is required');
  }
  const evidence = evidenceTarget(projectRoot, slug);
  createParent(evidence);
  fs.writeFileSync(evidence.target, markdown);
  return { written: true, path: evidence.target };
}

module.exports = {
  decidePostmortem,
  recordPostmortem
};
