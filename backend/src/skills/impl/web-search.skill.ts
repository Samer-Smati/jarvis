import { Injectable, Logger } from '@nestjs/common';
import { Skill, SkillResult } from '../skill.interface';

interface DuckDuckGoTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DuckDuckGoTopic[];
}

interface DuckDuckGoResponse {
  AbstractText?: string;
  AbstractURL?: string;
  Answer?: string;
  RelatedTopics?: DuckDuckGoTopic[];
}

@Injectable()
export class WebSearchSkill implements Skill {
  private readonly logger = new Logger(WebSearchSkill.name);

  readonly name = 'web_search';
  readonly description =
    'Search the web (DuckDuckGo instant answers) and return a short summary with source links.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  };

  async execute(args: Record<string, unknown>): Promise<SkillResult> {
    const query = String(args?.query ?? '').trim();
    if (!query) {
      return { success: false, output: 'Missing "query" argument.' };
    }
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const response = await fetch(url);
      if (!response.ok) {
        return { success: false, output: `Search failed with status ${response.status}` };
      }
      const data = (await response.json()) as DuckDuckGoResponse;
      const lines: string[] = [];
      if (data.Answer) {
        lines.push(`Answer: ${data.Answer}`);
      }
      if (data.AbstractText) {
        lines.push(`${data.AbstractText}${data.AbstractURL ? ` (${data.AbstractURL})` : ''}`);
      }
      for (const topic of this.flattenTopics(data.RelatedTopics ?? []).slice(0, 5)) {
        if (topic.Text) {
          lines.push(`- ${topic.Text}${topic.FirstURL ? ` (${topic.FirstURL})` : ''}`);
        }
      }
      if (!lines.length) {
        return { success: true, output: `No instant answer found for "${query}".` };
      }
      return { success: true, output: lines.join('\n') };
    } catch (error) {
      this.logger.warn(`web_search failed: ${(error as Error).message}`);
      return { success: false, output: `Search error: ${(error as Error).message}` };
    }
  }

  private flattenTopics(topics: DuckDuckGoTopic[]): DuckDuckGoTopic[] {
    const flat: DuckDuckGoTopic[] = [];
    for (const topic of topics) {
      if (topic.Topics?.length) {
        flat.push(...this.flattenTopics(topic.Topics));
      } else {
        flat.push(topic);
      }
    }
    return flat;
  }
}
