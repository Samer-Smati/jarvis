import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class VercelDeployService {
  private readonly logger = new Logger(VercelDeployService.name);
  private readonly token: string;
  private readonly projectId: string;
  private readonly teamId: string;

  constructor(private readonly config: ConfigService) {
    this.token = config.get<string>('VERCEL_TOKEN')?.trim() ?? '';
    this.projectId = config.get<string>('VERCEL_PROJECT_ID')?.trim() ?? '';
    this.teamId = config.get<string>('VERCEL_TEAM_ID')?.trim() ?? '';
  }

  isConfigured(): boolean {
    return !!this.token && !!this.projectId;
  }

  async latestDeployment(): Promise<{
    url: string | null;
    state: string | null;
    createdAt: string | null;
  }> {
    if (!this.isConfigured()) {
      return { url: null, state: null, createdAt: null };
    }

    const params = new URLSearchParams({ projectId: this.projectId, limit: '1' });
    if (this.teamId) {
      params.set('teamId', this.teamId);
    }

    try {
      const response = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          'User-Agent': 'JARVIS-SelfImprove',
        },
      });
      const text = await response.text();
      if (!response.ok) {
        this.logger.warn(`Vercel deployments → ${response.status}`);
        return { url: null, state: null, createdAt: null };
      }
      const json = JSON.parse(text) as {
        deployments?: Array<{ url?: string; state?: string; createdAt?: number }>;
      };
      const latest = json.deployments?.[0];
      if (!latest) {
        return { url: null, state: null, createdAt: null };
      }
      return {
        url: latest.url ? `https://${latest.url}` : null,
        state: latest.state ?? null,
        createdAt: latest.createdAt ? new Date(latest.createdAt).toISOString() : null,
      };
    } catch (error) {
      this.logger.warn(`Vercel API error: ${(error as Error).message}`);
      return { url: null, state: null, createdAt: null };
    }
  }
}
