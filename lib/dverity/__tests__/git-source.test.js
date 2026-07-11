const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { readGitSource } = require('../git-source');

describe('Dverity Submit Git source proof', () => {
  test('reads clean-but-ahead work from the named branch and fresh target', () => {
    const repo = gitFixture();

    const proof = readGitSource({
      cwd: repo,
      source: 'codex/integration',
      target: 'origin/main'
    });

    expect(proof).toEqual(expect.objectContaining({
      source: 'codex/integration',
      target: 'origin/main',
      clean: true,
      behind: 0,
      touched_paths: ['submit.txt']
    }));
    expect(proof.base).toBe(proof.target_head);
    expect(proof.ahead_commits).toEqual([proof.head]);
  });

  test('reports worktree dirt instead of treating it as source work', () => {
    const repo = gitFixture();
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'dirt\n');

    const proof = readGitSource({
      cwd: repo,
      source: 'codex/integration',
      target: 'origin/main'
    });

    expect(proof.clean).toBe(false);
    expect(proof.ahead_commits).toEqual([proof.head]);
    expect(proof.touched_paths).toEqual(['submit.txt']);
  });

  test('fails closed when the checked-out branch is not the named source', () => {
    const repo = gitFixture();

    expect(() => readGitSource({
      cwd: repo,
      source: 'other/source',
      target: 'origin/main'
    })).toThrow(/checked-out branch does not match named source/i);
  });
});

function gitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dverity-submit-git-'));
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');
  run('git', ['init', '--bare', remote], root);
  fs.mkdirSync(repo);
  run('git', ['init', '-b', 'main'], repo);
  run('git', ['config', 'user.name', 'Dverity Fixture'], repo);
  run('git', ['config', 'user.email', 'fixture@example.test'], repo);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
  run('git', ['add', 'base.txt'], repo);
  run('git', ['commit', '-m', 'base'], repo);
  run('git', ['remote', 'add', 'origin', remote], repo);
  run('git', ['push', '-u', 'origin', 'main'], repo);
  run('git', ['switch', '-c', 'codex/integration'], repo);
  fs.writeFileSync(path.join(repo, 'submit.txt'), 'submit\n');
  run('git', ['add', 'submit.txt'], repo);
  run('git', ['commit', '-m', 'submit'], repo);
  return repo;
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}
