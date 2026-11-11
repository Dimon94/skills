"""在最早的双语全链路图上补入当前 Skill 链路。"""

# --- L3 文件合同 ---
# INPUT: workflow-source/original.*.svg（cb72fdc 的原始布局）；GLOSSARY.md；
# to-epic、to-spec、vertical-slicing、implement、tdd 与 Git Skill 的 SKILL.md；
# delivery-pipeline 的 gate-state-machine、test-decision-and-rebase。
# OUTPUT: development-workflow.{en,zh-CN}.svg；PNG 由 fireworks-tech-graph 导出。
# TEST: fireworks-tech-graph 五项结构检查、Chromium 渲染与 PNG 目视检查。
# PROTOCOL: 保留原图入口、三路分流、自动调度与 PR Review；流程合同仍归各 Skill。

from copy import deepcopy
from pathlib import Path
import xml.etree.ElementTree as ET

NS = '{http://www.w3.org/2000/svg}'
ET.register_namespace('', NS[1:-1])
ROOT = Path(__file__).parent
COLORS = {'control': '#7c3aed', 'choice': '#f97316', 'bug': '#16a34a', 'feedback': '#ef4444'}

# 每条为稳定 ID、类型、标题、中文说明、英文说明；Skill 名称两种语言共用。
LARGE = [
    ('large-clarify', 'OPTIONAL', 'Research / Brainstorm / Grill', '按需澄清；可用 Second Opinion / Office Hours', 'Clarify as needed; Second Opinion / Office Hours'),
    ('to-epic', 'EPIC', 'to-epic', 'Epic → 可独立上线的 MMF；共用使能归首个 MMF', 'Epic → shippable MMFs; enabling work in first MMF'),
    ('mmf', 'DELIVERY UNIT', 'MMF', '一个 MMF · 一份 Spec · 一个 MR', 'One MMF · one Spec · one MR'),
    ('large-wayfinder', 'DISCOVERY', 'wayfinder', '按需建 Map；决策 frontier → 证据 → 闭合', 'Optional Map; decision frontier → evidence → closure'),
    ('to-spec', 'SPEC', 'to-spec', 'Business Flow · Module / Interface / Seam · 确认并发布', 'Business Flow · Module / Interface / Seam · approve / publish'),
    ('vertical-slicing', 'SLICES', 'vertical-slicing', '骨架 / 加厚 / 结构片 · 依赖与波次 · 单上下文见旁路', 'Skeleton / thickening / structure · dependencies / waves'),
    ('ticket-sizing', 'SIZING', 'ticket-sizing', '先逐票预测、票数与 MMF 合计；再请用户裁决', 'Per-ticket signals + MMF total before user decision'),
    ('ticket-decision', 'USER DECISION', 'Proceed / Re-cut / Release Mode', '照此执行；回 to-epic；或确认逐票发布例外', 'Proceed; return to to-epic; or approve per-ticket release'),
    ('ticket-split', 'CONDITIONAL', 'ticket-split-100k', '仅超线票重切；未超线直接交 to-tickets', 'Split oversized tickets only; otherwise go to to-tickets'),
    ('to-tickets', 'PUBLISH', 'to-tickets', '用户批准 → 发布票 / Parent / 阻塞边 → 读回', 'Approval → publish tickets / Parent / blockers → readback'),
]
SMALL = [
    ('small-grill', 'PLAN', 'Minimal Plan → grill-with-docs', '常规需求拷问计划；小改动直接进入 implement', 'Regular: stress-test plan; small changes: implement directly'),
    ('implement', 'IMPLEMENT', 'git-worktree → implement', '独立写任务；固定基线、验收与独立预期', 'Isolate writes; fix baseline, acceptance and expectations'),
    ('tdd', 'SLICE LOOP', 'tdd · Red → Green → Probe', '按需红绿；无行为变化不新写测试；每片循环', 'Red / green as needed; probe; no new tests for docs'),
    ('verify', 'REAL EXECUTION', 'E2E / verify-<app> / formal-verify-*', '真实入口与全量检查；命中既有形式验证则运行', 'Real entrypoints + full checks; run covered formal checks'),
    ('reconcile', 'RECONCILE', 'Acceptance ↔ Actual Artifacts', '消融不必要层；每条验收与真实产物对账', 'Remove unneeded layers; reconcile acceptance with artifacts'),
    ('local-review', 'REVIEW', 'code-review · Standards + Spec', '最多三轮；P0/P1 修复复审；P2 登记；P3 报告', 'Up to 3 rounds; fix P0/P1; log P2; report P3'),
    ('small-commit', 'COMMIT', 'git-commit', '窄范围、已验证提交；远程交付须另有授权', 'Narrow verified commit; remote delivery needs authority'),
    ('small-land', 'LOCAL LAND', 'git-rebase-main', 'Rebase → main 快进；不隐含 push / PR', 'Rebase → fast-forward main; no implicit push / PR'),
    ('small-close', 'CLOSEOUT', 'Post-merge Check → Cleanup', '验证落地；按本次范围回收并报告', 'Verify landing; clean up and report within task scope'),
]
BUG = [
    ('bug-worktree', 'ISOLATE', 'git-worktree', '一项 Bug · 一个写者 · 固定真实复现入口', 'One bug / writer; fix the real reproduction surface'),
    ('diagnosing-bugs', 'DEBUG', 'diagnosing-bugs · how · why', '运行证据排除假设；定位根因与回归来源', 'Eliminate hypotheses with runtime evidence; find cause'),
    ('bug-fix', 'RED → FIX', 'tdd · Root-cause Fix', '同一输入先失败；修根因并检查同类位置', 'Same input fails first; fix root cause and peer cases'),
    ('bug-verify', 'REPRODUCE AGAIN', 'Real Reproduction → PASS', '在原入口验证；单元测试不能替代真实复现', 'Recheck the original surface; unit tests are insufficient'),
    ('bug-review', 'REVIEW', 'code-review', '复现 / 根因为 Spec；双轴通过后才能提交', 'Repro / root cause as Spec; both axes must pass'),
    ('git-commit', 'LOCAL', 'git-commit', '只提交本缺陷的代码、检查与文档', 'Commit only this fix, checks and documentation'),
    ('git-rebase-main', 'LAND', 'git-rebase-main', 'Rebase + Fast-forward；验证后安全回收', 'Rebase + fast-forward; verify then reclaim safely'),
    ('bug-close', 'CLOSEOUT', 'Evidence → Report / Next Issue', '坏了什么、根因、修复、原复现先失败后通过', 'Symptom, cause, fix, original repro red → green'),
]


