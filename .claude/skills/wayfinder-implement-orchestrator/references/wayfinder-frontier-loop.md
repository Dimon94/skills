# Wayfinder Frontier Loop

当 discovery gate 使用 wayfinder map issue 时读取本文件。

## 循环

1. 读取 map issue 的低分辨率 index，并读取本 repo 的 Wayfinding operations。
2. 查询 `open`、未被 native blocking 阻塞、且没有 `wayfinder:claimed` 的 child
   issues；不要从 map 正文推断 open tickets。
3. 只派发 bounded `Research`、`Prototype` 或可自动执行的 `Task` child issues，使用
   `WAYFINDER_TICKET_DISPATCH_PACKET.md`。
4. 派发后使用 `child-monitoring.md`；不要让父线程循环一直开着。
5. wake-up 时读取 child final reports，然后重读 map issue 和 frontier query。
6. 只要还有新的未阻塞且未 claimed 的 discovery child issues，就从第 1 步重复。

## 停止

出现以下情况时停止 frontier loop：

- map issue 已有足够 proof 进入 PRD synthesis；
- 下一个 frontier child issue 是 `wayfinder:grilling`，或需要实时用户判断；加载
  `assets/WAYFINDER_GRILLING_DISPATCH_PACKET.md`，输出一个用于完整用户拷问会话的
  已填写 prompt，然后等待 returned handoff 再继续。不要每个问题创建一个 prompt；
- child 报告 `ask-user`、`blocked` 或 `Unknown`；
- 两个 child sessions 编辑了同一个 child issue，或留下冲突 tracker state。

对非判断类 tickets，copy-paste child prompts 只是 `create_thread` 或 project
targeting 不可用时的 fallback。Codex thread tools 可用时，直接创建 fresh sessions。

父线程负责创建新线程。`/wayfinder` child 可以输出正常的 Next steps block，但不能自己
打开 descendant sessions。
