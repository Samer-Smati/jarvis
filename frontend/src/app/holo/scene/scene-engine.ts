import { GestureKind, Phase, primaryGesture, type GestureFrame, type HandGesture } from '../gestures/gesture.types';
import { HOLO_DEFAULT_CONFIG, type HoloConfig } from '../holo.config';
import type { Handedness } from '../types/holo.types';
import { gridPositions } from './grid.layout';
import { proximityResponse } from './proximity';
import {
  clamp,
  cursorToWorld,
  distanceXY,
  easeTowards,
  projectedRadius,
  ringPosition,
} from './scene.math';
import {
  IDLE_CAMERA,
  type HoloObjectType,
  type SceneCamera,
  type SceneEvent,
  type SceneLayout,
  type SceneObject,
  type SceneState,
  type Vec3,
} from './scene.types';

/** One entity the deck can show. Produced by the adapter, never by the engine. */
export interface SceneItem {
  id: string;
  title: string;
  body: string;
  type: HoloObjectType;
  metadata?: Record<string, unknown>;
}

/** A container orb and what it holds. */
export interface SceneGroup {
  name: string;
  type: HoloObjectType;
  items: SceneItem[];
}

/** What one hand is holding, and where it took hold. */
interface Grip {
  objectId: string;
  /** Offset from cursor to object centre at grab time, so it does not snap to the palm. */
  offset: Vec3;
}

/** Two candidates this close in relative distance count as overlapping, and depth
 *  decides between them. Wide enough to swallow the float noise that ring layout
 *  leaves in an object's z. */
const PICK_EPSILON = 1e-3;

/** Decorative props, laid out behind the ring. They exist to be grabbed, thrown
 *  and spun — nothing in JARVIS depends on them. */
const PROPS: Array<{ id: string; label: string }> = [
  { id: 'prop:module', label: 'MODULE' },
  { id: 'prop:relic', label: 'RELIC' },
];

/**
 * Turns gesture frames into a manipulable scene.
 *
 * It is pure in the way phase 2 is pure: no three.js, no Angular, no HTTP. Feed
 * it GestureFrames and a delta, read `state`, forward the events. That is what
 * lets the whole interaction model be tested with synthetic hands and no webcam —
 * and, since the pointer fallback synthesizes the same frames, what lets mouse
 * and hands share one interaction path instead of two.
 *
 * Four rules it exists to enforce:
 *
 *   1. A grip is keyed by handedness and released on every path out of it —
 *      END, a two-hand grip taking over, or the hand leaving frame. An object
 *      welded to a hand that is gone is the one failure the user cannot undo.
 *   2. The hit test uses the same projection the renderer draws with, so what
 *      looks grabbable is grabbable.
 *   3. Layout is declarative: every object has a `home` and eases towards it.
 *      Opening an orb or organizing the deck moves homes, never positions, so an
 *      interrupted animation cannot leave a card stranded.
 *   4. Every effect is optional. With effects, proximity and physics switched
 *      off, each interaction still completes — they only change how it looks.
 */
export class SceneEngine {
  private readonly grips = new Map<Handedness, Grip>();
  private objects: SceneObject[] = [];
  private camera: SceneCamera = { ...IDLE_CAMERA, pan: { ...IDLE_CAMERA.pan } };
  private cameraOrigin: SceneCamera = { ...IDLE_CAMERA, pan: { ...IDLE_CAMERA.pan } };
  private cursor: Vec3 | null = null;
  private hoverId: string | null = null;
  private focusId: string | null = null;
  private selectedId: string | null = null;
  private layoutMode: SceneLayout = 'ring';
  private organizeArmed = true;

  constructor(private config: HoloConfig = HOLO_DEFAULT_CONFIG) {}

  get state(): SceneState {
    return {
      objects: this.objects,
      camera: this.camera,
      layout: this.layoutMode,
      cursor: this.cursor,
      hoverId: this.hoverId,
      focusId: this.focusId,
      selectedId: this.selectedId,
    };
  }

