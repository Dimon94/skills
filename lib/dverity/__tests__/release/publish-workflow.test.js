const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');
const { auditArtifactFreeze } = require('../../release/release-readiness');

const ROOT = path.resolve(__dirname, '../../../..');
const WORKFLOW = path.join(ROOT, '.github/workflows/publish-dverity.yml');
const publisher = require('../../../../scripts/publish-dverity');
const { RELEASE_PROVENANCE } = require('../../release/provenance');
const {
  merge: CHECKPOINT,
  base: CHECKPOINT_BASE,
  source: CHECKPOINT_SOURCE
} = RELEASE_PROVENANCE.main;

describe('Dverity provenance publish workflow', () => {
  const source = () => fs.readFileSync(WORKFLOW, 'utf8');
  const workflow = () => yaml.load(source());

  test('is manual-only with exact OIDC permissions on a GitHub-hosted runner', () => {
    const value = workflow();
    expect(Object.keys(value.on)).toEqual(['workflow_dispatch']);
    expect(value.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(value.jobs.publish['runs-on']).toBe('ubuntu-24.04');
    expect(source()).not.toMatch(/^\s*(push|schedule|release|pull_request_target):/m);
  });

  test('pins Node and npm, disables cache, and wires only the publish step secret', () => {
    const text = source();
    expect(text).toContain('node-version: 24.4.1');
    expect(text).toContain('npm@11.5.1');
    expect(text).not.toMatch(/cache:/);
    expect(text.match(/secrets\.NPM_TOKEN/g)).toHaveLength(1);
    expect(text).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');
    expect(text.match(/GH_TOKEN: \$\{\{ github\.token \}\}/g)).toHaveLength(3);
    expect(text).toContain('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1');
    expect(text).toContain('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0');
    expect(text).not.toMatch(/uses:\s+actions\/(checkout|setup-node)@(v|main|master)/);
  });

  test('runs required gates and publishes only through the exact-artifact helper', () => {
    const text = source();
    for (const command of [
      'npm test -- --runInBand', 'npm run verify:publish', 'npm audit --omit=dev',
      'node scripts/publish-dverity.js resolve', 'node scripts/publish-dverity.js freeze',
      'node scripts/publish-dverity.js publish'
    ]) expect(text).toContain(command);
    expect(text).not.toMatch(/npm publish\s+(\.|\$\{?\w)/);
    expect(text).toContain('--access public --tag latest --provenance');
    expect(source().match(/--tag latest/g)).toHaveLength(1);
  });

  test('installs dependencies before loading the resolver on a clean runner', () => {
    const steps = workflow().jobs.publish.steps;
    const stepIndex = (name) => steps.findIndex((step) => step.name === name);
    const installs = steps
      .map((step, index) => ({ index, run: step.run }))
      .filter((step) => step.run === 'npm ci');
    expect(installs).toHaveLength(2);
    expect(installs[0].index).toBeLessThan(stepIndex('Resolve provider-proven frozen source'));
    expect(stepIndex('Resolve provider-proven frozen source'))
      .toBeLessThan(stepIndex('Check out provider-proven frozen source'));
    expect(stepIndex('Check out provider-proven frozen source')).toBeLessThan(installs[1].index);
  });
});

describe('Dverity exact artifact publisher', () => {
  const SHA = CHECKPOINT_SOURCE;
  const MAIN = CHECKPOINT;
  let root;
  let metadata;
  let calls;
  let run;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-publish-test-'));
    const tarball = path.join(root, 'dverity-5.0.0.tgz');
    fs.writeFileSync(tarball, 'exact artifact');
    const bytes = fs.readFileSync(tarball);
    const sha512 = require('crypto').createHash('sha512').update(bytes).digest('hex');
    const integrity = `sha512-${require('crypto').createHash('sha512').update(bytes).digest('base64')}`;
    metadata = {
      source_commit: SHA, source_clean: true, artifact_paths: [tarball],
      name: path.basename(tarball), size: bytes.length, sha512, npm_integrity: integrity,
      inventory: [{ path: 'package.json', size: 1, mode: 420, sha256: 'a'.repeat(64) }],
      repack: { sha512, npm_integrity: integrity, byte_identical: true },
      procedure: ['pack once', 'pack twice'],
      tools: { node: 'v24.4.1', npm: '11.5.1', git: '2.52.0', tar: '3.5.3', gh: '2.74.2' }
    };
    fs.writeFileSync(path.join(root, 'artifact-freeze.json'), JSON.stringify(metadata));
    calls = [];
    run = (command, args, options = {}) => {
      calls.push({ command, args, env: options.env });
      const key = [command, ...args].join(' ');
      const answers = {
        'git rev-parse HEAD': SHA,
        'git rev-parse origin/main': MAIN,
        [`git show -s --format=%P ${CHECKPOINT}`]: `${CHECKPOINT_BASE} ${CHECKPOINT_SOURCE}`,
        [`git rev-parse ${CHECKPOINT}^{tree}`]: 'c'.repeat(40),
        [`git rev-parse ${CHECKPOINT_SOURCE}^{tree}`]: 'c'.repeat(40),
        'gh api repos/Dimon94/dverity/pulls/86': JSON.stringify({
          number: 86, merge_commit_sha: CHECKPOINT, merged_at: 'now',
          base: { ref: 'main', sha: CHECKPOINT_BASE, repo: { full_name: 'Dimon94/dverity' } },
          head: { sha: CHECKPOINT_SOURCE }
        }),
        'gh api repos/Dimon94/dverity/git/ref/heads/main --jq .object.sha': MAIN,
        'git status --porcelain=v1 --untracked-files=all': '',
        'gh api repos/Dimon94/dverity --jq .default_branch': 'main',
        [`tar -xOf ${tarball} package/package.json`]: JSON.stringify({
          name: 'dverity', version: '5.0.0', repository: { url: 'git+https://github.com/Dimon94/dverity.git' }
        }),
        [`npm publish ${tarball} --access public --tag latest --provenance`]: ''
      };
      if (!(key in answers)) throw new Error(`unexpected command: ${key}`);
      return answers[key];
    };
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function env(change = {}) {
    return {
      ...process.env,
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'Dimon94/dverity',
      GITHUB_REF: 'refs/heads/main', GITHUB_SHA: MAIN, NODE_AUTH_TOKEN: 'present',
      ...change
    };
  }

  test('publishes the frozen exact artifact with provenance after all gates pass', () => {
    publisher.publishFrozen({ metadataPath: path.join(root, 'artifact-freeze.json'), env: env(), run });
    expect(calls.at(-1)).toEqual(expect.objectContaining({
      command: 'npm',
      args: ['publish', metadata.artifact_paths[0], '--access', 'public', '--tag', 'latest', '--provenance'],
      env: expect.objectContaining({ NODE_AUTH_TOKEN: 'present' })
    }));
    expect(calls.at(-1).env).not.toHaveProperty('GH_TOKEN');
    expect(calls.at(-1).env).not.toHaveProperty('GITHUB_TOKEN');
    expect(calls.slice(0, -1).every((call) => !('NODE_AUTH_TOKEN' in call.env))).toBe(true);
  });

  test('freezes the workflow artifact through the canonical audited record', () => {
    const metadataPath = publisher.metadataPathFor(SHA);
    fs.rmSync(path.dirname(metadataPath), { recursive: true, force: true });
    try {
      publisher.freeze({ env: env(), run });
      const record = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      expect(auditArtifactFreeze(record).success).toBe(true);
      expect(record).toEqual(expect.objectContaining({
        inventory: expect.any(Array), repack: expect.any(Object), tools: expect.any(Object)
      }));
    } finally {
      fs.rmSync(path.dirname(metadataPath), { recursive: true, force: true });
    }
  });

  test.each([
    ['automatic trigger', { GITHUB_EVENT_NAME: 'push' }],
    ['wrong repository', { GITHUB_REPOSITORY: 'Dimon94/cc-devflow' }],
    ['wrong ref', { GITHUB_REF: 'refs/heads/feature' }],
    ['wrong selected commit', { GITHUB_SHA: 'f'.repeat(40) }],
    ['missing secret', { NODE_AUTH_TOKEN: undefined }],
    ['empty secret', { NODE_AUTH_TOKEN: '   ' }]
  ])('makes zero publish calls for %s', (_name, change) => {
    expect(() => publisher.publishFrozen({ metadataPath: path.join(root, 'artifact-freeze.json'), env: env(change), run })).toThrow();
    expect(calls.filter((call) => call.command === 'npm' && call.args[0] === 'publish')).toHaveLength(0);
  });

  test('makes zero publish calls when checked-out HEAD differs from the selected commit', () => {
    const wrongHead = (command, args) => (
      command === 'git' && args.join(' ') === 'rev-parse HEAD' ? 'b'.repeat(40) : run(command, args)
    );
    expect(() => publisher.publishFrozen({ metadataPath: path.join(root, 'artifact-freeze.json'), env: env(), run: wrongHead })).toThrow();
    expect(calls.filter((call) => call.command === 'npm' && call.args[0] === 'publish')).toHaveLength(0);
  });

  test.each([
    ['digest drift', (record) => { record.sha512 = 'b'.repeat(128); }],
    ['integrity drift', (record) => { record.npm_integrity = 'sha512-invalid'; }],
    ['caller-forged C', (record) => { record.source_commit = 'b'.repeat(40); }],
    ['directory publish', (record) => { record.artifact_paths = [root]; }]
  ])('makes zero publish calls for %s', (_name, mutate) => {
    mutate(metadata);
    fs.writeFileSync(path.join(root, 'artifact-freeze.json'), JSON.stringify(metadata));
    expect(() => publisher.publishFrozen({ metadataPath: path.join(root, 'artifact-freeze.json'), env: env(), run })).toThrow();
    expect(calls.filter((call) => call.command === 'npm' && call.args[0] === 'publish')).toHaveLength(0);
  });

  test.each([
    ['query failure', () => { throw new Error('provider unavailable'); }],
    ['wrong version', (command, args) => command === 'tar' ? '{"name":"dverity","version":"5.0.1","repository":{"url":"git+https://github.com/Dimon94/dverity.git"}}' : run(command, args)],
    ['wrong package repository', (command, args) => command === 'tar' ? '{"name":"dverity","version":"5.0.0","repository":{"url":"git+https://github.com/other/repo.git"}}' : run(command, args)]
  ])('makes zero publish calls for %s', (_name, failingRun) => {
    expect(() => publisher.publishFrozen({ metadataPath: path.join(root, 'artifact-freeze.json'), env: env(), run: failingRun })).toThrow();
    expect(calls.filter((call) => call.command === 'npm' && call.args[0] === 'publish')).toHaveLength(0);
  });

  test('requires the canonical artifact freeze schema before any publish call', () => {
    expect(auditArtifactFreeze(metadata).success).toBe(true);
    for (const field of ['inventory', 'repack', 'tools']) {
      const invalid = { ...metadata };
      delete invalid[field];
      fs.writeFileSync(path.join(root, 'artifact-freeze.json'), JSON.stringify(invalid));
      expect(() => publisher.publishFrozen({ metadataPath: path.join(root, 'artifact-freeze.json'), env: env(), run })).toThrow();
    }
    expect(calls.filter((call) => call.command === 'npm' && call.args[0] === 'publish')).toHaveLength(0);
  });
});

describe('Dverity provider-proven frozen source', () => {
  const M = CHECKPOINT;
  const C = CHECKPOINT_SOURCE;
  const TREE = 'd'.repeat(40);

  function proof(change = {}) {
    const values = {
      defaultBranch: 'main', currentMain: M,
      parents: `${CHECKPOINT_BASE} ${C}`,
      mergeTree: TREE, sourceTree: TREE,
      pull: { number: 86, merged_at: 'now', merge_commit_sha: M,
        base: { ref: 'main', sha: CHECKPOINT_BASE, repo: { full_name: 'Dimon94/dverity' } },
        head: { sha: C } },
      ...change
    };
    return (command, args) => {
      const key = [command, ...args].join(' ');
      const answers = {
        'gh api repos/Dimon94/dverity --jq .default_branch': values.defaultBranch,
        'gh api repos/Dimon94/dverity/git/ref/heads/main --jq .object.sha': values.liveMain || M,
        'gh api repos/Dimon94/dverity/pulls/86': JSON.stringify(values.pull),
        'git rev-parse origin/main': values.currentMain,
        [`git show -s --format=%P ${M}`]: values.parents,
        [`git rev-parse ${M}^{tree}`]: values.mergeTree,
        [`git rev-parse ${C}^{tree}`]: values.sourceTree
      };
      if (!(key in answers)) throw new Error(`unexpected command: ${key}`);
      return answers[key];
    };
  }

  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'Dimon94/dverity',
    GITHUB_REF: 'refs/heads/main', GITHUB_SHA: M };

  test('derives C from the provider-verified current-main merge M', () => {
    expect(publisher.resolveFrozenSource({ env, run: proof() })).toBe(C);
  });

  test.each([
    ['stale main', { currentMain: 'f'.repeat(40) }],
    ['wrong parent order', { parents: `${C} ${CHECKPOINT_BASE}` }],
    ['octopus merge', { parents: `${CHECKPOINT_BASE} ${C} ${'f'.repeat(40)}` }],
    ['squash/rebase', { parents: CHECKPOINT_BASE }],
    ['PR head mismatch', { pull: { number: 86 } }],
    ['tree mismatch', { sourceTree: 'f'.repeat(40) }],
    ['checkpoint drift', { parents: `${'f'.repeat(40)} ${C}` }],
    ['API failure', { pull: null }]
  ])('rejects %s', (_name, change) => {
    const run = change.pull === null ? () => { throw new Error('API unavailable'); } : proof(change);
    expect(() => publisher.resolveFrozenSource({ env, run })).toThrow();
  });

  test('rejects provider live main advancing while local origin/main remains stale', () => {
    expect(() => publisher.resolveFrozenSource({ env, run: proof({ liveMain: 'f'.repeat(40) }) }))
      .toThrow(/live main/i);
  });
});

describe('Dverity publish CLI fail-closed boundary', () => {
  const M = CHECKPOINT;
  const C = CHECKPOINT_SOURCE;
  let sandbox;
  let recorder;
  let metadataDir;
  let record;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-cli-'));
    recorder = path.join(sandbox, 'publish.log');
    metadataDir = publisher.metadataPathFor(C);
    fs.rmSync(path.dirname(metadataDir), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(metadataDir), { recursive: true });
    const tarball = path.join(path.dirname(metadataDir), 'dverity-5.0.0.tgz');
    fs.writeFileSync(tarball, 'artifact');
    const bytes = fs.readFileSync(tarball);
    const sha512 = require('crypto').createHash('sha512').update(bytes).digest('hex');
    const integrity = `sha512-${require('crypto').createHash('sha512').update(bytes).digest('base64')}`;
    record = {
      source_commit: C, source_clean: true, artifact_paths: [tarball], name: path.basename(tarball),
      size: bytes.length, sha512, npm_integrity: integrity,
      inventory: [{ path: 'package.json', size: 1, mode: 420, sha256: 'e'.repeat(64) }],
      repack: { sha512, npm_integrity: integrity, byte_identical: true },
      procedure: ['pack one', 'pack two'], tools: { node: 'v24', npm: '11', git: '2', tar: '3' }
    };
    fs.writeFileSync(metadataDir, JSON.stringify(record));
    const fake = path.join(sandbox, 'fake.js');
    fs.writeFileSync(fake, `#!/usr/bin/env node
const fs=require('fs'),path=require('path'); const cmd=process.env.FAKE_COMMAND||path.basename(process.argv[1]), a=process.argv.slice(2).join(' ');
const M='${M}',C='${C}',K='${CHECKPOINT}',B='${CHECKPOINT_BASE}',O='${CHECKPOINT_SOURCE}', repo='Dimon94/dverity';
{
 if(a==='api repos/'+repo+' --jq .default_branch') { console.log('main'); process.exit(0); }
 if(a==='api repos/'+repo+'/git/ref/heads/main --jq .object.sha') { console.log(process.env.FAKE_CASE==='live-malformed'?'{':M); process.exit(0); }
 if(a==='api repos/'+repo+'/pulls/86') { if(process.env.FAKE_CASE==='pr-failure') process.exit(1); console.log(JSON.stringify({number:86,merge_commit_sha:M,merged_at:'now',base:{ref:'main',sha:B,repo:{full_name:repo}},head:{sha:C}})); process.exit(0); }
}
{
 const out={['rev-parse origin/main']:M,['show -s --format=%P '+M]:B+' '+C,['rev-parse '+M+'^{tree}']:'${'2'.repeat(40)}',['rev-parse '+C+'^{tree}']:'${'2'.repeat(40)}',['rev-parse HEAD']:C,['status --porcelain=v1 --untracked-files=all']:''}; if(a in out){console.log(out[a]);process.exit(0)}
}
if(a.startsWith('publish ')){fs.appendFileSync(process.env.RECORDER,'publish\\n');process.exit(0)}
if(a.startsWith('-xOf ')){console.log(JSON.stringify({name:'dverity',version:'5.0.0',repository:{url:'git+https://github.com/Dimon94/dverity.git'}}));process.exit(0)}
process.exit(2);
`);
    fs.chmodSync(fake, 0o755);
    for (const name of ['gh', 'git', 'npm', 'tar']) {
      const executable = path.join(sandbox, name);
      fs.copyFileSync(fake, executable);
      fs.chmodSync(executable, 0o755);
    }
  });

  afterEach(() => {
    fs.rmSync(path.dirname(metadataDir), { recursive: true, force: true });
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  test.each([
    ['current PR query failure', 'pr-failure', 'present', /pulls\/86 failed/],
    ['malformed live ref', 'live-malformed', 'present', /provider live main is malformed/],
    ['missing secret', 'normal', undefined, /NPM_TOKEN is required/],
    ['empty secret', 'normal', '', /NPM_TOKEN is required/],
    ['digest drift', 'digest-drift', 'present', /artifact SHA-512 mismatch/]
  ])('exits nonzero with zero publish for %s', (_name, fakeCase, token, expectedError) => {
    if (fakeCase === 'digest-drift') {
      record.sha512 = 'd'.repeat(128);
      record.repack.sha512 = record.sha512;
      fs.writeFileSync(metadataDir, JSON.stringify(record));
    }
    const env = { ...process.env, PATH: `${sandbox}:${process.env.PATH}`, RECORDER: recorder,
      FAKE_CASE: fakeCase, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'Dimon94/dverity',
      GITHUB_REF: 'refs/heads/main', GITHUB_SHA: M, GH_TOKEN: 'provider', NODE_AUTH_TOKEN: token };
    if (token === undefined) delete env.NODE_AUTH_TOKEN;
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/publish-dverity.js'), 'publish'],
      { cwd: ROOT, env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(expectedError);
    expect(fs.existsSync(recorder) ? fs.readFileSync(recorder, 'utf8') : '').toBe('');
  });
});