def element(tag, **attrs):
    return ET.Element(NS + tag, {key.replace('_', '-'): str(value) for key, value in attrs.items()})


def node(item, x, y, language, width=500, height=88):
    key, kind, title, zh, en = item
    group = element('g', data_graph_role='node', data_node_id=key, id=key)
    group.append(element('rect', x=x, y=y, width=width, height=height, rx=10, fill='#f8fafc', stroke='#94a3b8', stroke_width=1.5))
    for value, offset, css in [(kind, 18, 'type'), (title, 42, 'node-title'), (zh if language == 'zh-CN' else en, 66, 'node-sub')]:
        label = element('text', x=x + width / 2, y=y + offset, text_anchor='middle', **{'class': css})
        label.text = value
        group.append(label)
    return group


def edge(key, source, target, path, kind='control'):
    return element('path', id=key, data_graph_role='edge', data_source=source, data_target=target, d=path, fill='none', stroke=COLORS[kind], stroke_width=2.2, marker_end=f'url(#arrow-{kind})', **({'stroke-dasharray': '7 5'} if kind == 'choice' else {}))


def note(root, x, y, text, width=500):
    label = element('text', x=x + width / 2, y=y, text_anchor='middle', **{'class': 'node-sub'})
    label.text = text
    root.append(label)


def translate(group, dy):
    group.set('transform', f'translate(0 {dy})')


def lane(root, items, x, language, kind):
    for index, item in enumerate(items):
        y = 430 + index * 128
        root.append(node(item, x, y, language))
        if index:
            root.append(edge(f'{items[0][0]}-{index}', items[index - 1][0], item[0], f'M{x + 250} {y - 40} V{y}', kind))


def preserve_original(root):
    keep = []
    for child in root:
        role = child.get('data-graph-role')
        if role not in {'background', 'node', 'edge', 'container', 'label'} and child.tag not in {NS + 'style', NS + 'defs', NS + 'text'}:
            continue
        if role == 'node' and child.get('data-node-id') not in {'request', 'kind', 'analysis', 'route'}:
            continue
        if role == 'edge' and child.get('id') not in {'start', 'kind-analysis', 'analysis-route', 'kind-direct', 'route-0', 'route-1', 'route-2'}:
            continue
        if role == 'label' and float(next(iter(child)).get('y', '0')) > 390:
            continue
        if child.tag == NS + 'text' and float(child.get('y', '0')) > 390:
            continue
        if role == 'container':
            rect = next(iter(child))
            y = int(rect.get('y'))
            if y == 390:
                rect.set('height', '1320')
            elif y >= 790:
                continue
        keep.append(child)
    root[:] = keep


