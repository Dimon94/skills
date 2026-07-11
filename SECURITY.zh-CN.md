# Dverity 安全策略

[中文版](./SECURITY.zh-CN.md) | [English](./SECURITY.md)

## 支持版本

安全修复优先覆盖 Dverity 最新发布版本和当前默认分支；旧版本尽力支持。

## 报告范围

请报告影响以下边界的漏洞：

- `dverity install`、`migrate`、`verify`、`uninstall` 的路径安全；
- ownership manifest 验证或 managed projection hash；
- 任意文件写入、路径穿越、symlink escape 或 cross-root mutation；
- 命令注入或不安全的子进程执行；
- 包内容、provenance、secret 或非预期文件；
- 经过认证的 provider action、review freshness、landing 或 parity readback。

普通 Bug 与文档缺口请提交到
[GitHub Issues](https://github.com/Dimon94/dverity/issues)。

## 报告方式

优先使用 GitHub private vulnerability reporting；不可用时，通过 GitHub profile
上最不公开的方式联系维护者。请提供受影响版本或 commit、环境、精确复现、已观察影响和
披露状态。完成初步分级前，不要公开漏洞利用细节。

维护者目标是在七天内确认有效私密报告，公开前核实严重程度，优先修复当前代码，并在包用户
受影响时发布不可变的修复版本。
