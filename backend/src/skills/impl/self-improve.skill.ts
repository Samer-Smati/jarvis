import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GitHubService } from '../../integrations/github.service';
import { VercelDeployService } from '../../integrations/vercel-deploy.service';
import { Skill, SkillContext, SkillResult } from '../skill.interface';
import {
  isServerlessRuntime,
  isWriteBlocked,
  resolveJarvisProjectRoot,
  resolveProjectPath,
} from '../project-scope.util';

const MAX_READ = 12000;
const RUN_TIMEOUT_MS = 120000;

@Injectable()
export class SelfImproveSkill implements Skill {
  readonly name = 'self_improve';
  readonly description =
    'Upgrade JARVIS itself: inspect the project repo, edit code, run build checks, commit, and open a GitHub pull request. Use when the user asks to update, upgrade, fix, or improve JARVIS. Start with status, then inspect, write changes, run_checks, then pull_request.';
  readonly requiresConfirmation = false;
  readonly parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'inspect', 'write', 'run_checks', 'commit', 'pull_request'],
        description:
          'status=capabilities; inspect=list/read files; write=apply code change; run_checks=build; commit=git commit (desktop); pull_request=open GitHub PR',
      },
      path: { type: 'string', description: 'Relative path inside the JARVIS repo (inspect/write).' },
      content: { type: 'string', description: 'Full file content for write action.' },
      branch: {
        type: 'string',
        description: 'Git branch name. Default: jarvis/self-improve-<timestamp>',
      },
      message: { type: 'string', description: 'Commit message or PR description.' },
      title: { type: 'string', description: 'Pull request title.' },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional file paths to stage for commit (desktop).',
      },
    },
    required: ['action'],
  };

  private readonly projectRoot: string;

  constructor(
    config: ConfigService,
    private readonly github: GitHubService,
    private readonly vercel: VercelDeployService,
  ) {
    this.projectRoot = resolveJarvisProjectRoot(config);
  }

  async execute(args: Record<string, unknown>, _context: SkillContext): Promise<SkillResult> {
    const action = String(args?.action ?? '');
    switch (action) {
      case 'status':
        return this.status();
      case 'inspect':
        return this.inspect(args);
      case 'write':
        return this.write(args);
      case 'run_checks':
        return this.runChecks();
      case 'commit':
        return this.commit(args);
      case 'pull_request':
        return this.pullRequest(args);
      default:
        return { success: false, output: `Unknown action "${action}".` };
    }
  }

  private async status(): Promise<SkillResult> {
    const serverless = isServerlessRuntime();
    let version = 'unknown';
    try {
      const pkg = JSON.parse(await fs.readFile(join(this.projectRoot, 'package.json'), 'utf8')) as {
        version?: string;
      };
      version = pkg.version ?? version;
    } catch {
      /* cloud may lack local package.json */
    }

    const deploy = this.vercel.isConfigured() ? await this.vercel.latestDeployment() : null;
    const lines = [
      `JARVIS v${version}`,
      `Runtime: ${serverless ? 'cloud (Vercel)' : 'desktop (local repo)'}`,
      `Project root: ${this.projectRoot}`,
      `GitHub: ${this.github.isConfigured() ? this.github.repoLabel() : 'not configured — set GITHUB_TOKEN + GITHUB_REPO'}`,
      `Vercel deploy API: ${this.vercel.isConfigured() ? 'configured' : 'optional — set VERCEL_TOKEN + VERCEL_PROJECT_ID'}`,
      `Local file writes: ${serverless ? 'disabled (use write → GitHub branch)' : 'enabled'}`,
    ];
    if (deploy?.url) {
      lines.push(`Latest Vercel deploy: ${deploy.url} (${deploy.state ?? 'unknown'})`);
    }
    lines.push(
      '',
      'Self-upgrade workflow:',
      '1. inspect paths you need to change',
      '2. write updated file content',
      '3. run_checks (desktop) or skip on cloud',
      '4. pull_request to publish — merge triggers Vercel auto-deploy',
    );
    return { success: true, output: lines.join('\n') };
  }

  private async inspect(args: Record<string, unknown>): Promise<SkillResult> {
    const relative = typeof args.path === 'string' ? args.path : '.';
    const mode = String(args.mode ?? 'read');
    const listMode = mode === 'list' || relative.endsWith('/') || relative === '.';

    if (this.github.isConfigured() && isServerlessRuntime()) {
      try {
        const entries = await this.github.listDirectory(relative.replace(/^\.\//, ''));
        if (listMode && entries.length) {
          return { success: true, output: entries.join('\n') };
        }
        const file = await this.github.getFile(relative.replace(/^\.\//, ''));
        if (!file) {
          return { success: false, output: `File not found on GitHub: ${relative}` };
        }
        const truncated =
          file.content.length > MAX_READ
            ? `${file.content.slice(0, MAX_READ)}\n...[truncated]`
            : file.content;
        return { success: true, output: truncated };
      } catch (error) {
        return { success: false, output: (error as Error).message };
      }
    }

    const target = resolveProjectPath(this.projectRoot, relative);
    if (!target) {
      return { success: false, output: 'Access denied: path escapes the project root.' };
    }

    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory() || listMode) {
        const entries = await fs.readdir(target, { withFileTypes: true });
        const lines = entries.map((e) => `${e.isDirectory() ? '[dir] ' : ''}${e.name}`);
        return { success: true, output: lines.length ? lines.join('\n') : 'Empty folder.' };
      }
      const content = await fs.readFile(target, 'utf8');
      const truncated = content.length > MAX_READ ? `${content.slice(0, MAX_READ)}\n...[truncated]` : content;
      return { success: true, output: truncated };
    } catch (error) {
      return { success: false, output: `Inspect error: ${(error as Error).message}` };
    }
  }

  private async write(args: Record<string, unknown>): Promise<SkillResult> {
    const relative = typeof args.path === 'string' ? args.path.replace(/^\.\//, '') : '';
    const content = typeof args.content === 'string' ? args.content : '';
    if (!relative) {
      return { success: false, output: '"path" is required for write.' };
    }
    if (!content) {
      return { success: false, output: '"content" is required for write.' };
    }
    if (isWriteBlocked(relative)) {
      return { success: false, output: `Write blocked for safety: ${relative}` };
    }

    const branch = this.resolveBranch(args);
    const message =
      typeof args.message === 'string' && args.message.trim()
        ? args.message.trim()
        : `chore(jarvis): update ${relative}`;

    if (isServerlessRuntime() || !resolveProjectPath(this.projectRoot, relative)) {
      if (!this.github.isConfigured()) {
        return {
          success: false,
          output: 'Cloud mode requires GITHUB_TOKEN and GITHUB_REPO to write files via GitHub API.',
        };
      }
      try {
        const result = await this.github.upsertFile(relative, content, message, branch);
        return {
          success: true,
          output: `Updated ${relative} on branch ${branch}.\nCommit: ${result.url}`,
        };
      } catch (error) {
        return { success: false, output: (error as Error).message };
      }
    }

    const target = resolveProjectPath(this.projectRoot, relative)!;
    try {
      await fs.mkdir(join(target, '..'), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
      return {
        success: true,
        output: `Wrote ${relative} locally (${content.length} bytes). Run run_checks then commit or pull_request.`,
      };
    } catch (error) {
      return { success: false, output: `Write error: ${(error as Error).message}` };
    }
  }

  private async runChecks(): Promise<SkillResult> {
    if (isServerlessRuntime()) {
      return {
        success: true,
        output: 'Build checks skipped on Vercel (no local repo). Open a PR — CI/Vercel preview will validate.',
      };
    }
    const output = await runCommand('npm run build', this.projectRoot, RUN_TIMEOUT_MS);
    const failed =
      output.includes('npm ERR!') || /error TS/i.test(output) || /Nest build failed/i.test(output);
    return {
      success: !failed,
      output: failed ? `Build failed:\n${output}` : `Build succeeded:\n${output.slice(-3000)}`,
    };
  }

  private async commit(args: Record<string, unknown>): Promise<SkillResult> {
    if (isServerlessRuntime()) {
      return {
        success: true,
        output: 'Commits on cloud happen per write via GitHub API. Use pull_request next.',
      };
    }
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    if (!message) {
      return { success: false, output: '"message" is required for commit.' };
    }
    const branch = this.resolveBranch(args);

    const checkout = await runCommand(`git checkout -B ${branch}`, this.projectRoot, 30000);
    if (checkout.includes('fatal:') && !checkout.includes('Switched')) {
      return { success: false, output: `Git checkout failed:\n${checkout}` };
    }

    const pathList = Array.isArray(args.paths)
      ? args.paths.filter((p): p is string => typeof p === 'string')
      : [];
    const addCmd = pathList.length
      ? `git add ${pathList.map((p) => `"${p.replace(/"/g, '')}"`).join(' ')}`
      : 'git add -A';
    const addOut = await runCommand(addCmd, this.projectRoot, 30000);
    const commitOut = await runCommand(`git commit -m "${message.replace(/"/g, '\\"')}"`, this.projectRoot, 30000);
    if (commitOut.includes('nothing to commit')) {
      return { success: false, output: `Nothing to commit.\n${addOut}\n${commitOut}` };
    }
    return {
      success: true,
      output: `Committed on branch ${branch}.\n${commitOut.trim()}`,
    };
  }

  private async pullRequest(args: Record<string, unknown>): Promise<SkillResult> {
    const branch = this.resolveBranch(args);
    const title =
      typeof args.title === 'string' && args.title.trim()
        ? args.title.trim()
        : 'JARVIS self-improvement';
    const body =
      typeof args.message === 'string' && args.message.trim()
        ? args.message.trim()
        : 'Automated self-upgrade by JARVIS. Review changes before merging.';

    if (!this.github.isConfigured()) {
      return {
        success: false,
        output: 'GitHub not configured. Set GITHUB_TOKEN and GITHUB_REPO (e.g. Samer-Smati/jarvis).',
      };
    }

    if (!isServerlessRuntime()) {
      const pushOut = await runCommand(`git push -u origin ${branch}`, this.projectRoot, 60000);
      if (pushOut.includes('fatal:') || pushOut.includes('error:')) {
        return { success: false, output: `Git push failed:\n${pushOut}` };
      }
    }

    try {
      const pr = await this.github.createPullRequest(title, body, branch);
      const deployHint = this.vercel.isConfigured()
        ? ' Vercel will deploy after merge to main.'
        : ' Merge to main to trigger your Vercel GitHub integration.';
      return {
        success: true,
        output: `Pull request #${pr.number} opened: ${pr.url}.${deployHint}`,
      };
    } catch (error) {
      return { success: false, output: (error as Error).message };
    }
  }

  private resolveBranch(args: Record<string, unknown>): string {
    if (typeof args.branch === 'string' && args.branch.trim()) {
      return args.branch.trim().replace(/[^a-zA-Z0-9/_-]/g, '-');
    }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    return `jarvis/self-improve-${stamp}`;
  }
}

function runCommand(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, [], {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      output += `\n...[timed out after ${timeoutMs}ms]`;
      resolve(output);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(output.slice(0, 16000));
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(`Spawn error: ${err.message}`);
    });
  });
}
