<!-- DD-455 旧切法回放：16 票，依赖取自 Linear 原生关系；Module 推断 -->
## 469: 视觉基线
- Kind: behavior
- Owns: R13
- Stories: 
- Modules: NativeMacHost
- Blocked by: None

## 470: 运行时探针
- Kind: behavior
- Owns: R11, R1
- Stories: 
- Modules: NativeHostBridge, NodeSidecarSupervisor
- Blocked by: None

## 471: 凭证
- Kind: behavior
- Owns: R11, R12
- Stories: 
- Modules: MacCredentialBackend
- Blocked by: 470

## 472: 选 Project
- Kind: behavior
- Owns: T1–T3, R11, R13, R3
- Stories: 
- Modules: NativeMacHost, NativeHostBridge
- Blocked by: 469, 470

## 473: 建 Session
- Kind: behavior
- Owns: T4, T15, T16, R11, R13, R3, R2
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiTurnRunner
- Blocked by: 471, 472

## 474: 最小回合
- Kind: behavior
- Owns: T5, T6, T12, R11, R13, R3, R2, R4, R5, R6, R7, R8, R10
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiTurnRunner, PiTranscriptProjector
- Blocked by: 473

## 475: 回合分支
- Kind: behavior
- Owns: T5, T6, R11, R13, R3
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiTurnRunner, PiTranscriptProjector
- Blocked by: 474

## 476: 停止回合
- Kind: behavior
- Owns: T9, R11, R13, R3, R4
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiTurnRunner, PiTranscriptProjector
- Blocked by: 474

## 477: 失败重试
- Kind: behavior
- Owns: T10, T11, R11, R13, R2
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiTurnRunner
- Blocked by: 474

## 478: 切换来源模型
- Kind: behavior
- Owns: T14, R11, R13, R8
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiTurnRunner
- Blocked by: 474

## 479: 审批往返
- Kind: behavior
- Owns: T7, T8, R11, R13, R5
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiApprovalService
- Blocked by: 474

## 481: 重开历史
- Kind: behavior
- Owns: T13, R9, R11, R13, R6
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiTranscriptProjector
- Blocked by: 474

## 480: 审批中停止
- Kind: behavior
- Owns: T17, T18, R11, R13, R14
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiTurnRunner, PiApprovalService
- Blocked by: 476, 477, 479

## 482: 退出结算
- Kind: behavior
- Owns: T19, R11, R13, R7
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiApprovalService, NodeSidecarSupervisor
- Blocked by: 476, 479, 481

## 483: 崩溃恢复
- Kind: behavior
- Owns: T20, R11, R13, R10
- Stories: 
- Modules: NativeMacHost, NativeHostBridge, PiApprovalService, NodeSidecarSupervisor
- Blocked by: 476, 477, 479, 481

## 484: 集成验收
- Kind: behavior
- Owns: T1–T20, R1–R14
- Stories: 
- Modules: NativeMacHost, NativeHostBridge
- Blocked by: 475, 478, 480, 482, 483

