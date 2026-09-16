import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BrainService } from '../brain/brain.service';
import { MemoryService } from '../memory/memory.service';
import { isServerlessRuntime } from '../skills/project-scope.util';
import { pagesToTree } from './holo.notes.util';
import type { HoloFolder, HoloStateReport } from './holo.types';

/** Shown when the vault is empty, so the deck always has something to open. */
const EMPTY_TREE: HoloFolder[] = [
  {
    kind: 'folder',
    name: 'BRAIN',
    files: [
      {
        name: 'empty',
        title: 'Brain is empty',
        body: 'Nothing in the vault yet, sir. Ask me to remember something and it will appear here as a card.',
        full: '',
      },
    ],
  },
];

const DEFAULT_PROPS = ['apollo-11-module.glb', 'triceratops.glb'];

/** Gesture reports arrive every few hundred ms; only journal one per window. */
const EVENT_LOG_INTERVAL_MS = 10_000;

@Injectable()
export class HoloService {
  private readonly logger = new Logger(HoloService.name);
  private readonly statePath: string;
  private readonly diagPath: string;
  private readonly props: string[];
  private lastState: HoloStateReport | null = null;
  private lastLoggedAt = 0;

  constructor(
    config: ConfigService,
    private readonly brain: BrainService,
    private readonly memory: MemoryService,
  ) {
    const dataRoot = config.get<string>('DATA_ROOT') ?? join(process.cwd(), 'data');
    this.statePath = join(dataRoot, 'holo', 'holo-state.json');
    this.diagPath = join(dataRoot, 'holo', 'holo-diag.json');
    const configured = config.get<string>('HOLO_PROPS');
    this.props = configured
      ? configured.split(',').map((p) => p.trim()).filter(Boolean)
      : DEFAULT_PROPS;
  }

  /** Folder orbs + their cards, built from the brain vault. */
  async tree(): Promise<HoloFolder[]> {
    try {
      const pages = await this.brain.listPages();
      const tree = pagesToTree(pages);
      return tree.length ? tree : EMPTY_TREE;
    } catch (error) {
      this.logger.warn(`Holo tree failed, serving placeholder: ${(error as Error).message}`);
      return EMPTY_TREE;
    }
  }

  /** Grabbable .glb props the deck should load. */
  listProps(): string[] {
    return this.props;
  }

  get lastReport(): HoloStateReport | null {
    return this.lastState;
  }

  /**
   * The deck's hook back into JARVIS: every gesture that changes the deck lands here.
   * Kept cheap — state is held in memory, mirrored to disk off-serverless, and only
   * periodically journalled so a burst of drags can't flood the episodic log.
   */
  async recordState(event: string, card?: string): Promise<HoloStateReport> {
    const report: HoloStateReport = { event, card, ts: Date.now() };
    this.lastState = report;
    await this.persist(this.statePath, report);

    if (report.ts - this.lastLoggedAt >= EVENT_LOG_INTERVAL_MS) {
      this.lastLoggedAt = report.ts;
      try {
        await this.memory.logEvent(
          'holo_gesture',
          card ? `Holo deck: ${event} — ${card}` : `Holo deck: ${event}`,
        );
      } catch (error) {
        this.logger.warn(`Holo event log failed: ${(error as Error).message}`);
      }
    }
    return report;
  }

  /** The deck posts its own crash report here when a frame loop dies. */
  async recordDiag(payload: Record<string, unknown>): Promise<void> {
    const entry = { ...payload, ts: Date.now() };
    this.logger.warn(`Holo diagnostics: ${JSON.stringify(entry).slice(0, 400)}`);
    await this.persist(this.diagPath, entry);
  }

  private async persist(path: string, value: unknown): Promise<void> {
    if (isServerlessRuntime()) {
      return; // read-only filesystem; in-memory state and the log are enough
    }
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
    } catch (error) {
      this.logger.warn(`Holo persist failed (${path}): ${(error as Error).message}`);
    }
  }
}
