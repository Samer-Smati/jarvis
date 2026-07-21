import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RepoRef {
  owner: string;
  repo: string;
}

interface GitHubFile {
  sha?: string;
  content?: string;
  encoding?: string;
}

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly token: string;
  private readonly repoRef: RepoRef | null;

  constructor(private readonly config: ConfigService) {
    this.token = config.get<string>('GITHUB_TOKEN')?.trim() ?? '';
    this.repoRef = parseRepo(config.get<string>('GITHUB_REPO')?.trim());
  }

  isConfigured(): boolean {
    return !!this.token && !!this.repoRef;
  }

  repoLabel(): string | null {
    return this.repoRef ? `${this.repoRef.owner}/${this.repoRef.repo}` : null;
  }

  async getDefaultBranch(): Promise<string> {
    const repo = await this.request<{ default_branch: string }>(
      `/repos/${this.repoRef!.owner}/${this.repoRef!.repo}`,
    );
    return repo.default_branch ?? 'main';
  }

  async getFile(path: string, ref?: string): Promise<{ content: string; sha: string } | null> {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    try {
      const file = await this.request<GitHubFile>(
        `/repos/${this.repoRef!.owner}/${this.repoRef!.repo}/contents/${encodePath(path)}${q}`,
      );
      if (!file.content || !file.sha) {
        return null;
      }
      const content = Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8');
      return { content, sha: file.sha };
    } catch (error) {
      if ((error as GitHubError).status === 404) {
        return null;
      }
      throw error;
    }
  }

  async createBranch(branch: string, fromRef?: string): Promise<string> {
    const base = fromRef ?? (await this.getDefaultBranch());
    const ref = await this.request<{ object: { sha: string } }>(
      `/repos/${this.repoRef!.owner}/${this.repoRef!.repo}/git/ref/heads/${base}`,
    );
    try {
      await this.request(`/repos/${this.repoRef!.owner}/${this.repoRef!.repo}/git/refs`, {
        method: 'POST',
        body: { ref: `refs/heads/${branch}`, sha: ref.object.sha },
      });
    } catch (error) {
      const gh = error as GitHubError;
      if (gh.status !== 422) {
        throw error;
      }
    }
    return branch;
  }

  async upsertFile(
    path: string,
    content: string,
    message: string,
    branch: string,
  ): Promise<{ sha: string; url: string }> {
    await this.createBranch(branch);
    const existing = await this.getFile(path, branch);
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
    };
    if (existing?.sha) {
      body.sha = existing.sha;
    }
    const result = await this.request<{ content: { sha: string; html_url: string } }>(
      `/repos/${this.repoRef!.owner}/${this.repoRef!.repo}/contents/${encodePath(path)}`,
      { method: 'PUT', body },
    );
    return { sha: result.content.sha, url: result.content.html_url };
  }

  async createPullRequest(
    title: string,
    body: string,
    head: string,
    base?: string,
  ): Promise<{ url: string; number: number }> {
    const targetBase = base ?? (await this.getDefaultBranch());
    const pr = await this.request<{ html_url: string; number: number }>(
      `/repos/${this.repoRef!.owner}/${this.repoRef!.repo}/pulls`,
      {
        method: 'POST',
        body: { title, body, head, base: targetBase },
      },
    );
    return { url: pr.html_url, number: pr.number };
  }

  async listDirectory(path: string, ref?: string): Promise<string[]> {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    try {
      const entries = await this.request<Array<{ name: string; type: string }>>(
        `/repos/${this.repoRef!.owner}/${this.repoRef!.repo}/contents/${encodePath(path)}${q}`,
      );
      if (!Array.isArray(entries)) {
        return [];
      }
      return entries.map((e) => `${e.type === 'dir' ? '[dir] ' : ''}${e.name}`);
    } catch (error) {
      if ((error as GitHubError).status === 404) {
        return [];
      }
      throw error;
    }
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('GitHub is not configured. Set GITHUB_TOKEN and GITHUB_REPO in backend/.env.');
    }
    const url = `https://api.github.com${path}`;
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'JARVIS-SelfImprove',
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });

    const text = await response.text();
    if (!response.ok) {
      this.logger.warn(`GitHub ${init?.method ?? 'GET'} ${path} → ${response.status}`);
      const err = new Error(parseGitHubError(text, response.status)) as GitHubError;
      err.status = response.status;
      throw err;
    }

    return text ? (JSON.parse(text) as T) : ({} as T);
  }
}

interface GitHubError extends Error {
  status?: number;
}

function parseRepo(value?: string): RepoRef | null {
  if (!value) {
    return null;
  }
  const trimmed = value.replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').trim();
  const [owner, repo] = trimmed.split('/').filter(Boolean);
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function parseGitHubError(text: string, status: number): string {
  try {
    const json = JSON.parse(text) as { message?: string };
    if (json.message) {
      return `GitHub API ${status}: ${json.message}`;
    }
  } catch {
    /* ignore */
  }
  return `GitHub API ${status}: ${text.slice(0, 200)}`;
}
