/** One note card on the deck. Shape is fixed by holo.html — do not rename fields. */
export interface HoloNote {
  name: string;
  title: string;
  body: string;
  full: string;
}

/** One folder orb. `kind` is always 'folder'; holo.html switches on it. */
export interface HoloFolder {
  kind: 'folder';
  name: string;
  files: HoloNote[];
}

/** Debounced gesture report posted by the deck after every manipulation. */
export interface HoloStateReport {
  event: string;
  card?: string;
  ts: number;
}

/** Which JARVIS entities the deck is asking for. `brain` is the default vault view. */
export type HoloSource = 'brain' | 'projects' | 'tasks' | 'memories' | 'events' | 'calendar' | 'all';

/** One entity rendered as a card. Deliberately flat: the deck shows a title, a
 *  body and whatever metadata the UI wants to echo back, and nothing else. */
export interface HoloItem {
  id: string;
  title: string;
  body: string;
  /** Matches the frontend's HoloObjectType. */
  type: 'note' | 'file' | 'project' | 'task' | 'memory' | 'event' | 'ai-node';
  metadata?: Record<string, unknown>;
}

/** A container orb and its cards. */
export interface HoloWorkspaceGroup {
  name: string;
  type: 'folder';
  items: HoloItem[];
}
