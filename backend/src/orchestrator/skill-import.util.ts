import { createHash } from 'node:crypto';

export const MIN_SKILL_CHARS = 200;
export const TOP_BULLET_COUNT = 8;
export const BODY_EXCERPT_CHARS = 3000;
export const PERSONALITY_PATH = 'backend/src/orchestrator/personality.ts';

export interface SkillImportRef {
  source: string;
  skillSlug: string;
  url: string;
}

export interface ValidatedSkill {
  name: string;
  description: string;
  body: string;
  raw: string;
}

export type SkillValidationResult =
  | { ok: true; skill: ValidatedSkill }
  | { ok: false; reason: string };

export function normalizeSkillSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^skills\//, '')
    .replace(/\/skill\.md$/i, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const SOURCE_ALIASES: Record<string, string> = {
  superpowers: 'obra/superpowers',
  'obra/superpowers': 'obra/superpowers',
  'anthropics/skills': 'anthropics/skills',
  'vercel-labs/skills': 'vercel-labs/skills',
  'vercel-labs/agent-skills': 'vercel-labs/agent-skills',
  'vercel-labs': 'vercel-labs/skills',
};

const RAW_URL_TEMPLATES: Record<string, (slug: string) => string[]> = {
  'obra/superpowers': (slug) => [
    `https://raw.githubusercontent.com/obra/superpowers/main/skills/${slug}/SKILL.md`,
  ],
  'anthropics/skills': (slug) => [
    `https://raw.githubusercontent.com/anthropics/skills/main/${slug}/SKILL.md`,
    `https://raw.githubusercontent.com/anthropics/skills/main/skills/${slug}/SKILL.md`,
  ],
  'vercel-labs/skills': (slug) => [
    `https://raw.githubusercontent.com/vercel-labs/skills/main/skills/${slug}/SKILL.md`,
  ],
  'vercel-labs/agent-skills': (slug) => [
    `https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/${slug}/SKILL.md`,
    `https://raw.githubusercontent.com/vercel-labs/agent-skills/main/${slug}/SKILL.md`,
  ],
};

const GITHUB_SOURCE_RE = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;

export function resolveKnownSource(raw: string): string | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?(github\.com|skills\.sh)\//, '')
    .replace(/\/$/, '');
  if (SOURCE_ALIASES[key]) {
    return SOURCE_ALIASES[key];
  }
  if (RAW_URL_TEMPLATES[key]) {
    return key;
  }
  // owner/repo or owner/repo/skill-slug from skills.sh
  const parts = key.split('/').filter(Boolean);
  if (parts.length >= 2 && GITHUB_SOURCE_RE.test(`${parts[0]}/${parts[1]}`)) {
    return `${parts[0]}/${parts[1]}`;
  }
  return null;
}

export function candidateRawSkillUrls(source: string, skillSlug: string): string[] {
  const resolved = resolveKnownSource(source);
  if (!resolved) {
    return [];
  }
  const slug = normalizeSkillSlug(skillSlug);
  if (!slug) {
    return [];
  }
  const known = RAW_URL_TEMPLATES[resolved];
  if (known) {
    return known(slug);
  }
  // Generic GitHub skill layouts used across the ecosystem
  return [
    `https://raw.githubusercontent.com/${resolved}/main/skills/${slug}/SKILL.md`,
    `https://raw.githubusercontent.com/${resolved}/main/${slug}/SKILL.md`,
  ];
}

export function buildRawSkillUrl(
  source: string,
  skillSlug: string,
): { ok: true; source: string; skillSlug: string; url: string; urls: string[] } | { ok: false; reason: string } {
  const resolved = resolveKnownSource(source);
  if (!resolved) {
    return {
      ok: false,
      reason: `Unknown skill source "${source}". Use owner/repo (e.g. vercel-labs/skills, obra/superpowers, anthropics/skills).`,
    };
  }
  const slug = normalizeSkillSlug(skillSlug);
  if (!slug) {
    return { ok: false, reason: 'Skill slug is empty or invalid.' };
  }
  const urls = candidateRawSkillUrls(resolved, slug);
  if (!urls.length) {
    return { ok: false, reason: `No raw URL candidates for ${resolved}/${slug}.` };
  }
  return { ok: true, source: resolved, skillSlug: slug, url: urls[0], urls };
}

