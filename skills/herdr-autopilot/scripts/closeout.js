'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function trees(repo) {
  return git(repo, 'worktree', 'list', '--porcelain', '-z').split('\0\0').filter(Boolean).map(row => {
    const fields = row.split('\0');
    return { path: fields[0].slice('worktree '.length), ref: fields.find(s => s.startsWith('branch '))?.slice(7) };
  });
}

function ownedTree(repo, worktree, base) {
  if (![repo, worktree, base].every(value => typeof value === 'string' && value.length)) {
    throw new Error('工作树登记需要 --repo、--worktree 和 --base');
  }
  const listing = trees(repo);
  const root = fs.realpathSync(worktree);
  const entry = listing.slice(1).find(item => item.path === root);
  git(repo, 'check-ref-format', 'refs/heads/' + base);
  const target = 'refs/heads/' + base;
  git(repo, 'show-ref', '--verify', target);
  if (!entry?.ref || entry.ref === target || listing[0].ref === entry.ref) {
    throw new Error('需要独立任务工作树及不同的合入分支');
  }
  return { repo: listing[0].path, path: root, ref: entry.ref, target };
}

function retireTree(tree, checkpoint) {
  const { repo, path, ref, target } = tree;
  const listing = trees(repo);
  const entry = listing.find(item => item.path === path);
  if (listing[0].path === path || (entry && entry.ref !== ref) ||
      listing.some(item => item.ref === ref && item.path !== path)) {
    throw new Error('任务工作树或分支归属已变化');
  }
  if (!entry && (fs.existsSync(path) || !tree.tip)) throw new Error('无法确认任务工作树归属');
  const tip = git(repo, 'for-each-ref', '--format=%(objectname) %(refname)', ref)
    .split('\n').find(line => line.endsWith(' ' + ref))?.split(' ')[0];
  if (!tip && tree.tip && !entry) return;
  if (!tip || (tree.tip && tree.tip !== tip)) throw new Error('任务分支已变化');
  git(repo, 'merge-base', '--is-ancestor', tip, target);
  if (entry) {
    if (git(path, 'status', '--porcelain', '--untracked-files=all', '--ignored')) {
      throw new Error('工作树有未清理文件');
    }
    if (!tree.tip) {
      tree.tip = tip;
      checkpoint();
    }
    git(repo, 'worktree', 'remove', '--', path);
  }
  git(repo, 'update-ref', '-d', ref, tip);
}

function closablePane(lane, session, runner) {
  const panes = JSON.parse(runner(session, ['pane', 'list'])).result.panes;
  const pane = panes.find(item => item.pane_id === lane.pane);
  if (!pane && lane.closing_pane) return false;
  if (!lane.terminal_id || pane?.terminal_id !== lane.terminal_id ||
      !['idle', 'done'].includes(pane.agent_status)) {
    throw new Error('pane 身份或结束状态尚未确认');
  }
  const agents = JSON.parse(runner(session, ['agent', 'list'])).result.agents;
  if (!agents.some(agent => agent.pane_id === lane.pane && agent.name === lane.agent)) {
    throw new Error('pane 已更换 agent');
  }
  return true;
}

// keepTree：树要留作证据或无法证明已合入时，只释放 pane，原因记进账本；pane 永远在 done 前关闭。
function closeout(lane, session, runner, checkpoint, keepTree = null) {
  if (lane.closed_at) return;
  if (!lane.cleanup) throw new Error('缺少登记时的资源归属，保留现场');
  closablePane(lane, session, runner);
  if (keepTree) lane.tree_kept_reason = keepTree;
  else if (lane.cleanup.tree) retireTree(lane.cleanup.tree, checkpoint);
  if (closablePane(lane, session, runner)) {
    lane.closing_pane = true;
    checkpoint();
    runner(session, ['pane', 'close', lane.pane]);
  }
  lane.closed_at = new Date().toISOString();
}

module.exports = { ownedTree, closeout };
