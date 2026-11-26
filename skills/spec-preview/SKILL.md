---
name: spec-preview
description: 通过同一契约脚本接入 Spec 预览、锁定、改动项、对比页、变更预览和附件恢复。
---

# Spec 预览

从目标项目根目录调用 [契约脚本](spec-preview.mjs)。按命令传入位置参数，以退出码和标准输出读取结果。标准错误的首字段是错误码。收到 `BLOCKED` 时停在当前步骤，并把错误原样交回调用方。

`build` 使用 GLOSSARY.md 正文和目标项目 Git 跟踪的非测试文本识别词汇。Avoid 词在词汇表正文中从未使用时，按禁词处理。收到 `CopyLint` 时按字段路径和 canonical term 修正文案。

渲染和反馈使用 smyw。完整开发工作流安装入口会建立链接依赖。按需用 `SMYW_DIR` 指定可读的 smyw Skill 目录。

合入前的[预览门](../git-rebase-main/references/closeout.md#预览门)与合入后的附件核验、缓存清理归共享收尾合同。

追溯时，从 Spec Issue 下载确认版和实现版 JSON。调用 `restore <repo> <issue> <files-json>`，其中 `files-json` 是两个下载路径组成的 JSON 数组。脚本按附件版本重建对比页，并输出 `compare/preview.html` 的绝对路径。两份附件的文件名和顺序任意。
