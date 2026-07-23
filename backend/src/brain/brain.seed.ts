import { BrainPage, BrainVault } from './brain.types';

const now = new Date().toISOString();

export function createSeedVault(): BrainVault {
  const pages = {
    'concepts/llm-wiki-pattern.md': {
      path: 'concepts/llm-wiki-pattern.md',
      title: 'LLM Wiki Pattern',
      category: 'concept' as const,
      content: `# LLM Wiki Pattern

Based on Andrej Karpathy's approach and claude-obsidian.

JARVIS stores knowledge as plain Markdown pages you own — not opaque vectors alone.
Each page links to related concepts and entities. Queries read **hot cache → index → pages** so context compounds over time.

## How JARVIS uses it
1. **hot.md** — recent session context (~500 words)
2. **index.md** — catalog of every brain page
3. **query** — keyword retrieval into relevant pages
4. **remember / ingest** — new pages with cross-links

Sources: [[Compounding Knowledge]], [[JARVIS Brain]]`,
      links: ['concepts/compounding-knowledge.md', 'entities/jarvis.md'],
      createdAt: now,
      updatedAt: now,
    },
    'concepts/compounding-knowledge.md': {
      path: 'concepts/compounding-knowledge.md',
      title: 'Compounding Knowledge',
      category: 'concept' as const,
      content: `# Compounding Knowledge

Every conversation, fact, and source JARVIS ingests makes the next answer smarter.

Unlike one-shot chat memory, the brain **files**, **links**, and **reuses** knowledge across sessions.
Drop a source → JARVIS extracts entities and concepts → updates the index and hot cache.

Related: [[LLM Wiki Pattern]], [[JARVIS]]`,
      links: ['concepts/llm-wiki-pattern.md', 'entities/jarvis.md'],
      createdAt: now,
      updatedAt: now,
    },
    'entities/jarvis.md': {
      path: 'entities/jarvis.md',
      title: 'JARVIS',
      category: 'entity' as const,
      content: `# JARVIS

Just A Rather Very Intelligent System — personal AI assistant for sir.

## Capabilities
- Voice-first chat with skills (weather, calendar, reminders, web search)
- Self-upgrade via GitHub on cloud
- Persistent brain wiki (this vault)
- Continuous learning — every conversation turn auto-files to the brain

## Brain architecture
Inspired by [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian) — self-organizing second brain for Obsidian + Claude Code.

Related: [[Continuous Learning]], [[LLM Wiki Pattern]]`,
      links: ['concepts/llm-wiki-pattern.md', 'concepts/continuous-learning.md'],
      createdAt: now,
      updatedAt: now,
    },
    'concepts/continuous-learning.md': {
      path: 'concepts/continuous-learning.md',
      title: 'Continuous Learning',
      category: 'concept' as const,
      content: `# Continuous Learning

JARVIS automatically learns from every conversation — no "remember this" required.

## What gets filed each turn
1. **Daily journal** — full user + JARVIS exchange under \`sessions/YYYY-MM-DD.md\`
2. **Topic pages** — auto-created concept pages (UI, brain, AI models, etc.)
3. **Extracted facts** — preferences and statements ("I like…", "I work on…")
4. **Hot cache** — recent context for the next reply

Related: [[JARVIS]], [[Compounding Knowledge]]`,
      links: ['entities/jarvis.md', 'concepts/compounding-knowledge.md'],
      createdAt: now,
      updatedAt: now,
    },
  };

  return {
    version: 1,
    hot: `# Hot Cache

Last updated: ${now}

JARVIS brain initialized. Seeded with LLM Wiki Pattern, Compounding Knowledge, Continuous Learning, and JARVIS entity pages.
Everything you discuss is auto-filed — journals, topics, and facts compound from here.`,
    index: buildIndex(pages),
    log: `# Brain Log\n\n- [${now}] Brain initialized with seed vault (claude-obsidian / Karpathy LLM Wiki pattern).\n`,
    pages,
    updatedAt: now,
  };
}

function buildIndex(pages: Record<string, BrainPage>): string {
  const lines = ['# JARVIS Brain Index', '', 'Master catalog of wiki pages.', ''];
  const byCategory: Record<string, typeof pages[string][]> = {};
  for (const page of Object.values(pages)) {
    byCategory[page.category] ??= [];
    byCategory[page.category].push(page);
  }
  for (const [cat, list] of Object.entries(byCategory)) {
    lines.push(`## ${cat}`, '');
    for (const p of list.sort((a, b) => a.title.localeCompare(b.title))) {
      lines.push(`- [[${p.title}]] — \`${p.path}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}