  /** Swap configuration live — the effects panel toggles these while the deck runs. */
  configure(config: HoloConfig): void {
    this.config = config;
    this.layout();
  }

  /** Build the deck from adapted JARVIS entities. Safe to call again; it replaces
   *  everything, which is what a new `SHOW_…` command needs. */
  load(groups: SceneGroup[]): void {
    const cfg = this.config.scene;
    this.objects = [];
    this.grips.clear();
    this.focusId = null;
    this.selectedId = null;
    this.hoverId = null;
    this.layoutMode = 'ring';

    groups.forEach((group, index) => {
      const home = ringPosition(index, groups.length, cfg.ringRadius, cfg.depthSpread);
      const orbId = `orb:${group.name}`;
      this.objects.push(this.make(orbId, 'orb', 'folder', group.name, home, cfg.orbRadius));

      for (const item of group.items) {
        const card = this.make(
          `card:${group.name}:${item.id}`,
          'card',
          item.type,
          item.title,
          home,
          cfg.cardRadius,
        );
        card.body = item.body;
        card.metadata = item.metadata;
        card.parentId = orbId;
        card.visible = false;
        this.objects.push(card);
      }
    });

    if (this.config.effects.propsEnabled) {
      PROPS.forEach((prop, index) => {
        const home = {
          x: index === 0 ? -cfg.halfWidth * 0.62 : cfg.halfWidth * 0.62,
          y: -cfg.halfHeight * 0.55,
          z: -cfg.depthSpread * 0.4,
        };
        this.objects.push(this.make(prop.id, 'prop', 'prop', prop.label, home, cfg.orbRadius * 0.8));
      });
    }

    this.layout();
  }

  /** Drop all interaction state and restore the default arrangement. No data is
   *  destroyed — this is a layout reset, nothing more. */
  reset(): SceneEvent[] {
    this.grips.clear();
    this.camera = { ...IDLE_CAMERA, pan: { ...IDLE_CAMERA.pan } };
    this.cameraOrigin = { ...IDLE_CAMERA, pan: { ...IDLE_CAMERA.pan } };
    this.focusId = null;
    this.selectedId = null;
    this.hoverId = null;
    this.layoutMode = 'ring';
    for (const object of this.objects) {
      object.heldBy = null;
      object.flying = false;
      object.velocity = { x: 0, y: 0, z: 0 };
      object.spin = 0;
      object.rotation = 0;
      object.scale = 1;
      if (object.kind === 'orb') {
        object.open = false;
      }
    }
    this.layout();
    return [{ kind: 'reset' }];
  }

  /**
   * Direct camera intents, for the pointer fallback and the on-screen controls.
   * Hands drive the camera through the two-hand grip instead; a wheel notch is
   * not a bimanual pinch, and faking one would also fake its grip release.
   */
  zoomBy(factor: number): void {
    const { minZoom, maxZoom } = this.config.twoHand;
    this.camera = { ...this.camera, zoom: clamp(this.camera.zoom * factor, minZoom, maxZoom) };
    this.cameraOrigin = { ...this.camera, pan: { ...this.camera.pan } };
  }

  panBy(x: number, y: number): void {
    this.camera = { ...this.camera, pan: { x: this.camera.pan.x + x, y: this.camera.pan.y + y } };
    this.cameraOrigin = { ...this.camera, pan: { ...this.camera.pan } };
  }

  rotateBy(radians: number): void {
    this.camera = { ...this.camera, rotation: this.camera.rotation + radians };
    this.cameraOrigin = { ...this.camera, pan: { ...this.camera.pan } };
  }

  /** Put an expanded card back without touching anything else. */
  collapse(): SceneEvent[] {
    if (!this.focusId) {
      return [];
    }
    const card = this.byId(this.focusId);
    this.focusId = null;
    this.layout();
    return [{ kind: 'card-blur', card: card?.label }];
  }

