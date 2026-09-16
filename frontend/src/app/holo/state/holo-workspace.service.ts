import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import type { HoloSource } from '../api/holo-api.service';

/** What the assistant can ask the deck to do. Names follow the spec's vocabulary
 *  so a spoken or typed request maps onto one obvious command. */
export type HoloCommandKind =
  | 'SHOW_WORKSPACE'
  | 'ORGANIZE_WORKSPACE'
  | 'RESET_WORKSPACE'
  | 'SEARCH_SECOND_BRAIN';

export interface HoloCommand {
  kind: HoloCommandKind;
  source?: HoloSource;
  query?: string;
}

/**
 * The bridge between chat and the deck, modelled on BrainGraphService — which is
 * how the knowledge graph is already opened from a conversation. Commands are a
 * stream rather than state: the deck may not be mounted when one is issued, and
 * a late subscriber should not replay a stale instruction.
 */
@Injectable({ providedIn: 'root' })
export class HoloWorkspaceService {
  private readonly commandSubject = new Subject<HoloCommand>();
  readonly command$: Observable<HoloCommand> = this.commandSubject.asObservable();

  /** The source the deck should load when it next mounts, so a command issued
   *  from chat survives the navigation to /holo. */
  private pending: HoloCommand | null = null;

  send(command: HoloCommand): void {
    this.pending = command;
    this.commandSubject.next(command);
  }

  show(source: HoloSource): void {
    this.send({ kind: 'SHOW_WORKSPACE', source });
  }

  /** Consumed once by the deck on mount. */
  takePending(): HoloCommand | null {
    const command = this.pending;
    this.pending = null;
    return command;
  }
}

/** Sources the matcher can name, longest phrases first so "second brain" is not
 *  shadowed by "brain". */
const SOURCE_PATTERNS: Array<{ pattern: RegExp; source: HoloSource }> = [
  { pattern: /\b(calendar|schedule|meetings?|agenda)\b/i, source: 'calendar' },
  { pattern: /\b(reminders?|tasks?|to-?dos?)\b/i, source: 'tasks' },
  { pattern: /\b(projects?)\b/i, source: 'projects' },
  { pattern: /\b(memories|memory|facts?|what you (know|remember))\b/i, source: 'memories' },
  { pattern: /\b(events?|history|activity|timeline)\b/i, source: 'events' },
  { pattern: /\b(notes?|second brain|brain|vault|knowledge)\b/i, source: 'brain' },
  { pattern: /\b(everything|all of it|whole workspace)\b/i, source: 'all' },
];

/**
 * Does this message ask for the spatial workspace?
 *
 * Deliberately conservative: it requires both a spatial verb and a known source,
 * so "how are my projects going?" stays an ordinary question and only an explicit
 * "show me my projects" opens the deck. Mirrors `isBrainGraphRequest`, which is
 * the existing precedent for opening a view from chat.
 */
export function holoCommandFor(text: string): HoloCommand | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return null;
  }

  if (/\b(organi[sz]e|tidy|arrange|grid)\b.*\b(workspace|deck|holo|everything)\b/i.test(trimmed)) {
    return { kind: 'ORGANIZE_WORKSPACE' };
  }
  if (/\b(reset|restore|clear)\b.*\b(workspace|deck|holo|layout)\b/i.test(trimmed)) {
    return { kind: 'RESET_WORKSPACE' };
  }

  const spatial =
    /\b(show|open|display|bring up|pull up|visuali[sz]e|spatial|holo|deck|workspace|second brain)\b/i.test(
      trimmed,
    );
  if (!spatial) {
    return null;
  }

  for (const { pattern, source } of SOURCE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { kind: 'SHOW_WORKSPACE', source };
    }
  }

  // "open the holo deck" with no named source is still a valid request.
  return /\b(holo|deck|workspace|spatial)\b/i.test(trimmed)
    ? { kind: 'SHOW_WORKSPACE', source: 'brain' }
    : null;
}
