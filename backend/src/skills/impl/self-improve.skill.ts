import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GitHubService } from '../../integrations/github.service';
import { VercelDeployService } from '../../integrations/vercel-deploy.service';
import { Skill, SkillContext, SkillProgress, SkillResult } from '../skill.interface';
import {
  isServerlessRuntime,
  isWriteBlocked,
  resolveJarvisProjectRoot,
  resolveProjectPath,
} from '../project-scope.util';

const MAX_READ = 12000;
const RUN_TIMEOUT_MS = 120000;

const PATH_ALIASES: Record<string, string> = {
  ui: 'frontend/src/app',
  'ui/': 'frontend/src/app/',
  app: 'frontend/src/app',
  mobile: 'frontend/src/app',
  chat: 'frontend/src/app/chat',
  skills: 'backend/src/skills',
  orchestrator: 'backend/src/orchestrator',
  llm: 'backend/src/llm',
};

const UPGRADE_CATALOG = [
  'Chat UI & upgrade panel — frontend/src/app/chat/',
  'Self-improve skill — backend/src/skills/impl/self-improve.skill.ts',
  'Orchestrator & personality — backend/src/orchestrator/',
  'LLM providers (Gemini, Groq) — backend/src/llm/',
  'Voice & TTS — frontend/src/app/core/voice.service.ts',
  'Integrations (GitHub, Vercel) — backend/src/integrations/',
  'Serverless entry — api/index.js, backend/src/serverless.ts',
];

const ACTION_PROGRESS: Record<string, { stage: string; percent: number; label: string }> = {
  status: { stage: 'status', percent: 12, label: 'Checking self-upgrade capabilities' },
  inspect: { stage: 'inspect', percent: 28, label: 'Inspecting project files' },
  write: { stage: 'write', percent: 52, label: 'Applying code changes' },
  run_checks: { stage: 'run_checks', percent: 72, label: 'Running build checks' },
  commit: { stage: 'commit', percent: 86, label: 'Committing changes' },
  pull_request: { stage: 'pull_request', percent: 96, label: 'Opening pull request' },
};

@Injectable()
export class SelfImproveSkill implements Skill {
  readonly name = 'self_improve';
  readonly description =
    'Upgrade JARVIS itself by editing real code (skills, UI, orchestrator, integrations), running checks, and opening a GitHub PR. Use for update/upgrade/fix/improve JARVIS. For "what can you upgrade" or "what do you need", call action=status and report readiness — never treat a version bump as the upgrade. Workflow: status → inspect → write → run_checks → pull_request.';
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

  async execute(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const action = String(args?.action ?? '');
    const meta = ACTION_PROGRESS[action];
    if (meta) {
      this.progress(context, {
        stage: meta.stage,
        message: meta.label,
        percent: meta.percent,
        detail: this.actionDetail(action, args),
      });
    }

    switch (action) {
      case 'status':
        return this.status(context);
      case 'inspect':
        return this.inspect(args, context);
      case 'write':
        return this.write(args, context);
      case 'run_checks':
        return this.runChecks(context);
      case 'commit':
        return this.commit(args, context);
      case 'pull_request':
        return this.pullRequest(args, context);
      default:
        return { success: false, output: `Unknown action "${action}".` };
    }
  }

  private progress(context: SkillContext, event: SkillProgress): void {
    context.onProgress?.(event);
  }

  private actionDetail(action: string, args: Record<string, unknown>): string | undefined {
    if (action === 'inspect' || action === 'write') {
      return typeof args.path === 'string' ? args.path : undefined;
    }
    if (action === 'commit' || action === 'pull_request') {
      return typeof args.branch === 'string' ? args.branch : undefined;
    }
    return undefined;
  }

