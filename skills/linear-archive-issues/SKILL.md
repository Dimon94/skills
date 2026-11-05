---
name: linear-archive-issues
description: 归档 Linear Issue。用户要求归档指定 Issue、批量归档已完成或已取消的 Issue，或核实程序化归档能力时使用；通过 GraphQL issueArchive 执行并回读 archivedAt。
---

# Linear Issue 归档

归档保留 Issue 历史与工作流状态。归档动作由 Linear GraphQL API 执行；成功以持久字段 `archivedAt` 为准。

## 1. 锁定目标

读取调用方项目的 tracker 规则，确定 workspace、team、project 与已授权的 Issue 集合。用户只要求调查能力时保持只读。

通过已授权的 Linear MCP 或 API 读取每张票的 UUID、identifier、title、status、archivedAt、URL 与所属项目。批量请求先完成筛选与分页，将目标固定为 UUID 清单；筛选范围有实质歧义时先澄清。

已归档的票记为跳过。其余票仅在用户授权覆盖它们时进入写入步骤。归档不替代验收；保持现有工作流状态。

完成条件：每个待写 UUID 都对应用户授权范围内的确切 Issue，且连接的 workspace 已核对。

## 2. 选择接口与凭证

先检查实际 MCP 工具 schema。存在明确的 Issue 归档工具时按其合同调用；仅有 `save_issue`、`includeArchived` 或可读 `archivedAt` 不代表支持归档写入。MCP 未暴露归档工具时，直接调用 `https://api.linear.app/graphql`。

GraphQL 使用 Personal API Key，Authorization header 直接放 Key。MCP OAuth 凭证不能假定可用于 GraphQL。遇到认证失败时报告缺失的授权。

本机 Refresh 的既有凭证位于 macOS 钥匙串：service 为 `refresh-linear-api-key`，account 为当前登录用户。凭证仅在进程内读取并传给 Linear；日志、聊天、仓库与临时证据只保留脱敏结果。

该 Key 的 Write scope 可执行归档，但读取 GraphQL Issue 还需要 Read scope。只有 Write 时，通过已授权 MCP 核对身份、读取目标并回读结果。缺少凭证时，引导用户在 Linear 的 Security & access 创建限定目标 Team 的 Key；授予 Write，需要同一 Key 回读时另加 Read，并存入系统凭证库。

完成条件：归档凭证可用，且存在可读取目标与结果的授权通道。

## 3. 执行归档

一次处理一个已核对的 UUID。以下命令仅在目标与写入授权已核对后执行，将末尾 UUID 替换成当前目标；Key 不进入命令参数。

```bash
python3 - 'ISSUE_UUID' <<'PY'
import getpass
import json
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

issue_id = str(uuid.UUID(sys.argv[1]))
key = subprocess.run(
    ['security', 'find-generic-password', '-a', getpass.getuser(),
     '-s', 'refresh-linear-api-key', '-w'],
    capture_output=True, text=True, check=True,
).stdout.strip()
if not key:
    raise SystemExit('钥匙串凭证为空；归档未执行')
payload = {
    'query': 'mutation ArchiveIssue($id: String!) { issueArchive(id: $id) { success } }',
    'variables': {'id': issue_id},
}
request = urllib.request.Request(
    'https://api.linear.app/graphql',
    data=json.dumps(payload).encode(),
    headers={'Authorization': key, 'Content-Type': 'application/json'},
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
except urllib.error.HTTPError as error:
    raise SystemExit(f'归档请求失败：HTTP {error.code}；回读 Issue 后判断结果')
except (urllib.error.URLError, TimeoutError):
    raise SystemExit('归档请求未得到确定响应；回读 Issue 后判断结果')
if result.get('errors') or result.get('data', {}).get('issueArchive', {}).get('success') is not True:
    raise SystemExit('归档未返回成功；回读 Issue，并检查 API 错误与权限')
print(json.dumps({'id': issue_id, 'mutationSuccess': True}))
PY
```

归档调用省略 `trash`，保持删除与归档的边界。HTTP 成功仍须检查 GraphQL `errors` 和 `success`。超时、连接中断或异常响应后先回读，确认尚未归档才决定重试。批量执行发生未解决失败时停止后续写入，保留逐票结果。

## 4. 回读并交付

通过步骤 2 确定的读取通道重新查询 UUID、identifier、status、archivedAt 与 URL。`archivedAt` 非空且工作流状态与归档前一致，才报告该票归档完成；仅有 mutation success 时报告“请求成功，归档尚未验证”。

交付逐票结果：已归档、原已归档、失败或待验证，并附 Issue URL。失败项点名认证、权限、请求错误或回读缺口；保留用户下一步所需的信息。

## 验证锚点

- 首次使用凭证：先核对 workspace 和目标，归档一张用户明确授权的票，再独立回读 `archivedAt` 与工作流状态。
- 已归档输入：跳过写入，报告原归档时间。
- 认证失败或不确定响应：不声称成功，先回读再决定恢复动作。
- 能力调查：只检查 schema 与授权，不执行 mutation。

实测依据：GraphQL `issueArchive(id: String!, trash: Boolean)` 可手动归档；MCP 工具缺失不等于 GraphQL API 缺失。界面自动归档规则不约束此接口的能力判断。
