---
name: spec-preview
description: 通过同一契约脚本接入 Spec 预览、锁定、改动项、对比页、变更预览和归档恢复。
---

# Spec 预览

从目标项目根目录调用 [契约脚本](spec-preview.mjs)。按命令传入位置参数，以退出码和标准输出读取结果。标准错误的首字段是错误码。收到 `BLOCKED` 时停在当前步骤，并把错误原样交回调用方。

渲染和反馈使用 smyw。完整开发工作流安装入口会建立链接依赖。按需用 `SMYW_DIR` 指定可读的 smyw Skill 目录。

合入前按[预览门](../git-rebase-main/references/closeout.md#预览门)分流。

合入后，从 Spec Issue 下载确认版和实现版 JSON，把两个路径作为 `files-json` 数组传入。

- `archive <repo> <issue> <files-json>` 核对附件与本地对比页的两份 JSON。字节一致时删除本地预览目录，并输出该目录的绝对路径。核对失败时保留目录。
- `restore <repo> <issue> <files-json>` 按附件版本重建对比页，并输出 `compare/preview.html` 的绝对路径。两份附件的文件名和顺序任意。