def repair_entry_ports(root):
    paths = {child.get('id'): child for child in root if child.get('data-graph-role') == 'edge'}
    paths['kind-analysis'].set('d', 'M640 210 H760')
    paths['kind-direct'].set('d', 'M520 260 V300 H1400 V213')
    paths['kind-direct'].set('data-target', 'entry-junction')
    paths['analysis-route'].set('d', 'M1260 210 H1397')
    paths['analysis-route'].set('data-target', 'entry-junction')
    root.append(edge('entry-route', 'entry-junction', 'route', 'M1403 210 H1500'))
    root.append(edge('route-trunk', 'route', 'route-junction', 'M1630 260 V337', 'choice'))
    for index, path in enumerate(['M1627 340 H350 V430', 'M1630 343 V370 H1040 V430', 'M1633 340 H1730 V430']):
        paths[f'route-{index}'].set('d', path)
        paths[f'route-{index}'].set('data-source', 'route-junction')
    for key, x, y in [('entry-junction', 1400, 210), ('route-junction', 1630, 340)]:
        group = element('g', data_graph_role='node', data_node_id=key)
        group.append(element('circle', cx=x, cy=y, r=3, fill='#f97316'))
        root.append(group)


def add_pipeline(root, original, language):
    for child in original:
        role, key = child.get('data-graph-role'), child.get('data-node-id')
        if role == 'container' and next(iter(child)).get('y') == '790':
            group = deepcopy(child); next(iter(group)).set('height', '450'); translate(group, 960); root.append(group)
        if role == 'node' and key in {'dp-input', 'gate', 'frontier', 'lanes', 'fanin', 'quality'}:
            group = deepcopy(child)
            labels = [item for item in group if item.tag == NS + 'text']
            if key == 'gate':
                labels[-1].text = 'Discovery / Spec / Tickets 执行证据' if language == 'zh-CN' else 'Discovery / Spec / Tickets evidence'
            if key == 'lanes':
                labels[-1].text = 'Owner / Model / Execution WT'
            translate(group, 970); root.append(group)
        if role == 'edge' and child.get('id') in {'pipeline-0', 'pipeline-1', 'pipeline-2', 'pipeline-3', 'pipeline-4', 'pipeline-loop'}:
            group = deepcopy(child); translate(group, 970); root.append(group)
    for key, title, x, detail_zh, detail_en in [
        ('test-choice', 'Test Decision', 600, '手测 / rebase 后手测 / 跳过额外手测', 'Test now / after rebase / skip extra test'),
        ('sync-main', 'Rebase + Recheck', 920, '同步最新 main；冲突后必要复验', 'Sync latest main; recheck after conflicts'),
        ('remote', 'Push / PR Gate', 1240, '校验授权、唯一 PR 与 CI；无权则停', 'Authority, one PR and CI; hold if absent'),
    ]:
        root.append(node((key, 'GATE', title, detail_zh, detail_en), x, 2020, language, 260))
    root.append(edge('quality-test-choice', 'quality', 'test-choice', 'M1540 1910 V1980 H730 V2020'))
    root.append(edge('test-rebase', 'test-choice', 'sync-main', 'M860 2064 H920'))
    root.append(edge('rebase-remote', 'sync-main', 'remote', 'M1180 2064 H1240'))
    root.append(edge('large-pipeline', 'to-tickets', 'dp-input', 'M350 1670 V1730 H165 V1840'))
    note(root, 800, 1962, '更多 ready 票：重算 frontier' if language == 'zh-CN' else 'More ready work: recompute frontier', 400)
    note(root, 60, 2148, 'worker：复用 02B 实现与验证；CLI 逐票 Review 由宿主预算决定，整体 Review 不省略。' if language == 'zh-CN' else 'Workers use 02B implementation / verification; CLI review placement follows host policy.', 1900)


def add_review(root, original, language):
    review_ids = {'review-packet', 'code-review', 'specialist-gate', 'specialists', 'verdict', 'merge', 'parity'}
    for child in original:
        role = child.get('data-graph-role')
        if role == 'container' and next(iter(child)).get('y') == '1110':
            group = deepcopy(child); next(iter(group)).set('height', '290'); translate(group, 1140); root.append(group)
        if role == 'node' and child.get('data-node-id') in review_ids:
            group = deepcopy(child)
            if child.get('data-node-id') == 'merge':
                labels = [item for item in group if item.tag == NS + 'text']
                labels[-2].text = '点名 PR 与目标分支的明确授权' if language == 'zh-CN' else 'Explicit PR / target authority'
                labels[-1].text = '已有授权继续有效' if language == 'zh-CN' else 'Existing authority remains valid'
            translate(group, 1140); root.append(group)
        if role == 'edge' and child.get('id') in {'packet-main', 'main-specialist-gate', 'specialist-yes', 'specialist-verdict', 'specialist-no', 'verdict-merge', 'merge-parity'}:
            group = deepcopy(child); translate(group, 1140); root.append(group)
    root.append(edge('remote-review', 'remote', 'review-packet', 'M1370 2108 V2200 H175 V2320'))