/** Parse https://skills.sh/owner/repo/skill-slug or www variant. */
export function parseSkillsShUrl(text: string): { source: string; skillSlug: string } | null {
  const match =
    /https?:\/\/(?:www\.)?skills\.sh\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)\/([a-z0-9_.-]+)/i.exec(
      text.trim(),
    );
  if (!match) {
    return null;
  }
  return {
    source: `${match[1]}/${match[2]}`,
    skillSlug: normalizeSkillSlug(match[3]),
  };
}

export function isSkillImportRequest(text: string): boolean {
  return matchSkillImportPhrase(text) !== null || parseSkillsShUrl(text) !== null;
}

const SKILL_SLUG_TOKEN = String.raw`["'\`]?([a-z0-9][a-z0-9._/-]*)["'\`]?`;
const SOURCE_TOKEN = String.raw`([a-z0-9][a-z0-9._/-]*)`;

/** Phrase match only — source may still be unknown (caller reports via buildRawSkillUrl). */
export function matchSkillImportPhrase(text: string): { skillSlug: string; sourceRaw: string } | null {
  const fromSkillsSh = parseSkillsShUrl(text);
  if (fromSkillsSh) {
    return { skillSlug: fromSkillsSh.skillSlug, sourceRaw: fromSkillsSh.source };
  }

  const t = text.trim();
  if (!t) {
    return null;
  }

  // Include "integrate skill X from Y" here so it is treated as a NEW import, not approval
  // of a previously pending skill (approval is short: approve / yes / go ahead).
  const patterns = [
    new RegExp(
      String.raw`\b(?:import|fetch|add|integrate)\s+(?:the\s+)?skill\s+${SKILL_SLUG_TOKEN}\s+from\s+${SOURCE_TOKEN}`,
      'i',
    ),
    new RegExp(
      String.raw`\b(?:import|fetch|add|integrate)\s+${SKILL_SLUG_TOKEN}\s+skill\s+from\s+${SOURCE_TOKEN}`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(t);
    if (match) {
      return { skillSlug: match[1], sourceRaw: match[2] };
    }
  }
  return null;
}

export function parseSkillImportRequest(text: string): SkillImportRef | null {
  const phrase = matchSkillImportPhrase(text);
  if (!phrase) {
    return null;
  }
  const built = buildRawSkillUrl(phrase.sourceRaw, phrase.skillSlug);
  if (!built.ok) {
    return null;
  }
  return { source: built.source, skillSlug: built.skillSlug, url: built.url };
}

export function isSkillIntegrateApproval(text: string, recentContext: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  // A new "import/integrate skill X from Y" always wins over stale pending approval.
  if (matchSkillImportPhrase(t)) {
    return false;
  }
  if (!hasPendingSkillImportContext(recentContext)) {
    return false;
  }
  if (
    /\b(approve|open (the )?pr|create (the )?pr|go ahead|do it|proceed)\b/i.test(t)
  ) {
    return true;
  }
  // Bare "integrate" alone is approval; "integrate skill X from Y" already excluded above.
  if (/^(integrate)\b/i.test(t) && !/\bfrom\b/i.test(t)) {
    return true;
  }
  return /^(yes|yeah|yep|sure|ok|okay|please)\b/i.test(t);
}

export function hasPendingSkillImportContext(recentContext: string): boolean {
  return (
    /Content hash:\s*[a-f0-9]{8,}/i.test(recentContext) &&
    (/Proposed append-only section/i.test(recentContext) ||
      /<!-- skill-import:[a-z0-9._-]+ -->/i.test(recentContext) ||
      /Say (approve|integrate)/i.test(recentContext))
  );
}

export function parsePendingSkillImport(recentContext: string): {
  source: string;
  skillSlug: string;
  url: string;
  hash: string;
} | null {
  // Prefer the most recent import reply in history (not the oldest).
  const hashes = [...recentContext.matchAll(/Content hash:\s*([a-f0-9]{8,64})/gi)];
  const urls = [
    ...recentContext.matchAll(/Fetched from:\s*(https:\/\/raw\.githubusercontent\.com\/[^\s]+)/gi),
  ];
  const fallbackUrls = [
    ...recentContext.matchAll(
      /(https:\/\/raw\.githubusercontent\.com\/[^\s]+SKILL\.md)/gi,
    ),
  ];
  const urlMatches = urls.length ? urls : fallbackUrls;
  if (!hashes.length || !urlMatches.length) {
    return null;
  }

  const hash = hashes[hashes.length - 1][1].toLowerCase();
  const url = urlMatches[urlMatches.length - 1][1].trim();
  const parsed = parseRawSkillUrl(url);
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    url,
    hash,
  };
}