  /** Arrange every visible object into a responsive grid. */
  organize(): SceneEvent[] {
    this.layoutMode = 'grid';
    this.layout();
    return [{ kind: 'organize' }];
  }

  /**
   * Advance animation without interpreting any input.
   *
   * The detector runs at ~30Hz while the deck renders at display rate, so most
   * frames carry no new hand data. Feeding those to `update` as an empty frame
   * would be read as every hand having left — releasing whatever is held, twice
   * a second, for the entire duration of a drag. Physics and easing still need
   * to advance on those frames, and that is all this does.
   */
  advance(dtMs: number): void {
    const dt = clamp(dtMs, 0, 100) / 1000;
    this.integrate(dt);
    this.updateHover();
  }

  /**
   * Advance one frame. `dtMs` is wall time since the last call; it is clamped
   * because a backgrounded tab returns with a delta of several seconds, which
   * would teleport every thrown object straight out of the scene.
   */
  update(frame: GestureFrame, dtMs: number): SceneEvent[] {
    const dt = clamp(dtMs, 0, 100) / 1000;
    const events: SceneEvent[] = [];

    if (frame.peace) {
      return this.reset();
    }

    this.updateCamera(frame, events);
    this.updateCursor(frame);
    this.updateHands(frame, events);
    this.integrate(dt);
    this.updateHover();

    return events;
  }

  // ---------------------------------------------------------------- two hands

  private updateCamera(frame: GestureFrame, events: SceneEvent[]): void {
    const two = frame.twoHand;
    if (!two.active) {
      // Re-arm so the next bimanual fist organizes again, rather than one long
      // grip re-triggering it every frame.
      this.organizeArmed = true;
      return;
    }

    if (two.started) {
      // The gesture engine blanks per-hand intent while both hands grip, so no
      // END will ever arrive for whatever they were holding. Release here or the
      // object stays welded to a hand that has stopped reporting.
      for (const handedness of [...this.grips.keys()]) {
        const released = this.releaseGrip(handedness);
        if (released) {
          events.push({ kind: 'release', card: released.label });
        }
      }
      this.cameraOrigin = { zoom: this.camera.zoom, pan: { ...this.camera.pan }, rotation: this.camera.rotation };
    }

    // Both fists organize; both pinches manipulate the scene. A mixed grip does
    // neither, so a hand caught mid-transition cannot reshuffle the workspace.
    if (two.kind === GestureKind.GRAB) {
      if (this.organizeArmed) {
        this.organizeArmed = false;
        events.push(...this.organize());
      }
      return;
    }
    if (two.kind !== GestureKind.PINCH) {
      return;
    }

    const cfg = this.config;
    const origin = this.cameraOrigin;
    this.camera = {
      zoom: clamp(origin.zoom * two.scale, cfg.twoHand.minZoom, cfg.twoHand.maxZoom),
      // Translation is normalized screen travel; the plane it pans is in world units.
      pan: {
        x: origin.pan.x + two.translation.x * cfg.scene.halfWidth * 2,
        y: origin.pan.y - two.translation.y * cfg.scene.halfHeight * 2,
      },
      rotation: origin.rotation + two.rotation,
    };
  }

  // ------------------------------------------------------------------- cursor

  private updateCursor(frame: GestureFrame): void {
    const primary = primaryGesture(frame);
    if (!primary || primary.kind === GestureKind.NONE) {
      this.cursor = frame.twoHand.active ? this.cursor : null;
      return;
    }
    this.cursor = cursorToWorld(primary.position, this.camera, this.config);
  }

  // -------------------------------------------------------------------- hands

