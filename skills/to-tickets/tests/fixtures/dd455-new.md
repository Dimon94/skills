<!-- DD-455 合同先行重切：R 与 Story 归属为推断，用于验证格式与图指标 -->
## C: 冻结宿主合同、视觉基线与运行时探针
- Kind: contract
- Owns: R1, R11, R13
- Stories: 26
- Modules: NativeHostBridge, NativeMacHost, NodeSidecarSupervisor
- Blocked by: None

## 471: 凭证
- Kind: behavior
- Owns: R12
- Respects: R11
- Stories: 24, 25
- Modules: MacCredentialBackend
- Blocked by: C

## 472: 选 Project
- Kind: behavior
- Owns: T1–T3, R3
- Respects: R11, R13
- Stories: 1, 2, 3, 4
- Modules: NativeMacHost
- Blocked by: C

## 473: 建 Session
- Kind: behavior
- Owns: T4, T15, T16, R2
- Respects: R11
- Stories: 5, 6, 7, 27, 28
- Modules: PiSessionStore
- Blocked by: 472

## 474: 最小回合与分支
- Kind: behavior
- Owns: T5, T6, T12, R4
- Respects: R11, R13
- Stories: 8, 9, 10, 11
- Modules: PiTurnRunner
- Blocked by: 473

## 476: 停止回合
- Kind: behavior
- Owns: T9
- Respects: R11
- Stories: 12, 13
- Modules: PiTurnRunner
- Blocked by: 474

## 477: 失败重试
- Kind: behavior
- Owns: T10, T11, R6
- Respects: R11
- Stories: 14, 15
- Modules: PiRunErrors
- Blocked by: 474

## 478: 切换来源模型
- Kind: behavior
- Owns: T14, R8
- Respects: R11
- Stories: 16, 17
- Modules: PiModelBinding
- Blocked by: 474

## 479: 审批往返
- Kind: behavior
- Owns: T7, T8, R5
- Respects: R11
- Stories: 18, 19
- Modules: PiApprovalService
- Blocked by: 474

## 481: 重开历史
- Kind: behavior
- Owns: T13, R9
- Respects: R11
- Stories: 20, 21
- Modules: PiTranscriptProjector
- Blocked by: 474

## 480: 审批中停止
- Kind: behavior
- Owns: T17, T18, R14
- Respects: R11
- Stories: 22
- Modules: PiApprovalService
- Blocked by: 476, 477, 479

## 482: 退出结算
- Kind: behavior
- Owns: T19, R7
- Respects: R11
- Stories: 23, 29
- Modules: NodeSidecarSupervisor
- Blocked by: 476, 479, 481

## 483: 崩溃恢复
- Kind: behavior
- Owns: T20, R10
- Respects: R11
- Stories: 30
- Modules: NodeSidecarSupervisor
- Blocked by: 476, 477, 479, 481

