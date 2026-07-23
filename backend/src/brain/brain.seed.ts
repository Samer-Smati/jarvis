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

Related: [[LLM Wiki Pattern]]`,
      links: ['concepts/llm-wiki-pattern.md'],
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

## Brain architecture
Inspired by [claude-obsidian](https://github.com/AgriciDaniel/claude-obsidian) — self-organizing second brain for Obsidian + Claude Code.`,
      links: ['concepts/llm-wiki-pattern.md'],
      createdAt: now,
      updatedAt: now,
    },
  };

  return {
    version: 1,
    hot: `# Hot Cache

Last updated: ${now}

JARVIS brain initialized. Seeded with LLM Wiki Pattern, Compounding Knowledge, and JARVIS entity pages.
Ask "what do you know about X?" or tell JARVIS to remember something — knowledge compounds from here.`,
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