  private updateHands(frame: GestureFrame, events: SceneEvent[]): void {
    const seen = new Set<Handedness>();

    for (const gesture of frame.hands) {
      seen.add(gesture.hand);
      const cursor = cursorToWorld(gesture.position, this.camera, this.config);

      if (gesture.phase === Phase.START && SceneEngine.engages(gesture.kind)) {
        this.tryGrab(gesture, cursor, events);
        continue;
      }

      if (gesture.phase === Phase.END) {
        this.handleRelease(gesture, frame, events);
        continue;
      }

      if (SceneEngine.engages(gesture.kind)) {
        this.dragHeld(gesture.hand, cursor);
      }
    }

    // A hand that stopped being reported without an END — the gesture engine
    // emits one on tracking loss, but a frame can still drop it mid-flight.
    for (const handedness of [...this.grips.keys()]) {
      if (seen.has(handedness)) {
        continue;
      }
      const released = this.releaseGrip(handedness);
      if (released) {
        events.push({ kind: 'release', card: released.label });
      }
    }
  }

  private tryGrab(gesture: HandGesture, cursor: Vec3, events: SceneEvent[]): void {
    const target = this.pickAt(cursor);
    if (!target) {
      return;
    }
    // One object, one hand: the second hand would otherwise fight the first for it.
    if (target.heldBy && target.heldBy !== gesture.hand) {
      return;
    }

    target.heldBy = gesture.hand;
    target.flying = false;
    target.velocity = { x: 0, y: 0, z: 0 };
    this.grips.set(gesture.hand, {
      objectId: target.id,
      offset: {
        x: target.position.x - cursor.x,
        y: target.position.y - cursor.y,
        z: target.position.z,
      },
    });
    events.push({ kind: 'grab', card: target.label });
  }

  private dragHeld(hand: Handedness, cursor: Vec3): void {
    const grip = this.grips.get(hand);
    if (!grip) {
      return;
    }
    const object = this.byId(grip.objectId);
    if (!object) {
      this.grips.delete(hand);
      return;
    }
    object.position = {
      x: cursor.x + grip.offset.x,
      y: cursor.y + grip.offset.y,
      z: grip.offset.z,
    };
  }

  private handleRelease(gesture: HandGesture, frame: GestureFrame, events: SceneEvent[]): void {
    const grip = this.grips.get(gesture.hand);
    const object = grip ? this.byId(grip.objectId) : null;
    this.grips.delete(gesture.hand);

    if (object) {
      object.heldBy = null;
    }

    // A tap is the gesture engine's own verdict — short, and the palm stayed put.
    if (gesture.tap) {
      const tapped = object ?? this.pickAt(cursorToWorld(gesture.position, this.camera, this.config));
      if (tapped) {
        this.activate(tapped, gesture.double, events);
      }
      return;
    }

    if (!object) {
      return;
    }

    const flick = frame.flicks.find((f) => f.hand === gesture.hand);
    if (flick && this.config.effects.physicsEnabled) {
      const scale = this.config.scene.throwScale;
      object.velocity = { x: flick.velocity.x * scale, y: -flick.velocity.y * scale, z: 0 };
      // Spin comes from the throw's sideways component, so a flat toss tumbles
      // and a straight push does not.
      object.spin = flick.velocity.x * 2.4;
      object.flying = true;
      events.push({ kind: 'throw', card: object.label });
      return;
    }

    events.push({ kind: 'release', card: object.label });
  }

  /**
   * What a tap means depends on what was tapped, and on whether it was doubled.
   *
   * A single pinch selects — it is the cheap, frequent gesture and must not
   * rearrange anything. Expanding a card is deliberate, so it takes the double
   * pinch, which the gesture engine only reports inside its own timing window.
   */
  private activate(object: SceneObject, double: boolean, events: SceneEvent[]): void {
    if (object.kind === 'orb') {
      object.open = !object.open;
      // Collapsing an orb must also drop focus, or a card stays in the reading
      // position with nothing behind it.
      if (!object.open && this.focusId && this.byId(this.focusId)?.parentId === object.id) {
        this.focusId = null;
        events.push({ kind: 'card-blur' });
      }
      events.push({ kind: object.open ? 'orb-open' : 'orb-close', card: object.label });
      this.layout();
      return;
    }

    // Tapping the expanded card again puts it back.
    if (this.focusId === object.id) {
      this.focusId = null;
      events.push({ kind: 'card-blur', card: object.label });
      this.layout();
      return;
    }

    if (double) {
      this.focusId = object.id;
      this.selectedId = object.id;
      events.push({ kind: 'card-focus', card: object.label });
      this.layout();
      return;
    }

    this.selectedId = object.id;
    events.push({ kind: 'select', card: object.label });
  }