  private async status(context: SkillContext): Promise<SkillResult> {
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

    this.progress(context, {
      stage: 'status',
      message: 'Reading deployment and GitHub configuration…',
      percent: 15,
    });

    const githubOk = this.github.isConfigured();
    const vercelOk = this.vercel.isConfigured();
    const localWrites = !serverless;
    const canUpgrade = githubOk || localWrites;
    const deploy = vercelOk ? await this.vercel.latestDeployment() : null;

    let repoRoot = '';
    if (githubOk && serverless) {
      try {
        const entries = await this.github.listDirectory('');
        repoRoot = entries.length ? entries.join('\n') : '';
      } catch {
        repoRoot = '';
      }
    }

    const blocked: string[] = [];
    if (serverless && !githubOk) {
      blocked.push('Cloud mode needs GITHUB_TOKEN + GITHUB_REPO before any write/PR.');
    }
    if (!githubOk) {
      blocked.push('GitHub not configured — pull_request and cloud writes unavailable.');
    }

    const ready: string[] = [];
    if (localWrites) {
      ready.push('Local file writes enabled (desktop).');
    }
    if (githubOk) {
      ready.push(`GitHub ready (${this.github.repoLabel()}) — can open PRs.`);
    }
    if (vercelOk) {
      ready.push('Vercel deploy API configured — can report latest deploy.');
    }

    const lines = [
      `JARVIS v${version}`,
      `Runtime: ${serverless ? 'cloud (Vercel)' : 'desktop (local repo)'}`,
      `Project root: ${this.projectRoot}`,
      `Upgrade readiness: ${canUpgrade ? 'READY' : 'BLOCKED'}`,
      `GitHub: ${githubOk ? this.github.repoLabel() : 'not configured — set GITHUB_TOKEN + GITHUB_REPO'}`,
      `Vercel deploy API: ${vercelOk ? 'configured' : 'optional — set VERCEL_TOKEN + VERCEL_PROJECT_ID'}`,
      `Local file writes: ${localWrites ? 'enabled' : 'disabled (use write → GitHub branch)'}`,
    ];
    if (deploy?.url) {
      lines.push(`Latest Vercel deploy: ${deploy.url} (${deploy.state ?? 'unknown'})`);
    }
    if (repoRoot) {
      lines.push('', 'Repo root (GitHub):', repoRoot);
    }
    lines.push('', 'Upgrade catalog (pick one for the user):', ...UPGRADE_CATALOG.map((c) => `- ${c}`));
    if (ready.length) {
      lines.push('', 'Ready:', ...ready.map((r) => `- ${r}`));
    }
    if (blocked.length) {
      lines.push('', 'Blocked / needs setup:', ...blocked.map((b) => `- ${b}`));
    }
    lines.push(
      '',
      'How to answer the user from this status:',
      '- Tell them whether self-upgrade is ready or what config is missing.',
      '- Do NOT propose bumping package.json / bump:version / tagging a release as the upgrade.',
      '- A real upgrade changes product behavior: skills, chat UI, orchestrator, voice, memory, integrations, bugs.',
      '- Ask which concrete improvement they want first, then inspect + write that code.',
      '',
      'Self-upgrade workflow:',
      '1. inspect paths you need to change',
      '2. write updated file content',
      '3. run_checks (desktop) or skip on cloud',
      '4. pull_request to publish — merge triggers Vercel auto-deploy',
    );
    this.progress(context, {
      stage: 'status',
      message: canUpgrade ? 'Ready to upgrade' : 'Upgrade blocked — setup needed',
      percent: 18,
      detail: `v${version} · ${serverless ? 'cloud' : 'desktop'}`,
    });
    return { success: true, output: lines.join('\n') };
  }

