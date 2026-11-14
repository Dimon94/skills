/**
 * 测试专用 fake Adapter：只模拟外部系统边界（Linear、原证据 owner）。
 * 记录每次调用与 mutation，供测试观察外部副作用。
 */

// 手算：2026-11-16 是周一；上海 00:00 = 2026-11-15T16:00:00Z
export const WEEK = { start: '2026-11-15T16:00:00.000Z', end: '2026-11-22T16:00:00.000Z' };
export const TUESDAY = () => new Date('2026-11-17T10:00:00Z'); // 上海周二 18:00
export const SCOPE = { teamId: 'team-1', projectId: 'project-1', exclusionLabelId: 'label-exclude' };
export const REQUEST = { scope: SCOPE, exclude: [], restore: [] };

export const COMPLIANT_CONFIG = Object.freeze({
  cyclesEnabled: true,
  timezone: 'Asia/Shanghai',
  cycleDurationWeeks: 1,
  cycleStartDay: 1,
  cooldownWeeks: 0
});

const NOT_MET = { state: 'not_met', source: 'fixture', effectiveAt: null, reason: null };

function page(items, cursor, size) {
  const offset = cursor === null ? 0 : Number(cursor);
  const nodes = items.slice(offset, offset + size);
  const next = offset + size;
  return { nodes, pageInfo: { hasNextPage: next < items.length, endCursor: String(next) } };
}

export class FakeLinear {
  constructor({ config = COMPLIANT_CONFIG, cycles, pageSize = 2 } = {}) {
    this.config = config;
    this.cycles = cycles ?? [{ id: 'cycle-1', startsAt: WEEK.start, endsAt: WEEK.end }];
    this.issues = new Map();
    this.pageSize = pageSize;
    this.calls = [];
    this.mutations = [];
    this.patchBehavior = null; // (issueId, patch, apply) => Promise
  }

  add(issue) {
    const full = { teamId: 'team-1', projectId: 'project-1', labels: [], parentId: null,
      cycleId: null, specRef: null, statusType: 'started', ...issue };
    this.issues.set(full.id, structuredClone(full));
    return this;
  }

  snapshot() {
    return structuredClone([...this.issues.values()]);
  }

  async readCycleConfiguration(teamId) {
    this.calls.push('readCycleConfiguration');
    if (this.config instanceof Error) throw this.config;
    return this.config;
  }

  async listCycles(scope, cursor) {
    this.calls.push('listCycles');
    return page(this.cycles, cursor, this.pageSize);
  }

  async listIssues(scope, cursor) {
    this.calls.push('listIssues');
    if (this.listError) throw this.listError;
    return page(structuredClone([...this.issues.values()]), cursor, this.pageSize);
  }

  async readIssue(issueId) {
    this.calls.push('readIssue');
    if (this.beforeRead) this.beforeRead(issueId);
    return structuredClone(this.issues.get(issueId));
  }

  async patchIssue(issueId, patch) {
    this.calls.push('patchIssue');
    this.mutations.push({ issueId, patch: structuredClone(patch) });
    const apply = () => { this.issues.get(issueId).cycleId = patch.cycle; };
    if (this.patchBehavior) return this.patchBehavior(issueId, patch, apply);
    apply();
    return { success: true };
  }
}

export class FakeEvidence {
  constructor(byIssue = {}) {
    this.byIssue = byIssue;
  }

  async read({ issueId }) {
    return this.byIssue[issueId] ?? { spec: NOT_MET, main: NOT_MET };
  }
}

export function portError(code) {
  return Object.assign(new Error(code), { code });
}
