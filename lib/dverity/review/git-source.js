const { execFileSync } = require('child_process');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function targetCoordinates(target) {
  const match = /^([A-Za-z0-9._][A-Za-z0-9._-]*)\/([A-Za-z0-9._][A-Za-z0-9._/-]*)$/.exec(target);
  if (!match || match[2].includes('..')) {
    throw new Error('target must be a named remote branch such as origin/main');
  }
  return { remote: match[1], branch: match[2] };
}

function refreshTarget(cwd, target) {
  const { remote, branch } = targetCoordinates(target);
  const refspec = `refs/heads/${branch}:refs/remotes/${remote}/${branch}`;
  git(cwd, ['fetch', '--prune', remote, refspec]);
}

function lines(value) {
  return value ? value.split('\n').filter(Boolean) : [];
}

function readGitSource({ cwd, source, target }) {
  refreshTarget(cwd, target);
  const checkedOut = git(cwd, ['symbolic-ref', '--short', 'HEAD']);
  if (checkedOut !== source) {
    throw new Error(`checked-out branch does not match named source: ${checkedOut}`);
  }

  const targetHead = git(cwd, ['rev-parse', target]);
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const base = git(cwd, ['merge-base', target, 'HEAD']);
  const [behind, ahead] = git(cwd, [
    'rev-list', '--left-right', '--count', `${target}...HEAD`
  ]).split(/\s+/).map(Number);
  const aheadCommits = lines(git(cwd, ['rev-list', '--reverse', `${target}..HEAD`]));
  if (aheadCommits.length !== ahead) throw new Error('Git ahead count and commit range disagree');

  return {
    source,
    target,
    target_head: targetHead,
    base,
    head,
    clean: git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']) === '',
    behind,
    ahead_commits: aheadCommits,
    touched_paths: lines(git(cwd, ['diff', '--name-only', `${target}...HEAD`])).sort()
  };
}

module.exports = {
  readGitSource
};
