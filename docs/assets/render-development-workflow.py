"""生成双语开发链路 SVG；PNG 由 fireworks-tech-graph 校验并导出。"""

# --- L3 文件合同 ---
# INPUT: GLOSSARY.md；to-epic、to-spec、vertical-slicing、implement 与 Git Skill 的 SKILL.md。
# OUTPUT: 同目录的 development-workflow.{en,zh-CN}.svg。
# TEST: fireworks-tech-graph/scripts/validate-svg.sh；导出 PNG 后目视检查。
# PROTOCOL: 上述 Skill 的交付单位或交接流程变化时，核对本文件与 README 任务分流。

from html import escape
from pathlib import Path


COPY = {
    "zh-CN": [
        "Skill 开发链路", "以 MMF 为交付单位 · Spec 定义合同 · ticket 在 MMF 内执行",
        ["01 任务分流", "大型需求 → MMF 规划；常规需求 → 最小计划 + grill-with-docs；小改动 → implement",
         "Bug → diagnosing-bugs → 验证与本地 Git 收口；重构 / 优化先分析，再分流"],
        ["02 MMF 规划", "to-epic：Epic → 可独立上线的 MMF；to-spec：每个 MMF 一份 Spec",
         "一个 MMF 对应一个 MR；逐个 MMF 交付，共用使能工作归首个用到它的 MMF"],
        ["03 可选拆票", "vertical-slicing → ticket-sizing → 用户裁决 → to-tickets",
         "超线票先走 ticket-split-100k；发布前展示逐票拆分信号与 MMF 合计",
         "默认在同一个 MMF 的 MR 分支内按依赖执行，完成全部票后整体交付"],
        ["04 实现与验证", "git-worktree 隔离写任务 → implement 按垂直切片实现 → tdd 按需红绿",
         "相关 E2E / 真实运行 / 已覆盖的形式验证 → 对账 → code-review（Standards + Spec）",
         "通过后 git-commit；delivery-pipeline 可按目标项目合同编排执行"],
        ["05 集成与交付", "本地集成：git-rebase-main → main；远程交付：git-push-pr → gh-merge-pr",
         "PR 固定 Review Packet → current-head 双轴审查 → 按证据追加专项 → Verdict",
         "获授权后合并与 parity readback；部署与业务验收按目标项目合同执行"],
        "大型需求", "需要拆票", "可容纳于", "一个上下文", "则跳过拆票", "已确认的票", "已验证提交",
        "主交付链", "常规 / 小改动直接进入实现", "远程写入、PR 合并与发布各自沿用明确授权；实现完成不等于已部署或已验收。",
    ],
    "en": [
        "Skill Development Workflow", "MMF is the delivery unit · Spec defines the contract · tickets execute inside an MMF",
        ["01 Task Routing", "Large → MMF planning; regular → minimal plan + grill-with-docs; small → implement",
         "Bug → diagnosing-bugs → verification + local Git closeout; refactor / optimize → analyze, then route"],
        ["02 MMF Planning", "to-epic: Epic → independently shippable MMFs; to-spec: one Spec per MMF",
         "One MR per MMF; deliver MMFs in turn; shared enabling work belongs to the first MMF that needs it"],
        ["03 Optional Tickets", "vertical-slicing → ticket-sizing → user decision → to-tickets",
         "Oversized: ticket-split-100k; show split signals + MMF total before publishing",
         "Execute by dependency in one MMF MR; deliver when all tickets are complete"],
        ["04 Implement + Verify", "git-worktree isolates writes → implement vertical slices → tdd chooses red / green as needed",
         "Relevant E2E / real execution / existing formal checks → reconcile → code-review (Standards + Spec)",
         "Then git-commit; delivery-pipeline can orchestrate execution under the target project's contract"],
        ["05 Integrate + Deliver", "Local: git-rebase-main → main; remote: git-push-pr → gh-merge-pr",
         "PR: freeze Review Packet → current-head Standards + Spec → evidence-led specialists → Verdict",
         "Authorized merge + parity readback; deployment and business acceptance follow the target project's contract"],
        "Large scope", "Needs tickets", "Fits one", "context:", "skip tickets", "Approved tickets", "Verified commit",
        "Main delivery flow", "Regular / small: enter implementation", "Remote writes, PR merge and release each follow explicit authority; implemented does not mean deployed or accepted.",
    ],
}


def text(lines, x, y, value, size=18, color="#6b7280", weight=400):
    lines.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}">{escape(value)}</text>')


def node(lines, key, x, y, w, h, copy, fill):
    lines.append(f'<g data-graph-role="node" data-node-id="{key}">')
    lines.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="#d1d5db" stroke-width="1.5"/>')
    text(lines, x + 24, y + 38, copy[0], 24, "#111827", 600)
    for index, value in enumerate(copy[1:]):
        text(lines, x + 24, y + 76 + index * 32, value, 16)
    lines.append('</g>')


def edge(lines, source, target, path, alternate=False):
    color = "orange" if alternate else "blue"
    dash = ' stroke-dasharray="6 4"' if alternate else ""
    lines.append(f'<path data-graph-role="edge" data-source="{source}" data-target="{target}" d="{path}" fill="none" stroke="{COLORS[color]}" stroke-width="2"{dash} marker-end="url(#{color})"/>')


COLORS = {"blue": "#2563eb", "orange": "#ea580c"}


def render(copy):
    lines = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1360 1680" width="1360" height="1680">']
    lines.append('<style>text { font-family: "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }</style>')
    lines.append('<defs>')
    for key, color in COLORS.items():
        lines.append(f'<marker id="{key}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0,10 3.5,0 7" fill="{color}"/></marker>')
    lines.extend(['</defs>', '<rect data-graph-role="background" width="1360" height="1680" fill="#ffffff"/>'])
    text(lines, 120, 64, copy[0], 34, "#111827", 600)
    text(lines, 120, 102, copy[1])
    edge(lines, "input", "plan", "M 680 300 V 400")
    edge(lines, "plan", "tickets", "M 900 560 V 680")
    edge(lines, "plan", "work", "M 240 560 V 980")
    edge(lines, "tickets", "work", "M 900 850 V 980")
    edge(lines, "work", "delivery", "M 680 1190 V 1320")
    edge(lines, "input", "work", "M 120 230 H 60 V 1080 H 120", True)
    for key, x, y, w, h, label, fill in [
        ("input", 120, 160, 1120, 140, copy[2], "#f8fafc"),
        ("plan", 120, 400, 1120, 160, copy[3], "#eff6ff"),
        ("tickets", 400, 680, 840, 170, copy[4], "#faf5ff"),
        ("work", 120, 980, 1120, 210, copy[5], "#f0fdf4"),
        ("delivery", 120, 1320, 1120, 230, copy[6], "#fff7ed"),
    ]:
        node(lines, key, x, y, w, h, label, fill)
    for x, y, label in [(696, 354, copy[7]), (916, 622, copy[8]),
                        (256, 622, copy[9]), (256, 650, copy[10]), (256, 678, copy[11]),
                        (916, 916, copy[12]), (696, 1262, copy[13])]:
        text(lines, x, y, label, 16, "#2563eb")
    text(lines, 120, 1602, copy[14], 16, "#2563eb")
    text(lines, 400, 1602, copy[15], 16, "#ea580c")
    text(lines, 120, 1640, copy[16], 15)
    lines.append('</svg>')
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    for language, copy in COPY.items():
        target = Path(__file__).parent / f"development-workflow.{language}.svg"
        target.write_text(render(copy), encoding="utf-8")
        print(target)
