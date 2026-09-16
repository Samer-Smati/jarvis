import type { Handedness } from '../types/holo.types';

/** World-space point. The renderer consumes these directly; no three.js types
 *  are allowed above the renderer seam. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type SceneObjectKind = 'orb' | 'card' | 'prop';

/**
 * What a card actually represents. Orbs are containers; every other type maps to
 * a real JARVIS entity, which is what lets the adapter stay generic instead of
 * growing a branch per source.
 */
export type HoloObjectType =
  | 'folder'
  | 'note'
  | 'file'
  | 'project'
  | 'task'
  | 'memory'
  | 'event'
  | 'ai-node'
  | 'prop';

/**
 * One thing in the deck. Orbs are brain-vault folders; cards are the notes
 * inside one. Both are grabbable, so they share a shape rather than splitting
 * into a union the hit test would have to branch on.
 */
export interface SceneObject {
  id: string;
  kind: SceneObjectKind;
  /** The JARVIS entity behind it, for rendering and for reporting back. */
  type: HoloObjectType;
  label: string;
  /** Where it is now — moved by drags, throws and settling. */
  position: Vec3;
  /** Where layout wants it. An object eases back to this unless it is held or flying. */
  home: Vec3;
  /** World units per second. Non-zero only after a throw. */
  velocity: Vec3;
  radius: number;
  /** Presentation scale, driven by focus, holding and proximity. 1 is at rest. */
  scale: number;
  /** Radians about the view axis. Flicks impart spin to props. */
  rotation: number;
  /** Radians per second; decays with the same damping as velocity. */
  spin: number;
  /** Whatever the source entity carried that the deck did not model — id, status,
   *  path, tags. Never interpreted here; passed through for the UI and reports. */
  metadata?: Record<string, unknown>;
  /** Cards carry the note body so opening one needs no second fetch. */
  body?: string;
  /** Cards only: the orb they belong to. */
  parentId?: string;
  /** Orbs only: whether its cards are fanned out. */
  open: boolean;
  /** Cards only: hidden until their orb is opened. */
  visible: boolean;
  /** The hand currently holding it, if any. */
  heldBy: Handedness | null;
  /** True while the object is coasting from a throw. */
  flying: boolean;
}

/** Where the viewer is. Driven entirely by the two-hand grip. */
export interface SceneCamera {
  zoom: number;
  pan: { x: number; y: number };
  rotation: number;
}

/** Everything the renderer needs for one frame, and nothing it does not. */
export interface SceneState {
  objects: SceneObject[];
  camera: SceneCamera;
  /** Layout the objects are currently arranged by. */
  layout: SceneLayout;
  /** World position of the interaction cursor, or null when no hand is present. */
  cursor: Vec3 | null;
  /** Object under the cursor. */
  hoverId: string | null;
  /** Card promoted to the reading position. */
  focusId: string | null;
  /** Object last selected by a tap — highlighted, but not expanded. */
  selectedId: string | null;
}

/** How objects are arranged. `ring` is the default orbit; `grid` is the organized
 *  workspace. Layout changes move homes, never positions. */
export type SceneLayout = 'ring' | 'grid';

/**
 * What happened this frame. The deck forwards these to /api/holo/state so JARVIS
 * sees the interaction; nothing in the engine knows that endpoint exists.
 */
export type SceneEventKind =
  | 'grab'
  | 'release'
  | 'throw'
  | 'orb-open'
  | 'orb-close'
  | 'card-focus'
  | 'card-blur'
  | 'organize'
  | 'select'
  | 'reset';

export interface SceneEvent {
  kind: SceneEventKind;
  /** Label of the object involved, when there is one. */
  card?: string;
}

export const IDLE_CAMERA: SceneCamera = { zoom: 1, pan: { x: 0, y: 0 }, rotation: 0 };