export function parseRawSkillUrl(url: string): { source: string; skillSlug: string } | null {
  const trimmed = url.trim();
  const skillsLayout =
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/skills\/([^/]+)\/SKILL\.md$/i.exec(
      trimmed,
    );
  if (skillsLayout) {
    return {
      source: `${skillsLayout[1]}/${skillsLayout[2]}`.toLowerCase(),
      skillSlug: normalizeSkillSlug(skillsLayout[3]),
    };
  }
  const rootLayout =
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/[^/]+\/([^/]+)\/SKILL\.md$/i.exec(
      trimmed,
    );
  if (rootLayout) {
    return {
      source: `${rootLayout[1]}/${rootLayout[2]}`.toLowerCase(),
      skillSlug: normalizeSkillSlug(rootLayout[3]),
    };
  }
  return null;
}

export function hashSkillContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
}

export function validateSkillMarkdown(text: string, expectedSlug?: string): SkillValidationResult {
  const raw = text.trim();
  if (!raw) {
    return { ok: false, reason: 'Fetched content is empty.' };
  }
  if (raw.length < MIN_SKILL_CHARS) {
    return {
      ok: false,
      reason: `Content too short (${raw.length} chars; need ≥ ${MIN_SKILL_CHARS}). Not a real SKILL.md.`,
    };
  }
  if (
    /<!DOCTYPE/i.test(raw) ||
    /<html[\s>]/i.test(raw) ||
    /skills\.sh/i.test(raw) ||
    /<nav[\s>]/i.test(raw)
  ) {
    return {
      ok: false,
      reason: 'Content looks like HTML/navigation furniture, not a SKILL.md. Rejected.',
    };
  }
  if (!/^---\r?\n/.test(raw)) {
    return { ok: false, reason: 'Missing YAML frontmatter (expected to start with ---).' };
  }

  const fmEnd = raw.indexOf('\n---', 3);
  if (fmEnd < 0 || fmEnd > 2048) {
    return { ok: false, reason: 'YAML frontmatter is missing a closing --- within the first 2KB.' };
  }

  const frontmatter = raw.slice(3, fmEnd).trim();
  const body = raw.slice(fmEnd + 4).replace(/^\r?\n/, '');
  const name = extractFrontmatterField(frontmatter, 'name');
  const description = extractFrontmatterField(frontmatter, 'description');
  if (!name) {
    return { ok: false, reason: 'Frontmatter missing non-empty name: field.' };
  }
  if (!description) {
    return { ok: false, reason: 'Frontmatter missing non-empty description: field.' };
  }

  const hasHeading = /^#\s+/m.test(body);
  const longParagraph = body
    .split(/\n\s*\n/)
    .some((p) => p.replace(/\s+/g, ' ').trim().length >= 80);
  if (!hasHeading && !longParagraph) {
    return {
      ok: false,
      reason: 'Body has no markdown heading and no substantive paragraph (≥80 chars).',
    };
  }

  if (expectedSlug) {
    const expected = normalizeSkillSlug(expectedSlug);
    const actual = normalizeSkillSlug(name);
    if (expected && actual && expected !== actual) {
      return {
        ok: false,
        reason: `Frontmatter name "${name}" does not match requested skill slug "${expectedSlug}".`,
      };
    }
  }

  return { ok: true, skill: { name, description, body, raw } };
}

