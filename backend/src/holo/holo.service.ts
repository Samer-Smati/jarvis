import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BrainService } from '../brain/brain.service';
import { MemoryService } from '../memory/memory.service';
import { isServerlessRuntime } from '../skills/project-scope.util';
import { CalendarEventEntity } from '../skills/entities/calendar-event.entity';
import { ReminderEntity } from '../skills/entities/reminder.entity';
import { pagesToTree } from './holo.notes.util';
import type { HoloFolder, HoloSource, HoloStateReport, HoloWorkspaceGroup } from './holo.types';
import {
  calendarToGroup,
  eventsToGroup,
  memoriesToGroup,
  pagesToGroups,
  projectsToGroup,
  remindersToGroup,
} from './holo.workspace.util';

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
    @InjectRepository(ReminderEntity)
    private readonly reminders: Repository<ReminderEntity>,
    @InjectRepository(CalendarEventEntity)
    private readonly calendarEvents: Repository<CalendarEventEntity>,
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

  /**
   * The spatial workspace for one source. Every branch reads through an existing
   * JARVIS service or repository — the deck is a view, and owns no data of its
   * own. A source that fails is skipped rather than failing the whole workspace,
   * so one empty table cannot blank the deck.
   */
  async workspace(source: HoloSource): Promise<HoloWorkspaceGroup[]> {
    const wanted = (s: HoloSource) => source === 'all' || source === s;
    const groups: HoloWorkspaceGroup[] = [];

    if (wanted('brain')) {
      groups.push(...(await this.safely('brain', async () => pagesToGroups(await this.brain.listPages(), pagesToTree))));
    }
    if (wanted('projects')) {
      groups.push(...(await this.safely('projects', async () => projectsToGroup(await this.memory.listProjects()))));
    }
    if (wanted('tasks')) {
      groups.push(
        ...(await this.safely('tasks', async () =>
          remindersToGroup(await this.reminders.find({ where: { fired: false } })),
        )),
      );
    }
    if (wanted('memories')) {
      groups.push(...(await this.safely('memories', async () => memoriesToGroup(await this.memory.listFacts()))));
    }
    if (wanted('events')) {
      groups.push(...(await this.safely('events', async () => eventsToGroup(await this.memory.recentEvents(20)))));
    }
    if (wanted('calendar')) {
      groups.push(
        ...(await this.safely('calendar', async () => calendarToGroup(await this.calendarEvents.find()))),
      );
    }

    return groups;
  }

  private async safely(
    label: string,
    load: () => Promise<HoloWorkspaceGroup[]>,
  ): Promise<HoloWorkspaceGroup[]> {
    try {
      return await load();
    } catch (error) {
      this.logger.warn(`Holo workspace source "${label}" failed: ${(error as Error).message}`);
      return [];
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
