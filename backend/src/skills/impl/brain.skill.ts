import { Injectable } from '@nestjs/common';
import { BrainService } from '../../brain/brain.service';
import { Skill, SkillContext, SkillResult } from '../skill.interface';

@Injectable()
export class BrainSkill implements Skill {
  readonly name = 'brain';
  readonly description =
    'JARVIS persistent second brain (LLM Wiki / claude-obsidian pattern). ' +
    'Stores linked Markdown knowledge: hot cache, index, concepts, entities, sources, sessions. ' +
    'Use query to recall knowledge, remember for facts, ingest for sources, save_session after important chats. Use graph when the user asks to see links, connections, or a knowledge graph.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'query', 'graph', 'remember', 'ingest', 'save_session', 'update_hot'],
        description:
          'status=brain overview; query=search vault; graph=open live link graph in UI; remember=store fact/concept; ingest=add source; save_session=file conversation summary; update_hot=refresh recent context',
      },
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
    },
    required: ['action'],
  };

  constructor(private readonly brain: BrainService) {}

  async execute(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const action = String(args?.action ?? '');
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
      default:
        return { success: false, output: `Unknown action "${action}".` };
    }
  }
}