  private releaseGrip(hand: Handedness): SceneObject | null {
    const grip = this.grips.get(hand);
    this.grips.delete(hand);
    if (!grip) {
      return null;
    }
    const object = this.byId(grip.objectId);
    if (!object) {
      return null;
    }
    object.heldBy = null;
    return object;
  }

  // ------------------------------------------------------------------ physics

  private integrate(dt: number): void {
    const cfg = this.config.scene;
    const effects = this.config.effects;
    const eased = dt * Math.max(effects.animationSpeed, 0.05);
    const bound = { x: cfg.halfWidth * 1.6, y: cfg.halfHeight * 1.6 };

    for (const object of this.objects) {
      if (object.heldBy) {
        object.scale = easeTowards(object.scale, 1.12, cfg.settleSeconds, eased);
        continue;
      }

      if (object.flying) {
        object.position = {
          x: object.position.x + object.velocity.x * dt,
          y: object.position.y + object.velocity.y * dt,
          z: object.position.z + object.velocity.z * dt,
        };
        object.rotation += object.spin * dt;
        // Exponential decay, so damping means the same thing at any frame rate.
        const retained = Math.pow(cfg.damping, dt);
        object.velocity = {
          x: object.velocity.x * retained,
          y: object.velocity.y * retained,
          z: object.velocity.z * retained,
        };
        object.spin *= retained;

        const speed = Math.hypot(object.velocity.x, object.velocity.y, object.velocity.z);
        const escaped = Math.abs(object.position.x) > bound.x || Math.abs(object.position.y) > bound.y;
        if (speed < cfg.restSpeed || escaped) {
          // A thrown object always stays recoverable: past the soft boundary it
          // stops dead rather than continuing out of reach.
          object.flying = false;
          object.velocity = { x: 0, y: 0, z: 0 };
          object.spin = 0;
          object.position = {
            x: clamp(object.position.x, -bound.x, bound.x),
            y: clamp(object.position.y, -bound.y, bound.y),
            z: object.position.z,
          };
        }
        continue;
      }

      const near =
        effects.effectsEnabled && effects.proximityEnabled
          ? proximityResponse(object, this.cursor, this.config)
          : { offset: { x: 0, y: 0, z: 0 }, scale: 1, strength: 0 };

      const focused = this.focusId === object.id;
      const target = {
        x: object.home.x + near.offset.x,
        y: object.home.y + near.offset.y,
        z: object.home.z + near.offset.z,
      };

      object.position = {
        x: easeTowards(object.position.x, target.x, cfg.settleSeconds, eased),
        y: easeTowards(object.position.y, target.y, cfg.settleSeconds, eased),
        z: easeTowards(object.position.z, target.z, cfg.settleSeconds, eased),
      };
      object.scale = easeTowards(object.scale, focused ? 1.5 : near.scale, cfg.settleSeconds, eased);
      object.rotation = easeTowards(object.rotation, 0, cfg.settleSeconds * 3, eased);
    }
  }

  // ------------------------------------------------------------------- layout

  /** Recompute every `home`. Positions are never set here — objects ease to them. */
  private layout(): void {
    if (this.layoutMode === 'grid') {
      this.layoutGrid();
    } else {
      this.layoutRing();
    }

    if (this.focusId) {
      const focused = this.byId(this.focusId);
      if (focused) {
        // Front and centre, in front of everything else.
        focused.visible = true;
        focused.home = { x: 0, y: 0, z: this.config.scene.depthSpread };
      }
    }
  }

