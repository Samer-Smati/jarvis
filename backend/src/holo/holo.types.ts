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