function extractFrontmatterField(frontmatter: string, field: string): string {
  const re = new RegExp(`^${field}:\\s*(.+)$`, 'im');
  const match = re.exec(frontmatter);
  if (!match) {
    return '';
  }
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

export function extractTopBullets(body: string, n = TOP_BULLET_COUNT): string[] {
  const bullets: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const text = match[1].trim();
    if (text.length < 3) {
      continue;
    }
    bullets.push(text);
    if (bullets.length >= n) {
      break;
    }
  }
  return bullets;
}

export function skillImportMarker(slug: string): string {
  return `<!-- skill-import:${normalizeSkillSlug(slug)} -->`;
}

export function buildPersonalityAppendSection(input: {
  name: string;
  description: string;
  bullets: string[];
  slug?: string;
}): string {
  const slug = normalizeSkillSlug(input.slug ?? input.name);
  const title = humanizeSkillTitle(input.name);
  const lines = [
    skillImportMarker(slug),
    `${title} — ${input.description}:`,
  ];
  if (input.bullets.length) {
    for (const bullet of input.bullets) {
      lines.push(`- ${bullet}`);
    }
  } else {
    lines.push(`- Follow the ${title} practice when its trigger conditions apply.`);
  }
  return lines.join('\n');
}

function humanizeSkillTitle(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function appendPersonalitySection(
  currentFile: string,
  section: string,
  slug: string,
): { content: string; alreadyPresent: boolean } {
  const marker = skillImportMarker(slug);
  if (currentFile.includes(marker)) {
    return { content: currentFile, alreadyPresent: true };
  }

  const closeIdx = currentFile.lastIndexOf('`;');
  if (closeIdx === -1) {
    return {
      content: `${currentFile.trimEnd()}\n\n${section}\n`,
      alreadyPresent: false,
    };
  }

  const before = currentFile.slice(0, closeIdx);
  const after = currentFile.slice(closeIdx);
  const spacer = before.endsWith('\n') ? '\n' : '\n\n';
  return {
    content: `${before}${spacer}${section}${after}`,
    alreadyPresent: false,
  };
}

export function stripInspectFileOutput(output: string, path = PERSONALITY_PATH): string {
  let text = output.trim();
  if (text.startsWith('Error:') || text.startsWith('Inspect error:')) {
    return text;
  }
  const header = `=== ${path} ===\n`;
  if (text.startsWith(header)) {
    text = text.slice(header.length);
  }
  return text;
}

export function buildSkillImportSuccessReply(input: {
  url: string;
  hash: string;
  skill: ValidatedSkill;
  proposedSection: string;
}): string {
  const excerpt =
    input.skill.raw.length > BODY_EXCERPT_CHARS
      ? `${input.skill.raw.slice(0, BODY_EXCERPT_CHARS)}\n…[truncated]`
      : input.skill.raw;

  return [
    'Skill import ready for review (nothing written yet).',
    '',
    `Fetched from: ${input.url}`,
    `Content hash: ${input.hash}`,
    `name: ${input.skill.name}`,
    `description: ${input.skill.description}`,
    '',
    '--- SKILL.md excerpt ---',
    excerpt,
    '--- end excerpt ---',
    '',
    'Proposed append-only section for backend/src/orchestrator/personality.ts:',
    input.proposedSection,
    '',
    'Say approve (or integrate) to write this section and open a pull request.',
  ].join('\n');
}

export function buildSkillImportFailureReply(reason: string): string {
  return `Skill import failed: ${reason}`;
}

export function buildSkillIntegrateFailureReply(reason: string): string {
  return `Skill integrate failed: ${reason}`;
}

export function buildSkillIntegrateAlreadyPresentReply(slug: string): string {
  return `Skill integrate skipped: <!-- skill-import:${normalizeSkillSlug(slug)} --> is already in personality.ts. No pull request opened.`;
}

export function buildSkillIntegrateSuccessReply(prOutput: string): string {
  const firstLine = prOutput.split('\n').map((l) => l.trim()).find(Boolean) ?? prOutput.trim();
  return `Done, sir. ${firstLine}`;
}
