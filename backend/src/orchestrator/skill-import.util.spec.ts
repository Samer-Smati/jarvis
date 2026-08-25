import {
  appendPersonalitySection,
  buildPersonalityAppendSection,
  buildRawSkillUrl,
  extractTopBullets,
  hashSkillContent,
  isSkillImportRequest,
  isSkillIntegrateApproval,
  matchSkillImportPhrase,
  parsePendingSkillImport,
  parseSkillImportRequest,
  skillImportMarker,
  validateSkillMarkdown,
} from './skill-import.util';
import {
  extractSkillFindQuery,
  isSkillFindRequest,
  pickBestImportableSkill,
  searchCuratedSkills,
} from './skills-find.util';

const GOOD_SKILL = `---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 1: Load and Review Plan
1. Ensure an isolated workspace
2. Read plan file
3. Review critically - identify any questions or concerns about the plan
4. If concerns: Raise them with your human partner before starting
5. If no concerns: Create todos for the plan items and proceed

### Step 2: Execute Tasks

For each task:
- Mark as in_progress
- Follow each step exactly
- Run verifications as specified
- Mark as completed

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Stop when blocked, don't guess
`;

describe('skill-import.util', () => {
  describe('buildRawSkillUrl', () => {
    it('resolves obra/superpowers and alias', () => {
      const a = buildRawSkillUrl('obra/superpowers', 'executing-plans');
      expect(a.ok).toBe(true);
      if (a.ok) {
        expect(a.source).toBe('obra/superpowers');
        expect(a.skillSlug).toBe('executing-plans');
        expect(a.url).toBe(
          'https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
        );
        expect(a.urls[0]).toBe(a.url);
      }
      const b = buildRawSkillUrl('superpowers', 'executing-plans');
      expect(b.ok && b.url).toBe(
        'https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
      );
    });

    it('resolves anthropics/skills', () => {
      const r = buildRawSkillUrl('anthropics/skills', 'docx');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.source).toBe('anthropics/skills');
        expect(r.skillSlug).toBe('docx');
        expect(r.url).toContain('anthropics/skills');
        expect(r.url).toContain('docx/SKILL.md');
      }
    });

    it('resolves vercel-labs/skills find-skills and skills.sh URLs', () => {
      const r = buildRawSkillUrl('vercel-labs/skills', 'find-skills');
      expect(r).toEqual({
        ok: true,
        source: 'vercel-labs/skills',
        skillSlug: 'find-skills',
        url: 'https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md',
        urls: ['https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md'],
      });
      expect(isSkillImportRequest('https://www.skills.sh/vercel-labs/skills/find-skills')).toBe(true);
      expect(parseSkillImportRequest('https://www.skills.sh/vercel-labs/skills/find-skills')).toEqual({
        source: 'vercel-labs/skills',
        skillSlug: 'find-skills',
        url: 'https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md',
      });
    });

    it('rejects invalid sources', () => {
      const r = buildRawSkillUrl('!!!', 'foo');
      expect(r.ok).toBe(false);
    });
  });

  describe('skill find', () => {
    it('matches find-skills style requests and extracts query', () => {
      expect(isSkillFindRequest('find a skill for code review')).toBe(true);
      expect(extractSkillFindQuery('find a skill for code review')).toBe('code review');
    });

    it('picks a trusted curated skill for auto-import', () => {
      const hits = searchCuratedSkills('find skill discovery');
      expect(hits.some((h) => h.slug === 'find-skills')).toBe(true);
      const best = pickBestImportableSkill(hits);
      expect(best?.source).toBe('vercel-labs/skills');
      expect(best?.slug).toBe('find-skills');
    });
  });

  describe('request matchers', () => {
    it('parses import skill phrases', () => {
      expect(isSkillImportRequest('import skill executing-plans from obra/superpowers')).toBe(true);
      expect(parseSkillImportRequest('import skill executing-plans from obra/superpowers')?.url).toContain(
        'executing-plans/SKILL.md',
      );
      expect(matchSkillImportPhrase('import skill foo from unknown/repo')).toEqual({
        skillSlug: 'foo',
        sourceRaw: 'unknown/repo',
      });
    });

    it('extracts executing-plans from the exact Import capitalisation (not a prior pending skill)', () => {
      const userText = 'Import skill executing-plans from obra/superpowers';
      const stalePending = [
        'Fetched from: https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md',
        'Content hash: deadbeef0001',
        'Proposed append-only section',
        '<!-- skill-import:test-driven-development -->',
        'Say approve to write',
      ].join('\n');

      expect(isSkillImportRequest(userText)).toBe(true);
      expect(matchSkillImportPhrase(userText)).toEqual({
        skillSlug: 'executing-plans',
        sourceRaw: 'obra/superpowers',
      });
      expect(parseSkillImportRequest(userText)).toEqual({
        source: 'obra/superpowers',
        skillSlug: 'executing-plans',
        url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
      });
      // Must NOT treat a new import phrasing as approval of the previous skill.
      expect(isSkillIntegrateApproval(userText, stalePending)).toBe(false);
    });

    it('treats "integrate skill X from Y" as a new import, not approval of stale pending', () => {
      const userText = 'Integrate skill executing-plans from obra/superpowers';
      const stalePending = [
        'Fetched from: https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md',
        'Content hash: deadbeef0001',
        'Proposed append-only section',
        'Say approve to write',
      ].join('\n');
      expect(matchSkillImportPhrase(userText)?.skillSlug).toBe('executing-plans');
      expect(isSkillIntegrateApproval(userText, stalePending)).toBe(false);
    });

    it('detects integrate approval only with pending import context', () => {
      const pending = [
        'Fetched from: https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
        'Content hash: abcdef123456',
        'Proposed append-only section',
        'Say approve to write',
      ].join('\n');
      expect(isSkillIntegrateApproval('approve', pending)).toBe(true);
      expect(isSkillIntegrateApproval('yes', pending)).toBe(true);
      expect(isSkillIntegrateApproval('integrate', pending)).toBe(true);
      expect(isSkillIntegrateApproval('approve', 'unrelated chat')).toBe(false);
    });

    it('parses the most recent pending import when history has multiple', () => {
      const pending = [
        'Fetched from: https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md',
        'Content hash: deadbeef0001',
        'Proposed append-only section',
        'Fetched from: https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
        'Content hash: abcdef123456',
        'Proposed append-only section',
      ].join('\n');
      expect(parsePendingSkillImport(pending)).toEqual({
        source: 'obra/superpowers',
        skillSlug: 'executing-plans',
        url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
        hash: 'abcdef123456',
      });
    });

    it('parses pending import from assistant context', () => {
      const pending = [
        'Fetched from: https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
        'Content hash: abcdef123456',
        'Proposed append-only section',
      ].join('\n');
      expect(parsePendingSkillImport(pending)).toEqual({
        source: 'obra/superpowers',
        skillSlug: 'executing-plans',
        url: 'https://raw.githubusercontent.com/obra/superpowers/main/skills/executing-plans/SKILL.md',
        hash: 'abcdef123456',
      });
    });
  });

  describe('validateSkillMarkdown', () => {
    it('accepts a real SKILL.md', () => {
      const r = validateSkillMarkdown(GOOD_SKILL, 'executing-plans');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.skill.name).toBe('executing-plans');
        expect(r.skill.description).toMatch(/implementation plan/i);
      }
    });

    it('rejects HTML furniture', () => {
      const html = `<!DOCTYPE html><html><nav>skills.sh</nav><body>${'x'.repeat(250)}</body></html>`;
      const r = validateSkillMarkdown(html);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toMatch(/HTML|furniture/i);
      }
    });

    it('rejects missing frontmatter', () => {
      const r = validateSkillMarkdown(`# Title\n\n${'word '.repeat(50)}`);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toMatch(/frontmatter/i);
      }
    });

    it('rejects too-short content', () => {
      const r = validateSkillMarkdown('---\nname: x\ndescription: y\n---\n\n# Hi\n');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toMatch(/too short/i);
      }
    });
  });

  describe('append-only personality section', () => {
    const baseFile = `export const JARVIS_SYSTEM_PROMPT = \`You are JARVIS.

Verification before completion — evidence before assertions (iron law):
- NO completion claim without fresh verification evidence from THIS turn.

Systematic debugging — root cause before diagnostic claims (iron law):
- NO FIXES OR DIAGNOSTIC CLAIMS WITHOUT ROOT CAUSE INVESTIGATION FIRST.

Memory — permanent conversation history:
- Every message is stored forever.\`;
`;

    it('appends without removing existing sections', () => {
      const section = buildPersonalityAppendSection({
        name: 'executing-plans',
        description: 'Execute written plans with checkpoints',
        bullets: extractTopBullets(GOOD_SKILL),
      });
      expect(section).toContain(skillImportMarker('executing-plans'));
      expect(hashSkillContent(GOOD_SKILL)).toHaveLength(12);

      const once = appendPersonalitySection(baseFile, section, 'executing-plans');
      expect(once.alreadyPresent).toBe(false);
      expect(once.content).toContain('Verification before completion');
      expect(once.content).toContain('Systematic debugging');
      expect(once.content).toContain(skillImportMarker('executing-plans'));
      expect(once.content.endsWith('`;\n') || once.content.includes("`;\n")).toBe(true);

      const twice = appendPersonalitySection(once.content, section, 'executing-plans');
      expect(twice.alreadyPresent).toBe(true);
      expect(twice.content).toBe(once.content);
    });

    it('prefers substantive writing-plans rules over weak early list stubs', () => {
      const writingPlansBody = `
## Overview

Write comprehensive implementation plans with bite-sized tasks. DRY. YAGNI. TDD.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** docs/plans/feature.md
- (User preferences for plan location override this default)

## File Structure

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- Prefer smaller, focused files over large ones that do too much.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step

## No Placeholders

- "TBD", "TODO", "implement later", "fill in details"
- Steps that describe what to do without showing how (code blocks required for code steps)
`;
      const bullets = extractTopBullets(writingPlansBody, 8);
      expect(bullets.some((b) => /Announce at start/i.test(b))).toBe(true);
      expect(bullets.some((b) => /comprehensive implementation plans/i.test(b))).toBe(true);
      expect(bullets.every((b) => !/^\(User preferences/i.test(b))).toBe(true);
      expect(bullets.every((b) => !/"Write the failing test" - step/i.test(b))).toBe(true);
    });
  });
});
