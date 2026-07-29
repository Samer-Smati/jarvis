import { Injectable } from '@nestjs/common';
import { BrainService } from '../../brain/brain.service';
import { WebFetchService } from '../../integrations/web-fetch.service';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

@Injectable()
export class BrainSkill implements Skill {
  readonly name = 'brain';
  readonly description =
    'JARVIS persistent second brain (LLM Wiki / claude-obsidian pattern). ' +
    'Stores linked Markdown knowledge: hot cache, index, concepts, entities, sources, sessions. ' +
    'Use ingest_url when the user sends a link — fetches the page and files it in the brain. ' +
    'Use consolidate when the user asks to scan/link/connect nodes — that WRITES real graph edges. ' +
    'Use query, remember, ingest, save_session, update_hot, graph, link_pages as needed.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'status',
          'query',
          'graph',
          'remember',
          'ingest',
          'ingest_url',
          'save_session',
          'update_hot',
          'get_page',
          'link_user',
          'link_pages',
          'consolidate',
          'cleanup',
        ],
        description:
          'status=brain overview; query=search vault; graph=open link graph UI (read-only); ingest_url=fetch a URL and file it; remember=store fact; ingest=add pasted text; save_session=file conversation; update_hot=refresh context; get_page=show markdown for a path; link_user=link user profile entity to JARVIS; link_pages=create an edge between two pages (by title or path); consolidate=scan all pages, identify logical connections, and WRITE wiki links; cleanup=remove low-quality auto-learned pages',
      },
      url: { type: 'string', description: 'HTTP(S) URL for ingest_url.' },
      query: { type: 'string', description: 'Search text for query action.' },
      title: { type: 'string', description: 'Page title for remember/ingest.' },
      content: { type: 'string', description: 'Body text for remember/ingest/save_session/update_hot.' },
      category: {
        type: 'string',
        enum: ['concept', 'entity', 'source', 'session', 'fact'],
        description: 'Page type for remember (default: fact).',
      },
      topics: {
        type: 'array',
        items: { type: 'string' },
        description: 'Related topics for save_session.',
      },
      source_type: { type: 'string', description: 'Source label for ingest (e.g. url, note, doc).' },
      path: { type: 'string', description: 'Brain page path for get_page (e.g. entities/samer-smati.md).' },
      from_path: {
        type: 'string',
        description: 'Source page title or path for link_pages (e.g. "LLM Wiki Pattern" or concepts/llm-wiki-pattern.md).',
      },
      to_path: {
        type: 'string',
        description: 'Target page title or path for link_pages.',
      },
      bidirectional: {
        type: 'boolean',
        description: 'For link_pages — link both directions (default true).',
      },
    },
    required: ['action'],
  };

  constructor(
    private readonly brain: BrainService,
    private readonly webFetch: WebFetchService,
  ) {}

  async execute(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const action = String(args?.action ?? '').trim();
    if (!action) {
      return {
        success: false,
        output:
          'Brain "action" is required. Use status, query, graph, ingest_url, remember, ingest, save_session, update_hot, get_page, link_user, link_pages, consolidate, or cleanup.',
      };
    }
    context.onProgress?.({
      stage: 'brain',
      message: `Brain: ${action}`,
      percent: 40,
    });

    switch (action) {
      case 'status':
        return { success: true, output: await this.brain.status() };
      case 'graph': {
        const graph = await this.brain.getGraph();
        return {
          success: true,
          output: `BRAIN_GRAPH: Opening knowledge graph — ${graph.nodes.length} nodes, ${graph.edges.length} links.`,
        };
      }
      case 'query': {
        const q = String(args?.query ?? '');
        if (!q.trim()) {
          return { success: false, output: '"query" text is required.' };
        }
        const result = await this.brain.query(q);
        const hits =
          result.hits.length > 0
            ? result.hits.map((h) => `- ${h.title} (${h.path}, score ${h.score})\n  ${h.excerpt}`).join('\n\n')
            : 'No matching pages — try broader terms or remember new facts first.';
        return {
          success: true,
          output: [`Hot cache:\n${result.hot.slice(0, 600)}`, '', 'Matching pages:', hits].join('\n'),
        };
      }
      case 'ingest_url': {
        const url = String(args?.url ?? '').trim();
        if (!url) {
          return { success: false, output: '"url" is required for ingest_url.' };
        }
        context.onProgress?.({
          stage: 'brain',
          message: `Fetching ${url}…`,
          percent: 48,
          detail: url,
        });
        try {
          const page = await this.webFetch.fetchReadable(url);
          context.onProgress?.({
            stage: 'brain',
            message: `Filing "${page.title}" in brain…`,
            percent: 55,
          });
          const isProfile = /profile|portfolio|resume|cv|developer|full-stack|portf-/i.test(
            `${url} ${page.title} ${page.text.slice(0, 1200)}`,
          );
          const result = await this.brain.ingestUrlPage(page.title, page.url, page.text, isProfile);
          const lines = [
            isProfile && result.entityPath
              ? `Profile entity saved at ${result.entityPath} and linked to JARVIS.`
              : `Source saved at ${result.sourcePath}.`,
            '',
            `Fetched: ${page.url}`,
            `Title: ${result.title}`,
            page.source === 'tavily'
              ? '(Extracted via Tavily — page was JS-heavy or too thin from direct fetch.)'
              : page.truncated
                ? '(HTML was truncated at fetch limit; readable text still saved.)'
                : '',
            '',
            'Excerpt:',
            result.excerpt + (page.text.length > 500 ? '…' : ''),
          ];
          if (isProfile && result.entityPath) {
            lines.unshift('BRAIN_GRAPH: Profile linked — open graph to see connections.');
          }
          return {
            success: true,
            output: lines.join('\n'),
          };
        } catch (error) {
          return { success: false, output: `Could not fetch URL: ${(error as Error).message}` };
        }
      }
      case 'remember': {
        const title = String(args?.title ?? '').trim();
        const content = String(args?.content ?? '').trim();
        if (!title || !content) {
          return { success: false, output: '"title" and "content" are required for remember.' };
        }
        const category = String(args?.category ?? 'fact') as 'concept' | 'entity' | 'source' | 'session' | 'fact';
        const output = await this.brain.remember(title, content, category);
        return { success: true, output };
      }
      case 'ingest': {
        const title = String(args?.title ?? '').trim();
        const content = String(args?.content ?? '').trim();
        if (!title || !content) {
          return { success: false, output: '"title" and "content" are required for ingest.' };
        }
        const sourceType = String(args?.source_type ?? 'note');
        const output = await this.brain.ingest(title, content, sourceType);
        return { success: true, output };
      }
      case 'save_session': {
        const content = String(args?.content ?? '').trim();
        if (!content) {
          return { success: false, output: '"content" summary is required for save_session.' };
        }
        const topics = Array.isArray(args?.topics)
          ? args.topics.filter((t): t is string => typeof t === 'string')
          : [];
        const output = await this.brain.saveSession(content, topics);
        return { success: true, output };
      }
      case 'update_hot': {
        const content = String(args?.content ?? '').trim();
        if (!content) {
          return { success: false, output: '"content" summary is required for update_hot.' };
        }
        const output = await this.brain.updateHot(content);
        return { success: true, output };
      }
      case 'get_page': {
        const path = String(args?.path ?? '').trim();
        let page = path ? await this.brain.getPage(path) : null;
        if (!page) {
          page = await this.brain.findUserEntityPage();
        }
        if (!page) {
          return { success: false, output: 'No matching brain page found.' };
        }
        return {
          success: true,
          output: [`# ${page.title}`, `Path: ${page.path}`, `Category: ${page.category}`, '', page.content].join('\n'),
        };
      }
      case 'link_user': {
        const output = await this.brain.linkUserEntityToJarvis();
        const graph = await this.brain.getGraph();
        return {
          success: true,
          output: `${output}\n\nBRAIN_GRAPH: ${graph.nodes.length} nodes, ${graph.edges.length} links.`,
        };
      }
      case 'link_pages': {
        const fromPath = String(args?.from_path ?? args?.from ?? '').trim();
        const toPath = String(args?.to_path ?? args?.to ?? '').trim();
        if (!fromPath || !toPath) {
          return { success: false, output: '"from_path" and "to_path" (titles or paths) are required for link_pages.' };
        }
        const bidirectional = args?.bidirectional !== false;
        const output = await this.brain.linkPagesByRef(fromPath, toPath, bidirectional);
        const graph = await this.brain.getGraph();
        const ok = output.startsWith('Linked');
        return {
          success: ok,
          output: `${output}\n\nBRAIN_GRAPH: ${graph.nodes.length} nodes, ${graph.edges.length} links.`,
        };
      }
      case 'consolidate': {
        const result = await this.brain.consolidateLinks();
        const pairLines =
          result.pairs.length > 0
            ? result.pairs.slice(0, 40).map((p) => `- ${p}`).join('\n')
            : 'No new pairs — pages may already be linked or lack overlapping topics.';
        return {
          success: true,
          output: [
            `BRAIN_GRAPH: Consolidated knowledge graph — ${result.nodeCount} nodes, ${result.edgeCount} links (${result.linked} new pairs).`,
            '',
            'New links:',
            pairLines,
            result.pairs.length > 40 ? `…and ${result.pairs.length - 40} more.` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        };
      }
      case 'cleanup': {
        const result = await this.brain.cleanupVault();
        const graph = await this.brain.getGraph();
        const removedList =
          result.removed.length > 0
            ? result.removed.map((r) => `- ${r}`).join('\n')
            : 'No garbage pages found.';
        return {
          success: true,
          output: [
            `Brain cleanup complete — removed ${result.removed.length} page(s), ${result.kept} remain.`,
            removedList,
            `BRAIN_GRAPH: ${graph.nodes.length} nodes, ${graph.edges.length} links.`,
          ].join('\n\n'),
        };
      }
      default:
        return { success: false, output: `Unknown action "${action}".` };
    }
  }
}