  private async inspect(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const relative = this.normalizeInspectPath(typeof args.path === 'string' ? args.path : '.');
    const mode = String(args.mode ?? 'read');
    const listMode = mode === 'list' || relative.endsWith('/') || relative === '.';

    this.progress(context, {
      stage: 'inspect',
      message: listMode ? `Listing ${relative}` : `Reading ${relative}`,
      percent: 30,
      detail: relative,
    });

    if (this.github.isConfigured() && isServerlessRuntime()) {
      try {
        const ghPath = relative.replace(/^\.\//, '').replace(/\/$/, '');
        const entries = ghPath ? await this.github.listDirectory(ghPath) : await this.github.listDirectory('');
        if (listMode) {
          if (!entries.length) {
            const root = await this.github.listDirectory('');
            const hint = root.length ? `\n\nRepo root contains:\n${root.join('\n')}` : '';
            return {
              success: false,
              output: `Path not found on GitHub: ${relative}.${hint}`,
            };
          }
          this.progress(context, {
            stage: 'inspect',
            message: `Listed ${entries.length} entries`,
            percent: 38,
            detail: relative,
          });
          return { success: true, output: entries.join('\n') };
        }
        const file = await this.github.getFile(ghPath);
        if (!file) {
          const root = await this.github.listDirectory('');
          const hint = root.length ? `\n\nRepo root contains:\n${root.join('\n')}` : '';
          return { success: false, output: `File not found on GitHub: ${relative}.${hint}` };
        }
        const truncated =
          file.content.length > MAX_READ
            ? `${file.content.slice(0, MAX_READ)}\n...[truncated]`
            : file.content;
        this.progress(context, {
          stage: 'inspect',
          message: `Read ${relative}`,
          percent: 38,
          detail: `${file.content.length} chars`,
        });
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
        this.progress(context, {
          stage: 'inspect',
          message: `Listed ${lines.length} entries`,
          percent: 38,
          detail: relative,
        });
        return { success: true, output: lines.length ? lines.join('\n') : 'Empty folder.' };
      }
      const content = await fs.readFile(target, 'utf8');
      const truncated = content.length > MAX_READ ? `${content.slice(0, MAX_READ)}\n...[truncated]` : content;
      this.progress(context, {
        stage: 'inspect',
        message: `Read ${relative}`,
        percent: 38,
        detail: `${content.length} chars`,
      });
      return { success: true, output: truncated };
    } catch (error) {
      return { success: false, output: `Inspect error: ${(error as Error).message}` };
    }
  }

  private normalizeInspectPath(path: string): string {
    const trimmed = path.trim().replace(/^\.\//, '') || '.';
    const key = trimmed.toLowerCase().replace(/\/$/, '');
    const aliased = PATH_ALIASES[trimmed.toLowerCase()] ?? PATH_ALIASES[key];
    return aliased ?? trimmed;
  }

  private async write(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
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

    this.progress(context, {
      stage: 'write',
      message: `Writing ${relative}…`,
      percent: 55,
      detail: branch,
    });

    if (isServerlessRuntime() || !resolveProjectPath(this.projectRoot, relative)) {
      if (!this.github.isConfigured()) {
        return {
          success: false,
          output: 'Cloud mode requires GITHUB_TOKEN and GITHUB_REPO to write files via GitHub API.',
        };
      }
      try {
        const result = await this.github.upsertFile(relative, content, message, branch);
        this.progress(context, {
          stage: 'write',
          message: `Updated ${relative} on ${branch}`,
          percent: 60,
          detail: result.url,
        });
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
      this.progress(context, {
        stage: 'write',
        message: `Wrote ${relative} locally`,
        percent: 60,
        detail: `${content.length} bytes`,
      });
      return {
        success: true,
        output: `Wrote ${relative} locally (${content.length} bytes). Run run_checks then commit or pull_request.`,
      };
    } catch (error) {
      return { success: false, output: `Write error: ${(error as Error).message}` };
    }
  }

  private async runChecks(context: SkillContext): Promise<SkillResult> {
    if (isServerlessRuntime()) {
      this.progress(context, {
        stage: 'run_checks',
        message: 'Skipping local build on cloud',
        percent: 75,
      });
      return {
        success: true,
        output: 'Build checks skipped on Vercel (no local repo). Open a PR — CI/Vercel preview will validate.',
      };
    }

    this.progress(context, {
      stage: 'run_checks',
      message: 'Running npm run build…',
      percent: 74,
      detail: this.projectRoot,
    });

    const output = await runCommand('npm run build', this.projectRoot, RUN_TIMEOUT_MS, (chunk) => {
      const line = chunk.trim().split(/\r?\n/).filter(Boolean).pop();
      if (line) {
        this.progress(context, {
          stage: 'run_checks',
          message: 'Build in progress…',
          percent: 78,
          detail: line.slice(0, 160),
        });
      }
    });
    const failed =
      output.includes('npm ERR!') || /error TS/i.test(output) || /Nest build failed/i.test(output);
    this.progress(context, {
      stage: 'run_checks',
      message: failed ? 'Build failed' : 'Build succeeded',
      percent: failed ? 78 : 82,
    });
    return {
      success: !failed,
      output: failed ? `Build failed:\n${output}` : `Build succeeded:\n${output.slice(-3000)}`,
    };
  }

  private async commit(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    if (isServerlessRuntime()) {
      this.progress(context, {
        stage: 'commit',
        message: 'Cloud writes already committed via GitHub API',
        percent: 88,
      });
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

    this.progress(context, {
      stage: 'commit',
      message: `Checking out ${branch}…`,
      percent: 87,
      detail: branch,
    });
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
    this.progress(context, {
      stage: 'commit',
      message: 'Staging changes…',
      percent: 89,
    });
    const addOut = await runCommand(addCmd, this.projectRoot, 30000);
    this.progress(context, {
      stage: 'commit',
      message: 'Creating commit…',
      percent: 91,
      detail: message.slice(0, 120),
    });
    const commitOut = await runCommand(`git commit -m "${message.replace(/"/g, '\\"')}"`, this.projectRoot, 30000);
    if (commitOut.includes('nothing to commit')) {
      return { success: false, output: `Nothing to commit.\n${addOut}\n${commitOut}` };
    }
    this.progress(context, {
      stage: 'commit',
      message: `Committed on ${branch}`,
      percent: 92,
    });
    return {
      success: true,
      output: `Committed on branch ${branch}.\n${commitOut.trim()}`,
    };
  }

  private async pullRequest(args: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
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
      this.progress(context, {
        stage: 'pull_request',
        message: `Pushing ${branch} to origin…`,
        percent: 94,
        detail: branch,
      });
      const pushOut = await runCommand(`git push -u origin ${branch}`, this.projectRoot, 60000, (chunk) => {
        const line = chunk.trim().split(/\r?\n/).filter(Boolean).pop();
        if (line) {
          this.progress(context, {
            stage: 'pull_request',
            message: 'Pushing to GitHub…',
            percent: 95,
            detail: line.slice(0, 160),
          });
        }
      });
      if (pushOut.includes('fatal:') || pushOut.includes('error:')) {
        return { success: false, output: `Git push failed:\n${pushOut}` };
      }
    }

    this.progress(context, {
      stage: 'pull_request',
      message: 'Creating pull request…',
      percent: 97,
      detail: title,
    });

    try {
      const pr = await this.github.createPullRequest(title, body, branch);
      const deployHint = this.vercel.isConfigured()
        ? ' Vercel will deploy after merge to main.'
        : ' Merge to main to trigger your Vercel GitHub integration.';
      this.progress(context, {
        stage: 'pull_request',
        message: `PR #${pr.number} opened`,
        percent: 100,
        detail: pr.url,
      });
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

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  onChunk?: (chunk: string) => void,
): Promise<string> {
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

    const append = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      onChunk?.(text);
    };

    child.stdout.on('data', append);
    child.stderr.on('data', append);
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
