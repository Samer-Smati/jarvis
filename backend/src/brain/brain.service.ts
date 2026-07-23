import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrainBlobStore } from './brain-blob.store';
import { BrainPgStore } from './brain-pg.store';
import { createSeedVault } from './brain.seed';
import { BrainCategory, BrainGraph, BrainGraphEdge, BrainPage, BrainQueryHit, BrainVault } from './brain.types';

const HOT_MAX_CHARS = 2400;
const LOG_MAX_LINES = 200;
const JOURNAL_MAX_CHARS = 14000;
const JARVIS_ENTITY_PATH = 'entities/jarvis.md';

export interface IngestUrlResult {
  sourcePath: string;
  entityPath?: string;
  title: string;
  excerpt: string;
}

@Injectable()
export class BrainService implements OnModuleInit {
  private readonly logger = new Logger(BrainService.name);
  private readonly blob = new BrainBlobStore();
  private readonly isServerless = !!(process.env.VERCEL || process.env.JARVIS_SERVERLESS === '1');
  private readonly vaultPath: string;
  private vault: BrainVault | null = null;
  private vaultRepaired = false;

  constructor(
    config: ConfigService,
    private readonly pgStore: BrainPgStore,
  ) {
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
    const pgLine = await this.pgStore.statusLine();
    const lines = [
      'JARVIS Brain — LLM Wiki (claude-obsidian pattern)',
      `Pages: ${pageCount} across ${categories.size} categories (${[...categories].join(', ')})`,
      `Storage: ${storage}`,
    ];
    if (pgLine) {
      lines.push(pgLine);
    }
    lines.push(
      `Last updated: ${vault.updatedAt}`,
      '',
      'Hot cache preview:',
      vault.hot.slice(0, 400) + (vault.hot.length > 400 ? '…' : ''),
      '',
      'Use brain skill: query, remember, ingest, ingest_url, save_session, update_hot. Every conversation turn is auto-filed into the brain.',
    );
    return lines.join('\n');
  }

