const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inspectFreshHostRoot,
  inspectHostProjections,
  materializeHostProjections
} = require('../../install/host-projections');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-hosts-')));
  const artifactRoot = path.join(root, 'artifact');
  const installRoot = path.join(root, 'install');
  const content = Buffer.from('artifact-owned\n');
  const packagePath = 'skills/dverity-repair/SKILL.md';
  fs.mkdirSync(path.join(artifactRoot, 'skills/dverity-repair'), { recursive: true });
  fs.mkdirSync(installRoot);
  fs.writeFileSync(path.join(artifactRoot, packagePath), content);
  return {
    artifactRoot,
    installRoot,
    files: [{
      path: 'dverity-repair/SKILL.md',
      packagePath,
      sha256: sha256(content)
    }],
    projections: ['.agents/skills', '.claude/skills']
  };
}

describe('Dverity host projections', () => {
  test('materializes both projections from one frozen artifact and proves three-way hashes', () => {
    const input = fixture();

    materializeHostProjections(input);

    expect(inspectHostProjections(input)).toEqual({
      artifact_hash: input.files[0].sha256,
      projections: [
        { root: '.agents/skills', file_count: 1, hash: input.files[0].sha256 },
        { root: '.claude/skills', file_count: 1, hash: input.files[0].sha256 }
      ]
    });
  });

  test('fails one-host drift without changing the artifact or the other projection', () => {
    const input = fixture();
    materializeHostProjections(input);
    const source = path.join(input.artifactRoot, input.files[0].packagePath);
    const agents = path.join(
      input.installRoot,
      '.agents/skills',
      input.files[0].path
    );
    const claude = path.join(
      input.installRoot,
      '.claude/skills',
      input.files[0].path
    );
    fs.writeFileSync(claude, 'drift\n');

    expect(() => inspectHostProjections(input)).toThrow(/\.claude.*drift/i);
    expect(fs.readFileSync(source, 'utf8')).toBe('artifact-owned\n');
    expect(fs.readFileSync(agents, 'utf8')).toBe('artifact-owned\n');
  });

  test('rejects projection roots as artifact sources', () => {
    const input = fixture();
    const projection = path.join(input.installRoot, '.agents/skills');

    expect(() => materializeHostProjections({ ...input, artifactRoot: projection }))
      .toThrow(/projection.*source/i);
  });

  test.each(['.codex', '.cursor', '.qwen', '.agent'])(
    'rejects removed host output %s in a fresh harness root',
    (removed) => {
      const input = fixture();
      fs.mkdirSync(path.join(input.installRoot, removed));

      expect(() => inspectFreshHostRoot(input.installRoot)).toThrow(/removed host output/i);
    }
  );
});
