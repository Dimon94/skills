'use strict';

// ============================================================================
// L3-L6 Contract: herdr-autopilot 2x2 grid placement & compact visual naming
// - COORD: skills/herdr-autopilot/scripts/layout.js
// - Owns: 4-pane 2x2 tab layout (1->right, 2->down[0], 3->down[1], >4->new tab)
//   and compact visual labels "<IssueKey> <中文简写>[ <英文>]" for workspace,
//   tab, and pane with strict CJK display-width bounds.
// - 一个 Epic 一个 workspace：workspace 名以 Epic 号开头；Epic 没有 space 时
//   place 用 herdr workspace create 新建，根 pane 作为第一格。
// - INVARIANT: never steals focus (--no-focus); rejects bare ASCII slugs without
//   Chinese short name or over-wide labels that Herdr would truncate.
// - TEST: node --test skills/herdr-autopilot/tests/autopilot.test.js
// ============================================================================

const { parseIssueRef } = require('./issue-sync.js');

const TAB_CAPACITY = 4;
const MAX_WORKSPACE_COLS = 20;
const MAX_TAB_COLS = 20;
const MAX_PANE_COLS = 24;
const FULLWIDTH_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/;
const ANY_ISSUE_KEY_RE = /(?:^|\s)(?:[A-Z][A-Z0-9]*-\d+|#\d+)(?:\s|$)/;

function displayWidth(text) {
  let width = 0;
  for (const ch of String(text || '')) {
    width += FULLWIDTH_RE.test(ch) ? 2 : 1;
  }
  return width;
}

function extractIssueKey(rawIssue) {
  const ref = parseIssueRef(rawIssue);
  if (ref.tracker === 'linear') return ref.id;
  if (ref.tracker === 'github') return `#${ref.number}`;
  return null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatVisualLabel({ issue, label, maxCols, kind }) {
  const cleaned = String(label || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    throw new Error(`${kind} 缺少可视化命名：请传 "<Issue号> <中文简写>[ <英文>]"（如 "JB-548 扩表Job"）`);
  }
  const cjkCount = (cleaned.match(/[\u3400-\u9FFF]/g) || []).length;
  if (cjkCount < 2) {
    throw new Error(
      `${kind} 命名 "${cleaned}" 缺少中文简写（至少 2 个汉字）；格式须为 "<Issue号> <中文简写>[ <英文>]"（如 "JB-548 扩表Job"）`
    );
  }
  const issueKey = extractIssueKey(issue);
  const hasAnyKey = ANY_ISSUE_KEY_RE.test(cleaned);
  const formatted = issueKey && !hasAnyKey ? `${issueKey} ${cleaned}` : cleaned;
  const width = displayWidth(formatted);
  if (width > maxCols) {
    throw new Error(
      `${kind} 命名 "${formatted}" 显示宽度 ${width} 超过上限 ${maxCols}（汉字计 2 列、ASCII 计 1 列），请使用更短简写`
    );
  }
  return formatted;
}

function findPaneObject(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.pane_id === 'string') return value;
  const items = Array.isArray(value) ? value : Object.values(value);
  for (const child of items) {
    const found = findPaneObject(child);
    if (found) return found;
  }
  return null;
}

// workspace 名必须以 Epic 号开头：findEpicWorkspace 靠它认出 Epic 已有的 space。
function formatWorkspaceLabel(epic, label) {
  const title = formatVisualLabel({ issue: epic, label, maxCols: MAX_WORKSPACE_COLS, kind: 'workspace' });
  const key = extractIssueKey(epic);
  if (!title.startsWith(`${key} `)) {
    throw new Error(`workspace 命名 "${title}" 须以所属 Epic 号 ${key} 开头`);
  }
  return title;
}

function findEpicWorkspace(session, epic, runner) {
  const key = extractIssueKey(epic);
  const list = JSON.parse(runner(session, ['workspace', 'list'])).result?.workspaces || [];
  return list.find((w) => String(w.label || '').startsWith(`${key} `))?.workspace_id || null;
}

// 新 Epic 开新 workspace，根 pane 即第一格。
function createEpicWorkspace({ session, epic, workspaceLabel, cwd, prefix, runner }) {
  if (!workspaceLabel) {
    throw new Error(`Epic ${extractIssueKey(epic)} 还没有 workspace：place 需要 --workspace-label 来新建`);
  }
  const wsTitle = formatWorkspaceLabel(epic, workspaceLabel);
  const created = JSON.parse(runner(session, [
    'workspace', 'create', '--cwd', cwd, '--label', wsTitle, '--no-focus',
  ])).result || {};
  if (!created.workspace?.workspace_id || !created.tab?.tab_id || !created.root_pane?.pane_id) {
    throw new Error('herdr workspace create response missing workspace/tab/root_pane');
  }
  runner(session, ['tab', 'rename', created.tab.tab_id, prefix]);
  return { workspace: created.workspace.workspace_id, wsTitle, pane: created.root_pane };
}

function placePane({
  session,
  epic,
  workspace,
  cwd,
  issue,
  tabPrefix,
  paneLabel,
  workspaceLabel,
  excludeTab,
  runner,
}) {
  if (!cwd) {
    throw new Error('place requires --cwd');
  }
  const prefix = formatVisualLabel({ issue, label: tabPrefix, maxCols: MAX_TAB_COLS - 2, kind: 'tab' });
  const paneTitle = formatVisualLabel({ issue, label: paneLabel, maxCols: MAX_PANE_COLS, kind: 'pane' });
  if (!workspace) {
    const fresh = createEpicWorkspace({ session, epic, workspaceLabel, cwd, prefix, runner });
    return finishPlacement({ session, runner, workspace: fresh.workspace, wsTitle: fresh.wsTitle,
      pane: fresh.pane, tabLabel: prefix, paneCount: 1, paneTitle });
  }
  let wsTitle = null;
  if (workspaceLabel) {
    wsTitle = formatWorkspaceLabel(epic, workspaceLabel);
    runner(session, ['workspace', 'rename', workspace, wsTitle]);
  }

  const tabs = JSON.parse(runner(session, ['tab', 'list', '--workspace', workspace])).result?.tabs || [];
  const prefixRe = new RegExp(`^${escapeRegExp(prefix)}(?:-\\d+)?$`);
  const workers = tabs.filter((t) => t.tab_id !== excludeTab && prefixRe.test(String(t.label || '')));
  const target = workers.find((t) => Number(t.pane_count || 0) < TAB_CAPACITY);

  let createdRaw;
  let tabLabel;
  let paneCount;
  if (target) {
    const allPanes = JSON.parse(runner(session, ['pane', 'list', '--workspace', workspace])).result?.panes || [];
    const tabPanes = allPanes.filter((p) => p.tab_id === target.tab_id);
    if (tabPanes.length === 0) {
      throw new Error(`worker tab "${target.tab_id}" has no panes to split`);
    }
    // 四格 2x2：第 2 格右分，第 3 格左上向下分，第 4 格右上向下分
    const anchor = tabPanes.length < 3 ? tabPanes[0] : tabPanes[1];
    const direction = tabPanes.length === 1 ? 'right' : 'down';
    createdRaw = runner(session, [
      'pane', 'split', '--pane', anchor.pane_id, '--direction', direction, '--cwd', cwd, '--no-focus',
    ]);
    tabLabel = target.label;
    paneCount = tabPanes.length + 1;
  } else {
    tabLabel = workers.length === 0 ? prefix : `${prefix}-${workers.length + 1}`;
    createdRaw = runner(session, [
      'tab', 'create', '--workspace', workspace, '--cwd', cwd, '--label', tabLabel, '--no-focus',
    ]);
    paneCount = 1;
  }

  return finishPlacement({ session, runner, workspace, wsTitle,
    pane: findPaneObject(JSON.parse(createdRaw)), tabLabel, paneCount, paneTitle });
}

function finishPlacement({ session, runner, workspace, wsTitle, pane: createdPane, tabLabel, paneCount, paneTitle }) {
  if (!createdPane?.pane_id) {
    throw new Error('herdr placement response missing pane_id');
  }
  const readback = findPaneObject(JSON.parse(runner(session, ['pane', 'get', createdPane.pane_id])));
  if (!readback?.pane_id || readback.workspace_id !== workspace) {
    throw new Error(`placement readback mismatch for pane "${createdPane.pane_id}"`);
  }
  runner(session, ['pane', 'rename', readback.pane_id, paneTitle]);
  return {
    workspace_id: workspace,
    workspace_label: wsTitle,
    tab_id: readback.tab_id,
    tab_label: tabLabel,
    pane_id: readback.pane_id,
    pane_label: paneTitle,
    pane_count: paneCount,
  };
}

module.exports = {
  TAB_CAPACITY,
  MAX_WORKSPACE_COLS,
  MAX_TAB_COLS,
  MAX_PANE_COLS,
  displayWidth,
  extractIssueKey,
  findEpicWorkspace,
  formatVisualLabel,
  placePane,
};