  async getContextBlock(query: string): Promise<string> {
    const vault = await this.ensureLoaded();
    const hits = this.searchPages(vault, query, 3);
    const parts: string[] = [];

    if (vault.hot.trim()) {
      parts.push('## Hot cache (recent context)\n' + vault.hot.trim());
    }

    const vectorHits = await this.pgStore.searchSimilar(query, 3);
    if (vectorHits.length) {
      parts.push(
        '## Semantically similar past conversations\n' +
          vectorHits.map((h) => h.text.slice(0, 360)).join('\n\n'),
      );
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
    const folder = categoryFolder(category);
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

    if (this.shouldLinkToJarvis(title, content, category)) {
      this.linkPagesInVault(vault, path, JARVIS_ENTITY_PATH, true);
    }

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

  async ingestUrlPage(title: string, url: string, text: string, asEntity: boolean): Promise<IngestUrlResult> {
    const body = `URL: ${url}\n\n${text}`;
    const excerpt = text.slice(0, 500).trim();

    if (!asEntity) {
      const msg = await this.ingest(title, body, 'url');
      const sourcePath = `sources/${slugify(title)}.md`;
      return { sourcePath, title, excerpt: msg.includes('Ingested') ? excerpt : text.slice(0, 200) };
    }

    const vault = await this.ensureLoaded();
    const entityTitle = normalizeProfileTitle(title);
    const entityPath = `entities/${slugify(entityTitle)}.md`;
    const sourcePath = `sources/${slugify(title)}.md`;
    const now = new Date().toISOString();

    vault.pages[entityPath] = {
      path: entityPath,
      title: entityTitle,
      category: 'entity',
      content: `# ${entityTitle}\n\n${body}\n\nRelated: [[JARVIS]]`,
      links: [JARVIS_ENTITY_PATH],
      createdAt: vault.pages[entityPath]?.createdAt ?? now,
      updatedAt: now,
    };

    vault.pages[sourcePath] = {
      path: sourcePath,
      title,
      category: 'source',
      content: `# ${title}\n\nSource type: url\nIngested: ${now}\n\n${body}`,
      links: [entityPath, JARVIS_ENTITY_PATH],
      createdAt: now,
      updatedAt: now,
    };

    this.linkPagesInVault(vault, entityPath, JARVIS_ENTITY_PATH, true);
    this.linkPagesInVault(vault, sourcePath, entityPath, true);

    this.rebuildIndex(vault);
    this.appendLog(vault, `ingest_url entity: ${entityTitle} ← ${url}`);
    await this.persist(vault);

    return { sourcePath, entityPath, title: entityTitle, excerpt };
  }

  async getPage(path: string): Promise<BrainPage | null> {
    const vault = await this.ensureLoaded();
    return vault.pages[path] ?? null;
  }

  async findUserEntityPage(): Promise<BrainPage | null> {
    const vault = await this.ensureLoaded();
    const candidates = Object.values(vault.pages).filter(
      (p) =>
        p.category === 'entity' &&
        p.path !== JARVIS_ENTITY_PATH &&
        /user|profile|samer|owner|sir/i.test(`${p.title} ${p.path} ${p.content}`),
    );
    return candidates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null;
  }

  private findUserEntityPageSync(): BrainPage | null {
    if (!this.vault) {
      return null;
    }
    const candidates = Object.values(this.vault.pages).filter(
      (p) =>
        p.category === 'entity' &&
        p.path !== JARVIS_ENTITY_PATH &&
        /user|profile|samer|owner|sir/i.test(`${p.title} ${p.path} ${p.content}`),
    );
    return candidates.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null;
  }

  async linkUserEntityToJarvis(): Promise<string> {
    const vault = await this.ensureLoaded();
    let userPage = this.findUserEntityPageSync();

    if (!userPage) {
      const source = Object.values(vault.pages).find(
        (p) =>
          p.category === 'source' &&
          /samer|portfolio|profile|developer|full-stack/i.test(`${p.title} ${p.content}`),
      );
      if (source) {
        const promoted = await this.promoteSourceToEntity(source.path);
        userPage = vault.pages[promoted] ?? null;
      }
    }

    if (!userPage) {
      return 'No user profile page found in the brain yet. Share your profile URL or say "remember my profile is …".';
    }

    this.linkPagesInVault(vault, userPage.path, JARVIS_ENTITY_PATH, true);
    this.rebuildIndex(vault);
    this.appendLog(vault, `link: ${userPage.path} ↔ ${JARVIS_ENTITY_PATH}`);
    await this.persist(vault);
    return `Linked [[${userPage.title}]] ↔ [[JARVIS]] in the brain graph.`;
  }

  async promoteSourceToEntity(sourcePath: string): Promise<string> {
    const vault = await this.ensureLoaded();
    const entityPath = this.promoteSourceInVault(vault, sourcePath);
    if (!entityPath) {
      return '';
    }
    this.rebuildIndex(vault);
    await this.persist(vault);
    return entityPath;
  }

  async linkPages(fromPath: string, toPath: string, bidirectional = true): Promise<void> {
    const vault = await this.ensureLoaded();
    this.linkPagesInVault(vault, fromPath, toPath, bidirectional);
    this.rebuildIndex(vault);
    await this.persist(vault);
  }

  private shouldLinkToJarvis(title: string, content: string, category: BrainCategory): boolean {
    if (category === 'entity') {
      return true;
    }
    return /user|profile|samer|owner|sir|engineer/i.test(`${title} ${content}`);
  }

  private linkPagesInVault(
    vault: BrainVault,
    fromPath: string,
    toPath: string,
    bidirectional: boolean,
  ): void {
    const from = vault.pages[fromPath];
    const to = vault.pages[toPath];
    if (!from || !to) {
      return;
    }

    if (!from.links.includes(toPath)) {
      from.links.push(toPath);
    }
    if (!from.content.includes(`[[${to.title}]]`)) {
      from.content = `${from.content.trim()}\n\nRelated: [[${to.title}]]`;
    }

    if (bidirectional) {
      if (!to.links.includes(fromPath)) {
        to.links.push(fromPath);
      }
      if (!to.content.includes(`[[${from.title}]]`)) {
        to.content = `${to.content.trim()}\n\nRelated: [[${from.title}]]`;
      }
    }

    from.updatedAt = new Date().toISOString();
    to.updatedAt = from.updatedAt;
  }

  private repairVault(vault: BrainVault): boolean {
    let changed = false;

    for (const page of Object.values(vault.pages)) {
      if (page.path === JARVIS_ENTITY_PATH) {
        continue;
      }
      if (page.category === 'entity' && page.path !== JARVIS_ENTITY_PATH) {
        const beforeLinks = page.links.length;
        this.linkPagesInVault(vault, page.path, JARVIS_ENTITY_PATH, true);
        if (page.links.length !== beforeLinks) {
          changed = true;
        }
        continue;
      }
      if (!page.links.includes(JARVIS_ENTITY_PATH)) {
        this.linkPagesInVault(vault, page.path, JARVIS_ENTITY_PATH, true);
        changed = true;
      }
    }

    if (!this.findUserEntityPageSync()) {
      const source = Object.values(vault.pages).find(
        (p) =>
          p.category === 'source' &&
          /samer|portfolio|profile|full-stack|developer/i.test(`${p.title} ${p.content}`),
      );
      if (source) {
        this.promoteSourceInVault(vault, source.path);
        changed = true;
      }
    }

    const compPath = 'concepts/compounding-knowledge.md';
    if (vault.pages[compPath] && vault.pages[JARVIS_ENTITY_PATH]) {
      const comp = vault.pages[compPath];
      if (!comp.links.includes(JARVIS_ENTITY_PATH)) {
        this.linkPagesInVault(vault, compPath, JARVIS_ENTITY_PATH, true);
        changed = true;
      }
    }

    if (changed) {
      this.rebuildIndex(vault);
    }
    return changed;
  }

  private promoteSourceInVault(vault: BrainVault, sourcePath: string): string {
    const source = vault.pages[sourcePath];
    if (!source) {
      return '';
    }
    const entityTitle = normalizeProfileTitle(source.title);
    const entityPath = `entities/${slugify(entityTitle)}.md`;
    const now = new Date().toISOString();

    vault.pages[entityPath] = {
      path: entityPath,
      title: entityTitle,
      category: 'entity',
      content: `# ${entityTitle}\n\nPromoted from ${source.path}\n\n${source.content}\n\nRelated: [[JARVIS]]`,
      links: [...new Set([...source.links, JARVIS_ENTITY_PATH, sourcePath])],
      createdAt: vault.pages[entityPath]?.createdAt ?? now,
      updatedAt: now,
    };

    this.linkPagesInVault(vault, entityPath, JARVIS_ENTITY_PATH, true);
    this.linkPagesInVault(vault, sourcePath, entityPath, true);
    return entityPath;
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

  async learnFromTurn(userText: string, assistantText: string): Promise<void> {
    const user = userText.trim();
    const assistant = assistantText.trim();
    if (!user || !assistant) {
      return;
    }

    const vault = await this.ensureLoaded();
    const now = new Date().toISOString();
    const snippet = `User: ${user.slice(0, 120)}${user.length > 120 ? '…' : ''}\nJARVIS: ${assistant.slice(0, 160)}${assistant.length > 160 ? '…' : ''}`;

    vault.hot = (`# Hot Cache\n\nLast turn: ${now}\n${snippet}\n\n` + vault.hot.replace(/^# Hot Cache\s*/i, '')).slice(
      0,
      HOT_MAX_CHARS,
    );

    if (!shouldAutoLearnTurn(user, assistant)) {
      vault.updatedAt = now;
      await this.persist(vault);
      void this.pgStore.indexTurn(user, assistant);
      return;
    }

    this.appendDailyJournal(vault, user, assistant, now);
    this.fileExtractedFacts(vault, user);
    this.appendTopicLearning(vault, user, assistant, now);

    this.rebuildIndex(vault);
    this.appendLog(vault, `learn: ${user.slice(0, 48)}${user.length > 48 ? '…' : ''}`);
    vault.updatedAt = now;
    await this.persist(vault);
    void this.pgStore.indexTurn(user, assistant, `sessions/${now.slice(0, 10)}.md`);
  }

  /** @deprecated use learnFromTurn */
  async touchFromTurn(userText: string, assistantText: string): Promise<void> {
    await this.learnFromTurn(userText, assistantText);
  }

  private appendDailyJournal(vault: BrainVault, user: string, assistant: string, now: string): void {
    const day = now.slice(0, 10);
    const journalPath = `sessions/${day}.md`;
    const stamp = now.slice(11, 19);
    const entry = `\n\n## ${stamp}\n**User:** ${user.slice(0, 900)}\n**JARVIS:** ${assistant.slice(0, 700)}`;
    const existing = vault.pages[journalPath];

    if (existing) {
      existing.content = `${existing.content}${entry}`.slice(-JOURNAL_MAX_CHARS);
      existing.updatedAt = now;
      if (!existing.links.includes(JARVIS_ENTITY_PATH)) {
        this.linkPagesInVault(vault, journalPath, JARVIS_ENTITY_PATH, true);
      }
      return;
    }

    vault.pages[journalPath] = {
      path: journalPath,
      title: `Conversation ${day}`,
      category: 'session',
      content: `# Conversation ${day}\n\nAuto-log of everything discussed with sir.${entry}`,
      links: [JARVIS_ENTITY_PATH],
      createdAt: now,
      updatedAt: now,
    };
    this.linkPagesInVault(vault, journalPath, JARVIS_ENTITY_PATH, true);
  }

  private fileExtractedFacts(vault: BrainVault, user: string): void {
    for (const fact of extractFactsFromUser(user)) {
      this.rememberUniqueFactInVault(vault, fact);
    }
  }

  private rememberUniqueFactInVault(vault: BrainVault, fact: string): void {
    const normalized = fact.toLowerCase().slice(0, 100);
    const duplicate = Object.values(vault.pages).some(
      (p) => p.category === 'fact' && p.content.toLowerCase().includes(normalized),
    );
    if (duplicate) {
      return;
    }

    const title = summarizeFactTitle(fact);
    const path = `facts/${slugify(title)}.md`;
    if (vault.pages[path]) {
      return;
    }

    const now = new Date().toISOString();
    vault.pages[path] = {
      path,
      title,
      category: 'fact',
      content: `# ${title}\n\n${fact}\n\nLearned from conversation.`,
      links: extractWikiLinks(fact),
      createdAt: now,
      updatedAt: now,
    };

    this.linkPagesInVault(vault, path, JARVIS_ENTITY_PATH, true);
  }

  private appendTopicLearning(vault: BrainVault, user: string, assistant: string, now: string): void {
    const topicTitle = inferTopicTitle(user);
    if (!topicTitle) {
      return;
    }

    const path = `concepts/${slugify(topicTitle)}.md`;
    const day = now.slice(0, 10);
    const journalPath = `sessions/${day}.md`;
    const entry = `\n- [${now.slice(0, 16).replace('T', ' ')}] **User:** ${user.slice(0, 220)} → **JARVIS:** ${assistant.slice(0, 180)}`;
    const existing = vault.pages[path];

    if (existing) {
      existing.content = `${existing.content}${entry}`.slice(-JOURNAL_MAX_CHARS);
      existing.updatedAt = now;
      if (vault.pages[journalPath] && !existing.links.includes(journalPath)) {
        this.linkPagesInVault(vault, path, journalPath, true);
      }
      return;
    }

    vault.pages[path] = {
      path,
      title: topicTitle,
      category: 'concept',
      content: `# ${topicTitle}\n\nTopic learned automatically from conversations.${entry}`,
      links: [JARVIS_ENTITY_PATH],
      createdAt: now,
      updatedAt: now,
    };
    this.linkPagesInVault(vault, path, JARVIS_ENTITY_PATH, true);
    if (vault.pages[journalPath]) {
      this.linkPagesInVault(vault, path, journalPath, true);
    }
  }

  async listPages(): Promise<BrainPage[]> {
    const vault = await this.ensureLoaded();
    return Object.values(vault.pages).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async getGraph(): Promise<BrainGraph> {
    const pgGraph = await this.pgStore.loadGraph();
    const vault = await this.ensureLoaded();
    const vaultGraph = this.buildGraphFromVault(vault);
    if (pgGraph && pgGraph.nodes.length >= vaultGraph.nodes.length) {
      return pgGraph;
    }
    return vaultGraph;
  }

  private buildGraphFromVault(vault: BrainVault): BrainGraph {
    const pages = Object.values(vault.pages);
    const pathSet = new Set(pages.map((p) => p.path));
    const pathByTitle = new Map<string, string>();
    const pathBySlug = new Map<string, string>();

    for (const page of pages) {
      pathByTitle.set(page.title.toLowerCase(), page.path);
      pathBySlug.set(slugify(page.title), page.path);
      pathBySlug.set(page.path.toLowerCase(), page.path);
      const base = page.path.split('/').pop() ?? '';
      if (base) {
        pathBySlug.set(base.toLowerCase(), page.path);
        pathBySlug.set(base.replace(/\.md$/i, '').toLowerCase(), page.path);
      }
    }

    const linkCounts = new Map<string, number>();
    const edges: BrainGraphEdge[] = [];
    const edgeKeys = new Set<string>();

    const bump = (id: string) => linkCounts.set(id, (linkCounts.get(id) ?? 0) + 1);

    const addEdge = (source: string, target: string, kind: 'link' | 'wiki') => {
      if (source === target || !pathSet.has(source) || !pathSet.has(target)) {
        return;
      }
      const key = [source, target].sort().join('|');
      if (edgeKeys.has(key)) {
        return;
      }
      edgeKeys.add(key);
      edges.push({ source, target, kind });
      bump(source);
      bump(target);
    };

    for (const page of pages) {
      const targets = new Set<string>();

      for (const raw of page.links) {
        const resolved = resolveBrainLink(raw, pathByTitle, pathBySlug, pathSet);
        if (resolved) {
          targets.add(resolved);
        }
      }

      for (const match of page.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
        const resolved = resolveBrainLink(match[1], pathByTitle, pathBySlug, pathSet);
        if (resolved) {
          targets.add(resolved);
        }
      }

      for (const target of targets) {
        addEdge(page.path, target, 'wiki');
      }
    }

    const nodes = pages.map((page) => ({
      id: page.path,
      label: page.title,
      category: page.category,
      linkCount: linkCounts.get(page.path) ?? 0,
    }));

    return { nodes, edges, updatedAt: vault.updatedAt };
  }

  private async ensureLoaded(): Promise<BrainVault> {
    if (this.vault) {
      return this.vault;
    }

    if (this.blob.enabled()) {
      const remote = await this.blob.load();
      if (remote) {
        this.vault = remote;
        return this.afterLoad(remote);
      }
    }

    if (!this.isServerless && existsSync(this.vaultPath)) {
      try {
        const raw = readFileSync(this.vaultPath, 'utf8');
        const parsed = JSON.parse(raw) as BrainVault;
        if (parsed.version === 1) {
          this.vault = parsed;
          return this.afterLoad(parsed);
        }
      } catch {
        /* fall through to seed */
      }
    }

    const seeded = createSeedVault();
    this.vault = seeded;
    await this.persist(seeded);
    this.logger.log('JARVIS brain initialized with seed vault.');
    return this.afterLoad(seeded);
  }

  private async afterLoad(vault: BrainVault): Promise<BrainVault> {
    if (!this.vaultRepaired) {
      if (this.repairVault(vault)) {
        this.appendLog(vault, 'repair: relinked orphan pages to JARVIS');
        await this.persist(vault);
      }
      this.vaultRepaired = true;
    }
    return vault;
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

    void this.pgStore.syncVault(vault);
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

function resolveBrainLink(
  raw: string,
  pathByTitle: Map<string, string>,
  pathBySlug: Map<string, string>,
  pathSet: Set<string>,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (pathSet.has(trimmed)) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (pathByTitle.has(lower)) {
    return pathByTitle.get(lower)!;
  }
  const slug = slugify(trimmed);
  if (pathBySlug.has(slug)) {
    return pathBySlug.get(slug)!;
  }
  if (pathBySlug.has(`${slug}.md`)) {
    return pathBySlug.get(`${slug}.md`)!;
  }
  const asPath = trimmed.includes('/') ? trimmed : `concepts/${slug}.md`;
  if (pathSet.has(asPath)) {
    return asPath;
  }
  const factPath = `facts/${slug}.md`;
  if (pathSet.has(factPath)) {
    return factPath;
  }
  const entityPath = `entities/${slug}.md`;
  if (pathSet.has(entityPath)) {
    return entityPath;
  }
  return null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'note';
}

function categoryFolder(category: BrainCategory): string {
  switch (category) {
    case 'fact':
      return 'facts';
    case 'concept':
      return 'concepts';
    case 'entity':
      return 'entities';
    case 'source':
      return 'sources';
    case 'session':
      return 'sessions';
    default: {
      const _exhaustive: never = category;
      return _exhaustive;
    }
  }
}

function normalizeProfileTitle(title: string): string {
  const cleaned = title
    .replace(/\s*[-–|·].*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/samer/i.test(cleaned)) {
    return 'Samer Smati';
  }
  if (/profile|portfolio|resume|cv/i.test(cleaned)) {
    return 'User Profile';
  }
  return cleaned || 'User Profile';
}

function shouldAutoLearnTurn(user: string, assistant: string): boolean {
  if (user.length < 4) {
    return false;
  }
  if (isLowValueForFacts(user)) {
    return false;
  }
  const trivialUser =
    /^(hey|hi|hello|yo|hiya|howdy|ok|okay|thanks|thank you|merci|yes|no|sure|bye|goodbye|try again)[!.?\s]*$/i.test(
      user,
    );
  if (trivialUser && user.length < 28) {
    return false;
  }
  const trivialExchange =
    trivialUser &&
    /^(hello|hi|hey|how can I assist|good (morning|afternoon|evening))/i.test(assistant.slice(0, 80));
  return !trivialExchange;
}

function extractFactsFromUser(text: string): string[] {
  if (isLowValueForFacts(text)) {
    return [];
  }

  const facts: string[] = [];
  const patterns = [
    /\b(?:I am|I'm|I work|I like|I prefer|I want|I need|I use|I built|I have|my name is|call me)\b[^.!?\n]{2,140}[.!?]?/gi,
    /\b(?:remember that|note that|keep in mind|don't forget)\b[^.!?\n]{2,220}/gi,
    /\b(?:only me|I am your owner|I'm your owner|you work for me)\b[^.!?\n]{2,180}/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const fact = match[0].replace(/\s+/g, ' ').trim();
      if (fact.length >= 8) {
        facts.push(fact);
      }
    }
  }

  return [...new Set(facts)].slice(0, 3);
}

function isLowValueForFacts(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) {
    return true;
  }
  if (/^https?:\/\//.test(t)) {
    return true;
  }
  if (
    /^(show|what|how|can you|do you|tell me|open|choose|implement|upgrade|fix|make|just test|now i just demand)/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(pull request|self-improve|apply preset|test-dummy|cloud time limit)\b/i.test(t)) {
    return true;
  }
  if (/\b(responsive|scrollable|media quer|css|scss)\b/i.test(t) && /\b(upgrade|implement|fix|make)\b/i.test(t)) {
    return true;
  }
  return false;
}

function summarizeFactTitle(fact: string): string {
  const owner = fact.match(/\b(?:I am|I'm|my name is|call me)\s+([^,.!?]+)/i);
  if (owner?.[1]) {
    return `User: ${owner[1].trim().slice(0, 40)}`;
  }
  const remember = fact.match(/\b(?:remember that|note that|keep in mind|don't forget)\s+(.+)/i);
  if (remember?.[1]) {
    const words = remember[1].trim().split(/\s+/).slice(0, 5).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1).slice(0, 56);
  }
  if (/\b(?:only me|your owner|I am your owner)\b/i.test(fact)) {
    return 'User is owner';
  }
  if (fact.length > 56) {
    const words = fact.split(/\s+/).slice(0, 5).join(' ');
    return words.length > 12 ? words.slice(0, 56) : 'User note';
  }
  return fact.slice(0, 56);
}

function inferTopicTitle(text: string): string | null {
  const lower = text.toLowerCase();
  const topics: Array<[RegExp, string]> = [
    [/\b(brain|graph|wiki|memory|remember|learn)\b/, 'Brain & Memory'],
    [/\b(responsive|scrollable|ui|frontend|mobile|chat|interface|screen|css|scss|media quer)\b/, 'UI & Frontend'],
    [/\b(upgrade|self.?improve|deploy|github|vercel|pull request)\b/, 'Self Upgrade'],
    [/\b(model|llm|gemini|gpt|claude|ai|openai)\b/, 'AI Models'],
    [/\b(weather|calendar|remind|schedule)\b/, 'Personal Assistant'],
    [/\b(profile|portfolio|resume|developer|full-stack)\b/, 'User Profile'],
    [/\b(voice|speech|tts|stt|microphone)\b/, 'Voice'],
    [/\b(api|backend|nestjs|angular|database)\b/, 'Engineering'],
  ];

  for (const [pattern, title] of topics) {
    if (pattern.test(lower)) {
      return title;
    }
  }

  return null;
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
