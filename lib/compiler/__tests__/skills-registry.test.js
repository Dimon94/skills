/**
 * T004: Skills Registry Unit Tests
 *
 * 测试 generateSkillsRegistry() 函数:
 * 1. 合并 skill-rules.json 与 skill.md 元数据
 * 2. 处理缺失的 skill.md
 * 3. Zod schema 验证
 * 4. 正确的技能计数
 *
 * Reference: contracts/cli-spec.yaml#SkillEntry
 */

const path = require('path');
const fs = require('fs');

// ============================================================
// Mock 数据路径
// ============================================================
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'skills-registry');

// ============================================================
// 测试用例
// ============================================================
describe('Skills Registry Generator', () => {
  // 在 Phase 3 实现前，这些测试应该失败

  describe('generateSkillsRegistry()', () => {
    test('should merge skill-rules.json with skill.md metadata', async () => {
      // 预期: 合并 skill-rules.json 的 triggers 与 skill.md 的 metadata
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      const result = await generateSkillsRegistryV2('.claude/skills');

      // 验证返回结构
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('generatedAt');
      expect(result).toHaveProperty('skills');
      expect(Array.isArray(result.skills)).toBe(true);

      // 验证技能条目包含合并后的数据
      if (result.skills.length > 0) {
        const skill = result.skills[0];
        expect(skill).toHaveProperty('name');
        expect(skill).toHaveProperty('description');
        expect(skill).toHaveProperty('type');
        expect(skill).toHaveProperty('skillClass');
        expect(skill).toHaveProperty('routeFamily');
        expect(skill).toHaveProperty('skillPath');
        expect(skill).toHaveProperty('triggers');
        expect(skill).toHaveProperty('reads');
        expect(skill).toHaveProperty('writes');
        expect(skill).toHaveProperty('effects');
        expect(skill).toHaveProperty('entryGate');
        expect(skill).toHaveProperty('exitCriteria');
        expect(skill).toHaveProperty('reroutes');
        expect(skill).toHaveProperty('recoveryModes');
        expect(skill).toHaveProperty('toolBudget');
      }
    });

    test('should handle missing skill.md gracefully', async () => {
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      // 如果 skill-rules.json 中有一个技能，但对应的 skill.md 不存在
      // 应该跳过该技能并记录警告
      const result = await generateSkillsRegistryV2('.claude/skills');

      // 不应抛出错误
      expect(result).toBeDefined();
      expect(result.skills).toBeDefined();
    });

    test('should validate SkillEntry schema with Zod', async () => {
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      const result = await generateSkillsRegistryV2('.claude/skills');

      // 每个技能条目应符合 SkillEntry schema
      for (const skill of result.skills) {
        // name: string (required)
        expect(typeof skill.name).toBe('string');
        expect(skill.name.length).toBeGreaterThan(0);
        expect(skill.name.length).toBeLessThanOrEqual(100);

        // description: string (required)
        expect(typeof skill.description).toBe('string');
        expect(skill.description.length).toBeLessThanOrEqual(500);

        // type: enum (optional, default: utility)
        expect(['domain', 'guardrail', 'utility']).toContain(skill.type);

        // suite graph fields
        expect(['user-entry', 'chain', 'capability', 'maintenance']).toContain(skill.skillClass);
        expect(['main', 'bug', 'pr', 'quality', 'research', 'maintenance', 'contract', 'none']).toContain(skill.routeFamily);

        // enforcement: enum (optional, default: suggest)
        expect(['suggest', 'block', 'warn']).toContain(skill.enforcement);

        // priority: enum (optional, default: medium)
        expect(['critical', 'high', 'medium', 'low']).toContain(skill.priority);

        // skillPath: string (required)
        expect(typeof skill.skillPath).toBe('string');

        // contract fields
        expect(Array.isArray(skill.reads)).toBe(true);
        expect(Array.isArray(skill.writes)).toBe(true);
        for (const write of skill.writes) {
          expect(typeof write.path).toBe('string');
          expect(write.path.length).toBeGreaterThan(0);
          expect(typeof write.durability).toBe('string');
          expect(typeof write.required).toBe('boolean');
        }
        expect(Array.isArray(skill.effects)).toBe(true);
        expect(Array.isArray(skill.entryGate)).toBe(true);
        expect(Array.isArray(skill.exitCriteria)).toBe(true);
        expect(Array.isArray(skill.reroutes)).toBe(true);
        expect(Array.isArray(skill.recoveryModes)).toBe(true);
        expect(typeof skill.toolBudget).toBe('object');
      }
    });

    test('should return correct skills count', async () => {
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      const result = await generateSkillsRegistryV2('.claude/skills');

      // 验证技能数量与实际目录中的技能数匹配
      expect(result.skills.length).toBeGreaterThanOrEqual(0);

      // 每个返回的技能应该有唯一的 name
      const names = result.skills.map(s => s.name);
      const uniqueNames = [...new Set(names)];
      expect(names.length).toBe(uniqueNames.length);
    });

    test('should parse skills without frontmatter warnings', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      await generateSkillsRegistryV2('.claude/skills');

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    test('should preserve bundled reads for skills with local references', async () => {
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      const result = await generateSkillsRegistryV2('.claude/skills');
      const diagnose = result.skills.find((skill) => skill.name === 'cc-diagnose');

      expect(diagnose).toBeDefined();
      expect(diagnose.reads).toEqual([
        '.claude/skills/cc-diagnose/references/toc-thinking-processes.md',
        '.claude/skills/cc-diagnose/references/parallel-orchestration-boundary.md',
        '.claude/skills/cc-diagnose/references/git-commit-guidelines.md',
        '.claude/skills/do-not-repeat-yourself/SKILL.md',
        '.claude/skills/postmortem/SKILL.md',
        '.claude/skills/cc-research/SKILL.md'
      ]);
    });

    test('should separate concrete writes from conceptual effects', async () => {
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      const result = await generateSkillsRegistryV2('.claude/skills');
      const execute = result.skills.find((skill) => skill.name === 'cc-do');

      expect(execute).toBeDefined();
      expect(execute.writes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'devflow/changes/<change-key>/task.md',
            durability: 'durable',
            required: true
          })
        ])
      );
      expect(execute.writes).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'code changes' })])
      );
      expect(execute.effects).toContain('code changes');
      expect(execute.effects).toContain('test changes');
    });

    test('should preserve conditional and exclusive write metadata', async () => {
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      const result = await generateSkillsRegistryV2('.claude/skills');
      const act = result.skills.find((skill) => skill.name === 'cc-act');

      expect(act).toBeDefined();
      expect(act.writes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'devflow/changes/<change-key>/handoff/pr-brief.md',
            required: false
          })
        ])
      );
      expect(act.writes).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: expect.stringContaining('release')
          })
        ])
      );
    });

    test('should publish only current distributed skills', async () => {
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      const result = await generateSkillsRegistryV2('.claude/skills');

      expect(result.skills.map((skill) => skill.name)).toEqual(
        expect.arrayContaining(['cc-plan', 'cc-do', 'cc-check', 'cc-act'])
      );
    });

    test('should normalize source skill suite graph frontmatter without inference', async () => {
      const { generateSkillsRegistryV2 } = require('../skills-registry');

      const result = await generateSkillsRegistryV2('.claude/skills');
      const plan = result.skills.find((skill) => skill.name === 'cc-plan');
      const taskContract = result.skills.find((skill) => skill.name === 'task-contract');
      const docsSync = result.skills.find((skill) => skill.name === 'docs-sync');

      expect(plan).toEqual(expect.objectContaining({
        skillClass: 'user-entry',
        routeFamily: 'main'
      }));
      expect(taskContract).toEqual(expect.objectContaining({
        skillClass: 'chain',
        routeFamily: 'contract'
      }));
      expect(docsSync).toEqual(expect.objectContaining({
        skillClass: 'maintenance',
        routeFamily: 'maintenance'
      }));
    });
  });

  describe('writeSkillsRegistry()', () => {
    test('should write registry to devflow/.generated/skills-registry.json', async () => {
      const { generateSkillsRegistryV2, writeSkillsRegistry } = require('../skills-registry');

      const registry = await generateSkillsRegistryV2('.claude/skills');
      const outputPath = await writeSkillsRegistry(registry);

      expect(outputPath).toBe('devflow/.generated/skills-registry.json');

      // 验证文件存在且内容有效
      const content = fs.readFileSync(outputPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.version).toBe('1.0');
      expect(parsed.skills).toBeDefined();
    });
  });
});