  private layoutRing(): void {
    const cfg = this.config.scene;
    const orbs = this.objects.filter((o) => o.kind === 'orb');

    orbs.forEach((orb, index) => {
      orb.home = ringPosition(index, orbs.length, cfg.ringRadius, cfg.depthSpread);

      const cards = this.objects.filter((o) => o.parentId === orb.id);
      cards.forEach((card, cardIndex) => {
        card.visible = orb.open;
        if (!orb.open) {
          // Tucked inside the orb, so closing reads as the cards folding back in.
          card.home = { ...orb.home };
          return;
        }
        const angle = cards.length <= 1 ? 0 : (cardIndex / cards.length) * Math.PI * 2;
        card.home = {
          x: orb.home.x + Math.cos(angle) * cfg.fanRadius,
          y: orb.home.y + Math.sin(angle) * cfg.fanRadius * 0.6,
          z: orb.home.z + Math.sin(angle) * 0.4,
        };
      });
    });
  }

  /** Everything currently on show, laid out in reading order. */
  private layoutGrid(): void {
    const visible = this.objects.filter((o) => o.visible);
    const radius = visible.reduce((max, o) => Math.max(max, o.radius), this.config.scene.cardRadius);
    const cells = gridPositions(visible.length, radius, this.config);
    visible.forEach((object, index) => {
      object.home = cells[index] ?? { x: 0, y: 0, z: 0 };
    });
  }

  // -------------------------------------------------------------------- picks

  /**
   * Nearest object whose drawn silhouette contains the cursor.
   *
   * Depth is excluded from the distance and folded into the radius instead: the
   * cursor lives on the z = 0 plane, so a true 3D distance would make every
   * object on the far side of the ring unreachable no matter how precisely the
   * user pointed at it.
   *
   * Candidates are ranked by how centred the cursor is *relative to their own
   * reach*, not by raw distance, so a small card and a large orb compete fairly.
   * Depth only breaks a genuine tie. Ranking by depth alone — the obvious first
   * cut — decides overlapping picks by floating-point noise: an orb's cards sit
   * exactly on top of it for the first frames after it opens, and `sin(Math.PI)`
   * leaves one of them a z of 1e-16, which is enough to steal every tap meant
   * for the orb underneath.
   */
  private pickAt(cursor: Vec3 | null): SceneObject | null {
    if (!cursor) {
      return null;
    }
    const cfg = this.config.scene;
    let best: SceneObject | null = null;
    let bestScore = Infinity;
    let bestDepth = -Infinity;

    for (const object of this.objects) {
      if (!object.visible) {
        continue;
      }
      const reach =
        projectedRadius(object.radius * object.scale, object.position.z, cfg.focal) + cfg.grabTolerance;
      const distance = distanceXY(cursor, object.position);
      if (distance > reach) {
        continue;
      }

      const score = distance / reach;
      const closer = score < bestScore - PICK_EPSILON;
      const tied = Math.abs(score - bestScore) <= PICK_EPSILON;
      if (closer || (tied && object.position.z > bestDepth)) {
        best = object;
        bestScore = score;
        bestDepth = object.position.z;
      }
    }
    return best;
  }

  private updateHover(): void {
    this.hoverId = this.pickAt(this.cursor)?.id ?? null;
  }

  private byId(id: string): SceneObject | null {
    return this.objects.find((o) => o.id === id) ?? null;
  }

  private make(
    id: string,
    kind: SceneObject['kind'],
    type: HoloObjectType,
    label: string,
    home: Vec3,
    radius: number,
  ): SceneObject {
    return {
      id,
      kind,
      type,
      label,
      position: { ...home },
      home: { ...home },
      velocity: { x: 0, y: 0, z: 0 },
      radius,
      scale: 1,
      rotation: 0,
      spin: 0,
      open: false,
      visible: true,
      heldBy: null,
      flying: false,
    };
  }

  private static engages(kind: GestureKind): boolean {
    return kind === GestureKind.PINCH || kind === GestureKind.GRAB;
  }
}