def finish(root, language):
    zh = language == 'zh-CN'
    note(root, 80, 2520, 'P0/P1 → 原 owner 修复并复验；最多三轮，耗尽则 BLOCKED + postmortem / retro；head 变化重建 Packet。' if zh else 'P0/P1 → owner fix + recheck; max 3 rounds; exhausted → BLOCKED + postmortem / retro; rebuild Packet for changed head.', 1900)
    items = [
        ('deploy', 'RELEASE', 'Release / Deploy', '按目标项目发布合同与授权执行', 'Use target project release contract and authority'),
        ('acceptance', 'ACCEPTANCE', 'Business Acceptance', '目标环境真实业务主线；不适用明确记录', 'Real user flow in target environment; record N/A'),
        ('closeout', 'CLOSEOUT', 'Issue / Branch / Worktree', '验收满足后关闭直接 Issue；安全回收并读回', 'Close accepted direct issues; reclaim safely; read back'),
        ('report', 'DONE / NEXT MMF', 'Evidence → Next MMF', '汇报结果与遗留 gate；推进下一个获批 MMF', 'Report evidence / remaining gates; next approved MMF'),
    ]
    section = element('g', data_graph_role='container')
    section.append(element('rect', data_graph_role='container', x=40, y=2600, width=2000, height=200, rx=12, fill='#f8fafc', stroke='#cbd5e1', stroke_dasharray='7 6'))
    label = element('text', x=700, y=2630, **{'class': 'section'}); label.text = '05 · 发布部署 → 业务验收 → 收尾 → 下一 MMF' if zh else '05 · RELEASE → ACCEPTANCE → CLOSEOUT → NEXT MMF'; section.append(label); root.append(section)
    for index, item in enumerate(items):
        x = 80 + index * 500
        root.append(node(item, x, 2670, language, 420))
        if index:
            root.append(edge(f'finish-{index}', items[index - 1][0], item[0], f'M{x - 80} 2714 H{x}'))
    root.append(edge('parity-deploy', 'parity', 'deploy', 'M1940 2398 V2560 H290 V2670'))
    note(root, 40, 2860, '紫：主交付链　橙：按需 / 用户裁决　绿：Bug 本地链　红：反馈循环' if zh else 'Purple: delivery · Orange: choices · Green: bug closeout · Red: feedback loop', 2000)
    note(root, 40, 2900, '实现、合入、部署、验收分别取证。无相应授权停在已验证的本地候选；Unknown 不算通过。' if zh else 'Prove implementation, merge, deploy and acceptance separately. Without authority hold locally; Unknown is not passed.', 2000)


def render(language):
    original = ET.parse(ROOT / 'workflow-source' / f'original.{language}.svg').getroot()
    root = deepcopy(original)
    preserve_original(root)
    repair_entry_ports(root)
    root.set('height', '2940'); root.set('viewBox', '0 0 2080 2940')
    next(child for child in root if child.get('data-graph-role') == 'background').set('height', '2940')
    lane(root, LARGE, 100, language, 'control')
    lane(root, SMALL, 790, language, 'control')
    lane(root, BUG, 1480, language, 'bug')
    root.append(edge('re-cut-mmf', 'ticket-decision', 'to-epic', 'M100 1370 H80 V602 H100', 'feedback'))
    root.append(edge('skip-ticket-split', 'ticket-decision', 'to-tickets', 'M600 1370 H625 V1626 H600', 'choice'))
    root.append(edge('one-context-direct', 'vertical-slicing', 'implement', 'M600 1114 H695 V602 H790', 'choice'))
    note(root, 790, 1590, '缺行为验收：create-verification-skill；漂移：maintain-verification-skill' if language == 'zh-CN' else 'No behavior checks: create-verification-skill; drift: maintain-verification-skill')
    note(root, 790, 1620, '形式验证缺口：提议 create-formal-verification-skill' if language == 'zh-CN' else 'Formal-check gap: propose create-formal-verification-skill')
    note(root, 100, 1698, '单上下文：手动 Spec → 02B；编排发布单票 → 03。逐票发布例外见原 Skill。' if language == 'zh-CN' else 'One context: manual Spec → 02B; automation publishes one ticket → 03. Per-ticket release: see owner.', 1900)
    add_pipeline(root, original, language)
    add_review(root, original, language)
    finish(root, language)
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2080 2940" width="2080" height="2940">']
    lines.extend(ET.tostring(child, encoding='unicode') for child in root)
    lines.append('</svg>')
    return '\n'.join(lines)


if __name__ == '__main__':
    for language in ('zh-CN', 'en'):
        target = ROOT / f'development-workflow.{language}.svg'
        target.write_text(render(language), encoding='utf-8')
        print(target)
