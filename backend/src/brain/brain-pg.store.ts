import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmbeddingService } from '../llm/embedding.service';
import { isPostgresEnabled } from '../database/database.util';
import { BrainEdgeEntity } from './entities/brain-edge.entity';
import { BrainPageEntity } from './entities/brain-page.entity';
import { MemoryChunkEntity } from './entities/memory-chunk.entity';
import { BrainGraph, BrainGraphEdge, BrainVault } from './brain.types';

@Injectable()
export class BrainPgStore {
  private readonly logger = new Logger(BrainPgStore.name);

  constructor(
    @InjectRepository(BrainPageEntity)
    private readonly pages: Repository<BrainPageEntity>,
    @InjectRepository(BrainEdgeEntity)
    private readonly edges: Repository<BrainEdgeEntity>,
    @InjectRepository(MemoryChunkEntity)
    private readonly chunks: Repository<MemoryChunkEntity>,
    private readonly embeddings: EmbeddingService,
  ) {}

  enabled(): boolean {
    return isPostgresEnabled();
  }

  async syncVault(vault: BrainVault): Promise<void> {
    if (!this.enabled()) {
      return;
    }

    try {
      for (const page of Object.values(vault.pages)) {
        await this.pages.save({
          path: page.path,
          title: page.title,
          category: page.category,
          content: page.content,
          links: page.links,
          createdAt: new Date(page.createdAt),
          updatedAt: new Date(page.updatedAt),
        });
      }

      await this.edges.clear();
      const graph = this.buildGraphFromVault(vault);
      for (const edge of graph.edges) {
        await this.edges.save({
          sourcePath: edge.source,
          targetPath: edge.target,
          kind: edge.kind,
        });
      }
    } catch (error) {
      this.logger.warn(`Brain PG sync failed: ${(error as Error).message}`);
    }
  }

  async indexTurn(userText: string, assistantText: string, journalPath?: string): Promise<void> {
    const text = `User: ${userText.slice(0, 600)}\nJARVIS: ${assistantText.slice(0, 600)}`;
    await this.indexChunk(text, 'turn', journalPath);
  }

  async indexChunk(text: string, sourceType: string, sourcePath?: string): Promise<void> {
    if (!this.enabled()) {
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const embedding = await this.embeddings.tryEmbed(trimmed.slice(0, 2000));
    const row = this.chunks.create({
      text: trimmed,
      sourceType,
      sourcePath,
      embeddingJson: embedding ? JSON.stringify(embedding) : undefined,
    });
    const saved = await this.chunks.save(row);

    if (embedding?.length) {
      await this.saveVector(saved.id, embedding);
    }
  }

  async searchSimilar(query: string, limit = 5): Promise<Array<{ text: string; score: number }>> {
    if (!this.enabled()) {
      return [];
    }

    const queryVector = await this.embeddings.tryEmbed(query.slice(0, 1500));
    if (!queryVector?.length) {
      return this.keywordFallback(query, limit);
    }

    try {
      const vectorLiteral = `[${queryVector.join(',')}]`;
      const rows = (await this.chunks.query(
        `
        SELECT text, 1 - (embedding <=> $1::vector) AS score
        FROM memory_chunks
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        `,
        [vectorLiteral, limit],
      )) as Array<{ text: string; score: string }>;

      return rows.map((r) => ({ text: r.text, score: Number(r.score) }));
    } catch (error) {
      this.logger.warn(`pgvector search fallback: ${(error as Error).message}`);
      return this.keywordFallback(query, limit);
    }
  }

  async loadGraph(): Promise<BrainGraph | null> {
    if (!this.enabled()) {
      return null;
    }

    const pageRows = await this.pages.find();
    if (!pageRows.length) {
      return null;
    }

    const edgeRows = await this.edges.find();
    const linkCounts = new Map<string, number>();

    for (const edge of edgeRows) {
      linkCounts.set(edge.sourcePath, (linkCounts.get(edge.sourcePath) ?? 0) + 1);
      linkCounts.set(edge.targetPath, (linkCounts.get(edge.targetPath) ?? 0) + 1);
    }

    return {
      nodes: pageRows.map((p) => ({
        id: p.path,
        label: p.title,
        category: p.category as BrainGraph['nodes'][0]['category'],
        linkCount: linkCounts.get(p.path) ?? 0,
      })),
      edges: edgeRows.map(
        (e): BrainGraphEdge => ({
          source: e.sourcePath,
          target: e.targetPath,
          kind: e.kind as BrainGraphEdge['kind'],
        }),
      ),
      updatedAt: new Date().toISOString(),
    };
  }

  async statusLine(): Promise<string | null> {
    if (!this.enabled()) {
      return null;
    }
    const pageCount = await this.pages.count();
    const edgeCount = await this.edges.count();
    const chunkCount = await this.chunks.count();
    return `PostgreSQL (Neon): ${pageCount} pages, ${edgeCount} links, ${chunkCount} vector chunks`;
  }

  private async saveVector(id: string, embedding: number[]): Promise<void> {
    const vectorLiteral = `[${embedding.join(',')}]`;
    await this.chunks.query(`UPDATE memory_chunks SET embedding = $1::vector WHERE id = $2`, [
      vectorLiteral,
      id,
    ]);
  }

  private async keywordFallback(query: string, limit: number): Promise<Array<{ text: string; score: number }>> {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    if (!terms.length) {
      return [];
    }
    const rows = await this.chunks.find({ order: { createdAt: 'DESC' }, take: 50 });
    return rows
      .map((row) => {
        const lower = row.text.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (lower.includes(term)) {
            score += 1;
          }
        }
        return { text: row.text, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private buildGraphFromVault(vault: BrainVault): BrainGraph {
    const pages = Object.values(vault.pages);
    const pathSet = new Set(pages.map((p) => p.path));
    const edges: BrainGraphEdge[] = [];
    const edgeKeys = new Set<string>();

    for (const page of pages) {
      for (const target of page.links) {
        if (!pathSet.has(target) || target === page.path) {
          continue;
        }
        const key = [page.path, target].sort().join('|');
        if (edgeKeys.has(key)) {
          continue;
        }
        edgeKeys.add(key);
        edges.push({ source: page.path, target, kind: 'link' });
      }
    }

    return {
      nodes: pages.map((p) => ({ id: p.path, label: p.title, category: p.category, linkCount: 0 })),
      edges,
      updatedAt: vault.updatedAt,
    };
  }
}
