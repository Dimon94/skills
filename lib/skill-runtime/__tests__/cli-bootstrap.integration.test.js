/**
 * [INPUT]: 依赖 child_process 调用 CLI，依赖临时仓库夹具与 .claude 模板文件。
 * [OUTPUT]: 验证恢复后的多平台 CLI 会安装 .claude，并按原版策略覆盖差异文件。
 * [POS]: lib/skill-runtime/__tests__ 的 CLI 分发回归测试。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_BIN = path.join(REPO_ROOT, 'bin/cc-devflow-cli.js');
const TEMPLATE_ROOT = path.join(REPO_ROOT, '.claude');

function runCli(args, cwd, env = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    }
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function readPackageJson(repoRoot) {
  const packagePath = path.join(repoRoot, 'package.json');
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

describe('cc-devflow cli distribution bootstrap', () => {
  let repoRoot;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cli-bootstrap-'));
    fs.writeFileSync(
      path.join(repoRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'tmp-repo',
          version: '0.0.0',
          scripts: {
            test: 'node -e "process.exit(0)"'
          }
        },
        null,
        2
      )
    );
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  test('init installs .claude without mutating unrelated package scripts', () => {
    const result = runCli(['init', '--dir', repoRoot], repoRoot);
    expect(result.status).toBe(0);

    const packageJson = readPackageJson(repoRoot);
    expect(packageJson.scripts.test).toBe('node -e "process.exit(0)"');
    expect(packageJson.scripts).toEqual({
      test: 'node -e "process.exit(0)"'
    });

    expect(fs.existsSync(path.join(repoRoot, '.claude', 'skills', 'cc-plan', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.claude', 'skills', 'cc-diagnose', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.claude', 'skills', 'docs-sync'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, '.claude', 'skills', 'npm-release'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, '.claude', 'tsc-cache'))).toBe(false);
  });

  test('init does not bake project YAML output policy into managed Claude skills', () => {
    const customSkillDir = path.join(repoRoot, '.claude', 'skills', 'custom-skill');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(path.join(customSkillDir, 'SKILL.md'), '# Custom Skill\n');
    fs.mkdirSync(path.join(repoRoot, '.cc-devflow'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.cc-devflow', 'config.yml'),
      [
        'version: 1',
        'output:',
        '  document_language: zh-CN',
        'agent_preferences:',
        '  general:',
        '    - 先给结论。',
        ''
      ].join('\n')
    );

    const result = runCli(['init', '--dir', repoRoot], repoRoot);
    expect(result.status).toBe(0);

    const skillContent = fs.readFileSync(
      path.join(repoRoot, '.claude', 'skills', 'cc-plan', 'SKILL.md'),
      'utf8'
    );

    expect(skillContent).not.toContain('<!-- CC-DEVFLOW OUTPUT POLICY START -->');
    expect(skillContent).not.toContain('文档语言: zh-CN');
    expect(skillContent).toContain('resolve-cc-devflow.sh');
    expect(skillContent).toContain('bash "$DEVFLOW" config resolve --format policy');
    expect(fs.readFileSync(path.join(customSkillDir, 'SKILL.md'), 'utf8')).toBe('# Custom Skill\n');
  });

  test('config commands manage and diagnose the effective output policy', () => {
    fs.mkdirSync(path.join(repoRoot, '.cc-devflow'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.cc-devflow', 'config.yml'),
      [
        'version: 1',
        'output:',
        '  document_language: zh-CN',
        ''
      ].join('\n')
    );

    const resolveResult = runCli(
      ['config', 'resolve', '--cwd', repoRoot, '--format', 'policy', '--trace'],
      repoRoot
    );
    const getResult = runCli(['config', 'get', 'output.document_language', '--cwd', repoRoot], repoRoot);
    const doctorResult = runCli(['config', 'doctor', '--cwd', repoRoot], repoRoot);

    expect(resolveResult.status).toBe(0);
    expect(resolveResult.stdout).toContain('CC-DevFlow 输出策略');
    expect(resolveResult.stdout).toContain('Output language: zh-CN');
    expect(resolveResult.stdout).toContain('标题、正文、占位符、证据说明和 PR/body 草稿必须使用简体中文');
    expect(resolveResult.stdout).toContain('Trace:');
    expect(resolveResult.stdout).toContain('project');
    expect(getResult.status).toBe(0);
    expect(getResult.stdout.trim()).toBe('zh-CN');
    expect(doctorResult.status).toBe(0);
    expect(doctorResult.stdout).toContain('Config OK');

    const setResult = runCli(
      ['config', 'set', 'output.document_language', 'en', '--cwd', repoRoot, '--project'],
      repoRoot
    );
    expect(setResult.status).toBe(0);
    expect(runCli(['config', 'get', 'output.document_language', '--cwd', repoRoot], repoRoot).stdout.trim()).toBe('en');

    const isolatedHome = path.join(repoRoot, 'home');
    const userInitResult = runCli(
      ['config', 'init', '--cwd', repoRoot, '--user', '--force'],
      repoRoot,
      { HOME: isolatedHome }
    );
    expect(userInitResult.status).toBe(0);
    expect(userInitResult.stdout).toContain(path.join(isolatedHome, '.cc-devflow', 'config.yml'));
  });

  test('init overwrites diverged .claude files with packaged content', () => {
    expect(runCli(['init', '--dir', repoRoot], repoRoot).status).toBe(0);

    const targetSkill = path.join(repoRoot, '.claude', 'skills', 'cc-plan', 'SKILL.md');
    fs.writeFileSync(targetSkill, '# local override\n');

    const result = runCli(['init', '--dir', repoRoot], repoRoot);
    expect(result.status).toBe(0);

    expect(fs.existsSync(`${targetSkill}.new`)).toBe(false);
    expect(fs.readFileSync(targetSkill, 'utf8')).toBe(
      fs.readFileSync(path.join(TEMPLATE_ROOT, 'skills', 'cc-plan', 'SKILL.md'), 'utf8')
    );
  });

  test('force re-initialization resets .claude to the packaged template', () => {
    expect(runCli(['init', '--dir', repoRoot], repoRoot).status).toBe(0);

    const targetSkill = path.join(repoRoot, '.claude', 'skills', 'cc-plan', 'SKILL.md');
    const staleManagedFile = path.join(repoRoot, '.claude', 'skills', 'cc-act', 'assets', 'STALE.md');
    fs.mkdirSync(path.dirname(staleManagedFile), { recursive: true });
    fs.writeFileSync(targetSkill, '# local override\n');
    fs.writeFileSync(staleManagedFile, '# stale\n');

    const result = runCli(['init', '--dir', repoRoot, '--force'], repoRoot);
    expect(result.status).toBe(0);

    expect(fs.readFileSync(targetSkill, 'utf8')).toBe(
      fs.readFileSync(path.join(TEMPLATE_ROOT, 'skills', 'cc-plan', 'SKILL.md'), 'utf8')
    );
    expect(fs.existsSync(`${targetSkill}.new`)).toBe(false);
    expect(fs.existsSync(staleManagedFile)).toBe(false);
  });

  test('adapt mirrors public skills into .codex/skills for Codex', () => {
    expect(runCli(['init', '--dir', repoRoot], repoRoot).status).toBe(0);
    const staleCodexAsset = path.join(repoRoot, '.codex', 'skills', 'cc-act', 'assets', 'STALE.md');
    fs.mkdirSync(path.dirname(staleCodexAsset), { recursive: true });
    fs.writeFileSync(staleCodexAsset, '# stale\n');

    const result = runCli(['adapt', '--cwd', repoRoot, '--platform', 'codex'], repoRoot);
    expect(result.status).toBe(0);

    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'cc-devflow', 'SKILL.md'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'cc-plan', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'cc-diagnose', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'cc-do', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'cc-review', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'cc-check', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'cc-act', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'cc-research', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(staleCodexAsset)).toBe(false);

    const codexDiagnoseSkill = fs.readFileSync(
      path.join(repoRoot, '.codex', 'skills', 'cc-diagnose', 'SKILL.md'),
      'utf8'
    );
    const matter = require('gray-matter');
    const parsed = matter(codexDiagnoseSkill);
    expect(parsed.data.name).toBe('cc-diagnose');
    expect(parsed.data.reads).toEqual([
      '.codex/skills/cc-diagnose/references/toc-thinking-processes.md',
      '.codex/skills/cc-diagnose/references/parallel-orchestration-boundary.md',
      '.codex/skills/cc-diagnose/references/git-commit-guidelines.md',
      '.codex/skills/do-not-repeat-yourself/SKILL.md',
      '.codex/skills/postmortem/SKILL.md',
      '.codex/skills/cc-research/SKILL.md'
    ]);

    const codexDoSkill = matter(
      fs.readFileSync(path.join(repoRoot, '.codex', 'skills', 'cc-do', 'SKILL.md'), 'utf8')
    );
    expect(codexDoSkill.data.writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'devflow/changes/<change-key>/task.md',
          durability: 'durable',
          required: true
        })
      ])
    );
    expect(codexDoSkill.data.effects).toContain('code changes');
  });

  test('adapt mirrors Codex skills without baking project YAML output policy', () => {
    fs.mkdirSync(path.join(repoRoot, '.cc-devflow'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.cc-devflow', 'config.yml'),
      [
        'version: 1',
        'output:',
        '  document_language: zh-CN',
        'agent_preferences:',
        '  documentation:',
        '    - 输出文档默认使用中文。',
        ''
      ].join('\n')
    );
    expect(runCli(['init', '--dir', repoRoot], repoRoot).status).toBe(0);

    const result = runCli(['adapt', '--cwd', repoRoot, '--platform', 'codex'], repoRoot);
    expect(result.status).toBe(0);

    const codexPlanSkill = fs.readFileSync(
      path.join(repoRoot, '.codex', 'skills', 'cc-plan', 'SKILL.md'),
      'utf8'
    );
    expect(codexPlanSkill).not.toContain('<!-- CC-DEVFLOW OUTPUT POLICY START -->');
    expect(codexPlanSkill).not.toContain('文档语言: zh-CN');
    expect(codexPlanSkill).toContain('resolve-cc-devflow.sh');
    expect(codexPlanSkill).toContain('bash "$DEVFLOW" config resolve --format policy');
  });

  test('adapt preserves pre-existing non-public Codex skills and does not mirror new private ones', () => {
    expect(runCli(['init', '--dir', repoRoot], repoRoot).status).toBe(0);

    const privateClaudeSkill = path.join(repoRoot, '.claude', 'skills', 'skill-creator');
    const preservedCodexSkill = path.join(repoRoot, '.codex', 'skills', 'local-postmortem-gate');
    fs.mkdirSync(privateClaudeSkill, { recursive: true });
    fs.mkdirSync(preservedCodexSkill, { recursive: true });
    fs.writeFileSync(path.join(privateClaudeSkill, 'SKILL.md'), '# private skill\n');
    fs.writeFileSync(path.join(preservedCodexSkill, 'SKILL.md'), '# original codex skill\n');

    const result = runCli(['adapt', '--cwd', repoRoot, '--platform', 'codex'], repoRoot);
    expect(result.status).toBe(0);

    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'local-postmortem-gate', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, '.codex', 'skills', 'skill-creator'))).toBe(false);
  });
});
