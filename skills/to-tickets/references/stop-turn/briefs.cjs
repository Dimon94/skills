// TURN-1 的预期产物。base 取自例子项目的 git rev-parse HEAD。
module.exports = function examples(base) {
  const common = {
    ticket: 'TURN-1', scenarios: ['S1'], base,
    read_first: ['turn.js', 'check.cjs'], exclusions: ['重复停止'],
  };
  const status = {
    ...common, slice_id: 'state', title: '停止回合', owns: ['T1'],
    goal: '用户点击停止后，回合显示已停止', writable: ['status.js'],
    check: ['node', 'check.cjs', 'status'], expected: '回合状态为 stopped',
  };
  const results = {
    ...common, slice_id: 'results', title: '保留已显示的结果', owns: ['R1'],
    goal: '停止后仍可在详情读到第一段', writable: ['results.js'],
    check: ['node', 'check.cjs', 'results'], expected: '结果仍为「第一段」',
  };
  const single = {
    ...common, slice_id: 'turn', title: '停止并保留结果', owns: ['T1', 'R1'],
    goal: '用户停止回合后仍可查看已有结果', writable: ['status.js', 'results.js'],
    check: ['node', 'check.cjs', 'all'], expected: '状态为 stopped，结果仍为「第一段」',
  };
  return {
    single: [single],
    split: [status, results],
    // 两份都有不同的片标识和可写文件，也都指向 S1，却只检查停止状态。
    missingResult: [status, { ...status, slice_id: results.slice_id, writable: results.writable }],
  };
};
