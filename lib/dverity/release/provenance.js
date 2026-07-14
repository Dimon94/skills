const { auditProviderMerge } = require('./release-readiness');

const SHA40 = /^[a-f0-9]{40}$/;
const MAIN = Object.freeze({
  pull: 86,
  merge: '5a8225e5346a93864176f4bdfaaa6e03919354ae',
  base: '2e468ffca1a45a0481ccf2f7e72b6d2a489951ec',
  source: '537c532191a3508725adf6349e92ceebed4de45f'
});
const HISTORY = Object.freeze([
  ['65', '71de4ac225729ab98ba94df49b0215b07cce7552'],
  ['66', 'af741d81eea7d48241b76f5d144a7132d00cbb5a'],
  ['67', '38c67e978392b8fde0e65f352c79e8edd111501f'],
  ['71', '79cb3a407a15c6dc0bff8f6c4c057040b7b1d29b'],
  ['68', 'af0c07da219ece6d16ad3fd96b93e3d5ddc9fdcd'],
  ['69', '548827700959f0a90484e2b8cbc4c78e3a5711c5'],
  ['72', 'cea3926b5cb3e78076b36f88d9c856195274941a'],
  ['70', 'f2feb534ae0366ccdda1557ab67f0e9db9dbdebf'],
  ['72', 'a8a354193e26e7ef9dcfa16cc7ade77f0f5aad50'],
  ['75', '80156f02aa753680191c49d09e65cb9534601f7d'],
  ['73', 'f9ec3c4905466594bdc809a10c34dd4f2a9504f5'],
  ['74', '101a95f835d924af3e29f1c7cc26eb31aa926c5c'],
  ['76', 'c3ce31c8b08f6480bf18a76dd69ff6f61de55a4f'],
  ['77', 'fd0ece68af69ae032eced3f2b29304577fdfbd7f'],
  ['78', 'c4c43027b060645cdb1d5cfb5b49828dc09a74a2'],
  ['82', 'cb31ad83c2ec1e6eb0a90fbd0ff0b32e4fca30b2'],
  ['84', MAIN.source],
  ['79', MAIN.merge],
  ['88', '4b7314f6218eaa3576df3f6ad400b31b478d72c8'],
  ['80', '76c2a19470951c4581175ff10a6721014c42965f']
].map(Object.freeze));

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return Object.freeze(value);
}

const RELEASE_PROVENANCE = deepFreeze({
  provider: 'github',
  repository: 'Dimon94/dverity',
  main: MAIN,
  integration: {
    target: 'origin/main',
    current_issue: 87,
    history: HISTORY
  }
});

function deliveredIssues(history) {
  return [...new Set(history.map(([issue]) => Number(issue)))]
    .sort((left, right) => left - right);
}

function providerMain(run) {
  const coordinates = RELEASE_PROVENANCE.main;
  const parents = run('git', ['show', '-s', '--format=%P', coordinates.merge]).split(' ');
  const mergeTree = run('git', ['rev-parse', `${coordinates.merge}^{tree}`]);
  const sourceTree = run('git', ['rev-parse', `${coordinates.source}^{tree}`]);
  const pull = JSON.parse(run('gh', [
    'api', `repos/${RELEASE_PROVENANCE.repository}/pulls/${coordinates.pull}`
  ]));
  const audit = auditProviderMerge({
    repository: RELEASE_PROVENANCE.repository,
    pullNumber: coordinates.pull,
    merge: coordinates.merge,
    expectedBase: coordinates.base,
    expectedHead: coordinates.source,
    parents,
    mergeTree,
    sourceTree,
    pull
  });
  if (!audit.success) throw new Error(audit.error);
  return {
    ...coordinates,
    parents,
    trees: { merge: mergeTree, source: sourceTree, equal: true }
  };
}

function integrationValue(input, main, run) {
  if (!input) return null;
  const { current_issue: currentIssue, target } = RELEASE_PROVENANCE.integration;
  const expectedBranch = new RegExp(`^codex/issue-${currentIssue}(?:-|$)`);
  if (!expectedBranch.test(input.branch || '')) {
    throw new Error('release integration branch does not match the current issue');
  }
  if (!SHA40.test(input.base || '') || !SHA40.test(input.head || '')) {
    throw new Error('release integration base/head provenance is invalid');
  }
  run('git', ['merge-base', '--is-ancestor', main.merge, input.base]);
  if (!Array.isArray(input.commits) || input.commits.length !== 1
    || input.commits[0] !== input.head) {
    throw new Error('release integration history must be one semantic current-head commit');
  }
  const history = [...RELEASE_PROVENANCE.integration.history, [String(currentIssue), input.head]];
  return {
    current_issue: currentIssue,
    branch: input.branch,
    target,
    base: input.base,
    head: input.head,
    commits: [...input.commits],
    history,
    delivered_issues: deliveredIssues(history)
  };
}

function collectReleaseProvenance({ run, integration } = {}) {
  if (typeof run !== 'function') throw new Error('authenticated provider runner is required');
  const main = providerMain(run);
  return deepFreeze({
    provider: RELEASE_PROVENANCE.provider,
    repository: RELEASE_PROVENANCE.repository,
    main,
    integration: integrationValue(integration, main, run)
  });
}

function assertIntegrationProvenance(value, proof) {
  const integration = value?.integration;
  if (!integration) throw new Error('release integration provenance is required');
  const lines = proof.commit_lines || [];
  if (proof.dirty || proof.target_only !== 0
    || proof.head_only !== integration.commits.length) {
    throw new Error('release integration must be clean and strictly ahead of current main');
  }
  let parent = integration.base;
  for (const [index, line] of lines.entries()) {
    const [commit, ...parents] = line.split(' ');
    if (parents.length !== 1 || parents[0] !== parent
      || commit !== integration.commits[index]) {
      throw new Error('release integration commits must be strict single-parent descendants');
    }
    parent = commit;
  }
  if (parent !== integration.head || lines.length !== integration.commits.length) {
    throw new Error('release integration history does not bind the current head');
  }
  return value;
}

module.exports = {
  RELEASE_PROVENANCE,
  assertIntegrationProvenance,
  collectReleaseProvenance
};
