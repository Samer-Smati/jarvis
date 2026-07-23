import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrainBlobStore } from './brain-blob.store';
import { createSeedVault } from './brain.seed';
import { BrainCategory, BrainPage, BrainQueryHit, BrainVault } from './brain.types';

const HOT_MAX_CHARS = 2400;
const LOG_MAX_LINES = 200;

@Injectable()
export class BrainService implements OnModuleInit {
  private readonly logger = new Logger(BrainService.name);
  private readonly blob = new BrainBlobStore();
  private readonly isServerless = !!(process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1');
  private readonly vaultPath: string;
  private vault: BrainVault | null = null;

  constructor(config: ConfigService) {
    const dataRoot = config.get<string>('DATA_ROOT') ?? join(process.cwd(), 'data');
    this.vaultPath = join(dataRoot, 'brain', 'vault.json');
  }

  async onModuleInit(): Promise<void> {
    await this.ensureLoaded();
  }

  async status(): Promise<string> {
    const vault = await this.ensureLoaded();
    const pageCount = Object.keys(vault.pages).length;
    const categories = new Set(Object.values(vault.pages).map((p) => p.category));
    const storage = this.blob.enabled()
      ? 'Vercel Blob (durable cloud)'
      : this.isServerless
        ? 'in-memory (ephemeral — set BLOB_READ_WRITE_TOKEN)'
        : `local file (${this.vaultPath})`;
    return [
      'JARVIS Brain — LLM Wiki (claude-obsidian pattern)',
      `Pages: ${pageCount} across ${categories.size} categories (${[...categories].join(', ')})`,
      `Storage: ${storage}`,
      `Last updated: ${vault.updatedAt}`,
      '',
      'Hot cache preview:',
      vault.hot.slice(0, 400) + (vault.hot.length > 400 ? '…' : ''),
      '',
      'Use brain skill: query, remember, ingest, save_session, update_hot.',
    ].join('\n');
  }

  async getContextBlock(query: string): Promise<string> {
    const vault = await this.ensureLoaded();
    const hits = this.searchPages(vault, query, 3);
    const parts: string[] = [];

    if (vault.hot.trim()) {
      parts.push('## Hot cache (recent context)\n' + vault.hot.trim());
    }

    if (hits.length) {
      parts.push(
        '## Relevant brain pages\n' +
          hits.map((h) => `### ${h.title} (${h.path})\n${h.excerpt}`).join('\n\n'),
      );
    } else if (Object.keys(vault.pages).length <= 8) {
      parts.push('## Brain index\n' + vault.index.slice(0, 1200));
    }

    return parts.join('\n\n').slice(0, 4500);
  }

  async query(text: string, limit = 5): Promise<{ hot: string; hits: BrainQueryHit[] }> {
    const vault = await this.ensureLoaded();
    return {
      hot: vault.hot,
      hits: this.searchPages(vault, text, limit),
    };
  }

  async remember(
    title: string,
    content: string,
    category: BrainCategory = 'fact',
    links: string[] = [],
  ): Promise<string> {
    const vault = await this.ensureLoaded();
    const slug = slugify(title);
    const folder = category === 'fact' ? 'facts' : `${category}s`;
    const path = `${folder}/${slug}.md`;
    const now = new Date().toISOString();
    const body = content.startsWith('#') ? content : `# ${title}\n\n${content}`;
    const pageLinks = [...new Set([...links, ...extractWikiLinks(body)])];

    vault.pages[path] = {
      path,
      title,
      category,
      content: body,
      links: pageLinks,
      createdAt: vault.pages[path]?.createdAt ?? now,
      updatedAt: now,
    };

    this.rebuildIndex(vault);
    this.appendLog(vault, `remember: ${title} → ${path}`);
    await this.persist(vault);
    return `Remembered "${title}" in brain at ${path}.`;
  }

  async ingest(title: string, content: string, sourceType = 'note'): Promise<string> {
    const vault = await this.ensureLoaded();
    const slug = slugify(title);
    const path = `sources/${slug}.md`;
    const now = new Date().toISOString();
    const body = `# ${title}

Source type: ${sourceType}
Ingested: ${now}

${content}`;

    vault.pages[path] = {
      path,
      title,
      category: 'source',
      content: body,
      links: extractWikiLinks(body),
      createdAt: now,
      updatedAt: now,
    };

    this.rebuildIndex(vault);
    this.appendLog(vault, `ingest: ${title} (${content.length} chars)`);
    await this.persist(vault);
    return `Ingested source "${title}" → ${path}. ${Object.keys(vault.pages).length} pages in brain.`;
  }

  async saveSession(summary: string, topics: string[] = []): Promise<string> {
    const vault = await this.ensureLoaded();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const path = `sessions/${stamp}.md`;
    const now = new Date().toISOString();
    const topicBlock = topics.length ? `\n\nTopics: ${topics.join(', ')}` : '';

    vault.pages[path] = {
      path,
      title: `Session ${stamp}`,
      category: 'session',
      content: `# Session ${stamp}\n\n${summary}${topicBlock}`,
      links: topics.map((t) => `concepts/${slugify(t)}.md`),
      createdAt: now,
      updatedAt: now,
    };

    await this.updateHot(summary);
    this.rebuildIndex(vault);
    this.appendLog(vault, `save_session: ${stamp}`);
    await this.persist(vault);
    return `Session saved to brain at ${path}. Hot cache updated.`;
  }

  async updateHot(summary: string): Promise<string> {
    const vault = await this.ensureLoaded();
    const now = new Date().toISOString();
    const entry = `\n\n## ${now}\n${summary.trim()}`;
    vault.hot = (vault.hot.trim() + entry).slice(-HOT_MAX_CHARS);
    vault.updatedAt = now;
    this.appendLog(vault, 'update_hot');
    await this.persist(vault);
    return 'Hot cache refreshed.';
  }

  async touchFromTurn(userText: string, assistantText: string): Promise<void> {
    if (!userText.trim() || !assistantText.trim()) {
      return;
    }
    const vault = await this.ensureLoaded();
    const snippet = `User: ${userText.slice(0, 120)}${userText.length > 120 ? '…' : ''}\nJARVIS: ${assistantText.slice(0, 160)}${assistantText.length > 160 ? '…' : ''}`;
    const now = new Date().toISOString();
    vault.hot = (`# Hot Cache\n\nLast turn: ${now}\n${snippet}\n\n` + vault.hot.replace(/^# Hot Cache\s*/i, '')).slice(
      0,
      HOT_MAX_CHARS,
    );
    vault.updatedAt = now;
    await this.persist(vault);
  }

  async listPages(): Promise<BrainPage[]> {
    const vault = await this.ensureLoaded();
    return Object.values(vault.pages).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  private async ensureLoaded(): Promise<BrainVault> {
    if (this.vault) {
      return this.vault;
    }

    if (this.blob.enabled()) {
      const remote = await this.blob.load();
      if (remote) {
        this.vault = remote;
        return remote;
      }
    }

    if (!this.isServerless && existsSync(this.vaultPath)) {
      try {
        const raw = readFileSync(this.vaultPath, 'utf8');
        const parsed = JSON.parse(raw) as BrainVault;
        if (parsed.version === 1) {
          this.vault = parsed;
          return parsed;
        }
      } catch {
        /* fall through to seed */
      }
    }

    const seeded = createSeedVault();
    this.vault = seeded;
    await this.persist(seeded);
    this.logger.log('JARVIS brain initialized with seed vault.');
    return seeded;
  }

  private async persist(vault: BrainVault): Promise<void> {
    vault.updatedAt = new Date().toISOString();
    this.vault = vault;

    if (this.blob.enabled()) {
      await this.blob.save(vault);
    }

    if (!this.isServerless) {
      mkdirSync(join(this.vaultPath, '..'), { recursive: true });
      writeFileSync(this.vaultPath, JSON.stringify(vault, null, 2), 'utf8');
    }
  }

  private searchPages(vault: BrainVault, query: string, limit: number): BrainQueryHit[] {
    const terms = tokenize(query);
    if (!terms.length) {
      return [];
    }

    const hits: BrainQueryHit[] = [];
    for (const page of Object.values(vault.pages)) {
      const corpus = `${page.title} ${page.content} ${page.links.join(' ')}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (corpus.includes(term)) {
          score += term.length > 4 ? 2 : 1;
          const count = corpus.split(term).length - 1;
          score += Math.min(count, 3);
        }
      }
      if (score > 0) {
        hits.push({
          path: page.path,
          title: page.title,
          category: page.category,
          score,
          excerpt: excerpt(page.content, terms, 320),
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private rebuildIndex(vault: BrainVault): void {
    const lines = ['# JARVIS Brain Index', '', `Updated: ${vault.updatedAt}`, ''];
    const byCategory: Record<string, BrainPage[]> = {};
    for (const page of Object.values(vault.pages)) {
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
    vault.index = lines.join('\n');
  }

  private appendLog(vault: BrainVault, action: string): void {
    const line = `- [${new Date().toISOString()}] ${action}`;
    const lines = vault.log.split('\n');
    lines.push(line);
    if (lines.length > LOG_MAX_LINES) {
      vault.log = lines.slice(-LOG_MAX_LINES).join('\n');
    } else {
      vault.log = lines.join('\n');
    }
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'note';
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function extractWikiLinks(content: string): string[] {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g);
  return [...matches].map((m) => slugify(m[1]) + '.md');
}

function excerpt(content: string, terms: string[], maxLen: number): string {
  const lower = content.toLowerCase();
  let idx = -1;
  for (const term of terms) {
    const pos = lower.indexOf(term);
    if (pos >= 0 && (idx < 0 || pos < idx)) {
      idx = pos;
    }
  }
  if (idx < 0) {
    return content.slice(0, maxLen).trim() + (content.length > maxLen ? '…' : '');
  }
  const start = Math.max(0, idx - 80);
  const slice = content.slice(start, start + maxLen).trim();
  return (start > 0 ? '…' : '') + slice + (start + maxLen < content.length ? '…' : '');
}
