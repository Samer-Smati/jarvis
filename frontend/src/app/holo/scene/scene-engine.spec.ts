import { GestureKind, IDLE_TWO_HAND, Phase, type GestureFrame, type HandGesture } from '../gestures/gesture.types';
import { HOLO_DEFAULT_CONFIG, type HoloConfig } from '../holo.config';
import type { Handedness } from '../types/holo.types';
import { SceneEngine, type SceneGroup } from './scene-engine';
import { cursorToWorld } from './scene.math';
import type { SceneEvent, SceneObject } from './scene.types';

const cfg = HOLO_DEFAULT_CONFIG;

const GROUPS: SceneGroup[] = [
  {
    name: 'projects',
    type: 'folder',
    items: [
      { id: 'a', title: 'Alpha', body: 'alpha body', type: 'project', metadata: { status: 'active' } },
      { id: 'b', title: 'Beta', body: 'beta body', type: 'project' },
    ],
  },
  { name: 'journal', type: 'folder', items: [{ id: 'c', title: 'Gamma', body: 'gamma body', type: 'note' }] },
];

/** Screen position (0..1) that lands on an object, inverting the cursor mapping. */
function aimAt(object: SceneObject): { x: number; y: number } {
  return {
    x: object.position.x / (2 * cfg.scene.halfWidth) + 0.5,
    y: 0.5 - object.position.y / (2 * cfg.scene.halfHeight),
  };
}

function gesture(partial: Partial<HandGesture> = {}): HandGesture {
  return {
    kind: GestureKind.PINCH,
    phase: Phase.HOLD,
    confidence: 0.9,
    hand: 'right' as Handedness,
    position: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    pinchDistance: 0.2,
    tap: false,
    double: false,
    ...partial,
  };
}

function frameOf(hands: HandGesture[], extra: Partial<GestureFrame> = {}): GestureFrame {
  return { hands, twoHand: { ...IDLE_TWO_HAND }, flicks: [], peace: false, timestamp: 0, ...extra };
}

const kinds = (events: SceneEvent[]) => events.map((e) => e.kind);

/** Config with the decorative props off, so counts in tests are about real data. */
const bare = (over: Partial<HoloConfig['effects']> = {}): HoloConfig => ({
  ...cfg,
  effects: { ...cfg.effects, propsEnabled: false, ...over },
});

describe('SceneEngine', () => {
  let engine: SceneEngine;
  let orb: SceneObject;

  const settle = (frames = 40) => {
    for (let i = 0; i < frames; i++) {
      engine.update(frameOf([]), 16);
    }
  };

  beforeEach(() => {
    engine = new SceneEngine(bare());
    engine.load(GROUPS);
    orb = engine.state.objects.find((o) => o.id === 'orb:projects')!;
  });

  describe('building the deck', () => {
    it('builds an orb per group and a hidden card per item', () => {
      const objects = engine.state.objects;
      expect(objects.filter((o) => o.kind === 'orb').length).toBe(2);
      expect(objects.filter((o) => o.kind === 'card').length).toBe(3);
      expect(objects.filter((o) => o.kind === 'card').every((c) => !c.visible)).toBe(true);
    });

    it('carries the entity type and metadata onto the card', () => {
      const card = engine.state.objects.find((o) => o.id === 'card:projects:a')!;
      expect(card.type).toBe('project');
      expect(card.metadata).toEqual({ status: 'active' });
    });

    it('adds decorative props only when they are enabled', () => {
      expect(engine.state.objects.some((o) => o.kind === 'prop')).toBe(false);

      const withProps = new SceneEngine(cfg);
      withProps.load(GROUPS);
      expect(withProps.state.objects.some((o) => o.kind === 'prop')).toBe(true);
    });

    it('replaces the deck on reload, so a new source cannot leave stale orbs', () => {
      engine.load([{ name: 'tasks', type: 'folder', items: [{ id: 't', title: 'T', body: '', type: 'task' }] }]);
      expect(engine.state.objects.filter((o) => o.kind === 'orb').map((o) => o.label)).toEqual(['tasks']);
    });
  });

  describe('pointing and hovering', () => {
    it('hovers the orb the cursor is over, and nothing when hands leave', () => {
      engine.update(frameOf([gesture({ kind: GestureKind.POINT, position: aimAt(orb) })]), 16);
      expect(engine.state.hoverId).toBe(orb.id);

      engine.update(frameOf([]), 16);
      expect(engine.state.hoverId).toBeNull();
      expect(engine.state.cursor).toBeNull();
    });

    it('never picks a card that is still tucked inside a closed orb', () => {
      const card = engine.state.objects.find((o) => o.parentId === orb.id)!;
      engine.update(frameOf([gesture({ kind: GestureKind.POINT, position: aimAt(card) })]), 16);
      expect(engine.state.hoverId).toBe(orb.id);
    });

    it('prefers the object the cursor is centred on over an overlapping neighbour', () => {
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      settle();
      const card = engine.state.objects.find((o) => o.parentId === orb.id)!;
      engine.update(frameOf([gesture({ kind: GestureKind.POINT, position: aimAt(card) })]), 16);
      expect(engine.state.hoverId).toBe(card.id);

      engine.update(frameOf([gesture({ kind: GestureKind.POINT, position: aimAt(orb) })]), 16);
      expect(engine.state.hoverId).toBe(orb.id);
    });
  });

  describe('grabbing and dragging', () => {
    it('grabs on pinch START and drags the orb with the hand', () => {
      const events = engine.update(frameOf([gesture({ phase: Phase.START, position: aimAt(orb) })]), 16);
      expect(kinds(events)).toContain('grab');
      expect(orb.heldBy).toBe('right');

      engine.update(frameOf([gesture({ position: { x: 0.8, y: 0.3 } })]), 16);
      const expected = cursorToWorld({ x: 0.8, y: 0.3 }, engine.state.camera, cfg);
      expect(orb.position.x).toBeCloseTo(expected.x, 2);
      expect(orb.position.y).toBeCloseTo(expected.y, 2);
    });

    it('does not let a second hand steal a held object', () => {
      engine.update(frameOf([gesture({ phase: Phase.START, position: aimAt(orb) })]), 16);
      // The right hand must stay in frame: a hand that stops being reported is a
      // release, which would end the grip before the left hand ever contests it.
      const events = engine.update(
        frameOf([
          gesture({ position: aimAt(orb) }),
          gesture({ hand: 'left', phase: Phase.START, position: aimAt(orb) }),
        ]),
        16,
      );
      expect(kinds(events)).not.toContain('grab');
      expect(orb.heldBy).toBe('right');
    });

    it('releases without a flick, leaving the object where it was let go', () => {
      engine.update(frameOf([gesture({ phase: Phase.START, position: aimAt(orb) })]), 16);
      const events = engine.update(frameOf([gesture({ phase: Phase.END, position: aimAt(orb) })]), 16);
      expect(kinds(events)).toContain('release');
      expect(orb.heldBy).toBeNull();
      expect(orb.flying).toBe(false);
    });

    it('keeps holding across frames that carry no new detection', () => {
      // The detector runs at ~30Hz and the deck at display rate. Treating a
      // frame with no new hand data as "the hands left" would release whatever
      // is held twice a second, for the whole of every drag.
      engine.update(frameOf([gesture({ phase: Phase.START, position: aimAt(orb) })]), 16);
      expect(orb.heldBy).toBe('right');

      for (let i = 0; i < 10; i++) {
        engine.advance(16);
      }
      expect(orb.heldBy).toBe('right');
    });

    it('advance() still settles a thrown object', () => {
      engine.update(frameOf([gesture({ phase: Phase.START, position: aimAt(orb) })]), 16);
      engine.update(
        frameOf([gesture({ phase: Phase.END, position: aimAt(orb) })], {
          flicks: [{ hand: 'right', position: aimAt(orb), velocity: { x: 1.5, y: 0 }, speed: 1.5 }],
        }),
        16,
      );
      for (let i = 0; i < 240; i++) {
        engine.advance(16);
      }
      expect(orb.flying).toBe(false);
    });

    it('releases a held object when its hand leaves frame', () => {
      engine.update(frameOf([gesture({ phase: Phase.START, position: aimAt(orb) })]), 16);
      const events = engine.update(frameOf([]), 16);
      expect(kinds(events)).toContain('release');
      expect(orb.heldBy).toBeNull();
    });

    it('ignores a grab aimed at empty space', () => {
      const events = engine.update(frameOf([gesture({ phase: Phase.START, position: { x: 0.02, y: 0.98 } })]), 16);
      expect(kinds(events)).not.toContain('grab');
    });
  });

  describe('selecting and expanding', () => {
    it('a single tap selects without expanding anything', () => {
      const events = engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      settle();
      const card = engine.state.objects.find((o) => o.parentId === orb.id)!;
      void events;

      const tap = engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(card) })]), 16);
      expect(kinds(tap)).toContain('select');
      expect(engine.state.selectedId).toBe(card.id);
      expect(engine.state.focusId).toBeNull();
    });

    it('a double pinch expands the card', () => {
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      settle();
      const card = engine.state.objects.find((o) => o.parentId === orb.id)!;

      const events = engine.update(
        frameOf([gesture({ phase: Phase.END, tap: true, double: true, position: aimAt(card) })]),
        16,
      );
      expect(kinds(events)).toContain('card-focus');
      expect(engine.state.focusId).toBe(card.id);
    });

    it('tapping an expanded card puts it back', () => {
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      settle();
      const card = engine.state.objects.find((o) => o.parentId === orb.id)!;
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, double: true, position: aimAt(card) })]), 16);
      settle();

      const events = engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(card) })]), 16);
      expect(kinds(events)).toContain('card-blur');
      expect(engine.state.focusId).toBeNull();
    });

    it('collapse() puts an expanded card back without touching anything else', () => {
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      settle();
      const card = engine.state.objects.find((o) => o.parentId === orb.id)!;
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, double: true, position: aimAt(card) })]), 16);

      expect(kinds(engine.collapse())).toContain('card-blur');
      expect(engine.state.focusId).toBeNull();
      expect(orb.open).toBe(true);
    });

    it('opens an orb on tap and fans its cards out', () => {
      const events = engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      expect(kinds(events)).toContain('orb-open');

      const cards = engine.state.objects.filter((o) => o.parentId === orb.id);
      expect(cards.every((c) => c.visible)).toBe(true);
      expect(cards.every((c) => Math.hypot(c.home.x - orb.home.x, c.home.y - orb.home.y) > 0.5)).toBe(true);
    });

    it('closes an orb tapped twice in a row, while its cards still sit on top of it', () => {
      // The frame after an orb opens, its cards have not eased out yet and overlap
      // it exactly. Ranking candidates by depth alone hands the tap to whichever
      // card floating-point noise put marginally nearest the camera.
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      const events = engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      expect(kinds(events)).toContain('orb-close');
      expect(engine.state.objects.filter((o) => o.parentId === orb.id).every((c) => !c.visible)).toBe(true);
    });

    it('collapsing an orb drops focus on a card that belonged to it', () => {
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      settle();
      const card = engine.state.objects.find((o) => o.parentId === orb.id)!;
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, double: true, position: aimAt(card) })]), 16);
      expect(engine.state.focusId).toBe(card.id);

      const events = engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      expect(kinds(events)).toContain('card-blur');
      expect(engine.state.focusId).toBeNull();
    });
  });

  describe('throwing', () => {
    const throwOrb = (speed = 1.5) => {
      engine.update(frameOf([gesture({ phase: Phase.START, position: aimAt(orb) })]), 16);
      return engine.update(
        frameOf([gesture({ phase: Phase.END, position: aimAt(orb) })], {
          flicks: [{ hand: 'right', position: aimAt(orb), velocity: { x: speed, y: 0 }, speed }],
        }),
        16,
      );
    };

    it('throws a held object when the release carries a flick', () => {
      expect(kinds(throwOrb())).toContain('throw');
      expect(orb.flying).toBe(true);
      expect(orb.velocity.x).toBeGreaterThan(0);
    });

    it('a thrown object slows down and comes to rest', () => {
      throwOrb();
      settle(240);
      expect(orb.flying).toBe(false);
      expect(Math.hypot(orb.velocity.x, orb.velocity.y)).toBe(0);
    });

    it('keeps a thrown object recoverable inside the soft boundary', () => {
      throwOrb(40);
      settle(240);
      expect(Math.abs(orb.position.x)).toBeLessThanOrEqual(cfg.scene.halfWidth * 1.6 + 1e-6);
      expect(Math.abs(orb.position.y)).toBeLessThanOrEqual(cfg.scene.halfHeight * 1.6 + 1e-6);
    });

    it('a huge delta cannot teleport a thrown object out of the scene', () => {
      throwOrb();
      const before = orb.position.x;
      // A backgrounded tab returns with seconds of delta, not milliseconds.
      engine.update(frameOf([]), 9000);
      expect(orb.position.x - before).toBeLessThan(cfg.scene.halfWidth);
    });

    it('does not throw at all when physics is disabled', () => {
      engine = new SceneEngine(bare({ physicsEnabled: false }));
      engine.load(GROUPS);
      orb = engine.state.objects.find((o) => o.id === 'orb:projects')!;

      const events = throwOrb();
      expect(kinds(events)).toContain('release');
      expect(kinds(events)).not.toContain('throw');
      expect(orb.flying).toBe(false);
    });
  });

  describe('two-hand manipulation', () => {
    const grip = (over: Partial<GestureFrame['twoHand']> = {}) =>
      engine.update(
        frameOf([], {
          twoHand: { ...IDLE_TWO_HAND, active: true, kind: GestureKind.PINCH, scale: 1, ...over },
        }),
        16,
      );

    it('drives zoom, pan and rotation from a two-hand pinch', () => {
      grip({ started: true, scale: 1.5, rotation: 0.4, translation: { x: 0.1, y: 0 } });
      const camera = engine.state.camera;
      expect(camera.zoom).toBeCloseTo(1.5, 2);
      expect(camera.rotation).toBeCloseTo(0.4, 2);
      expect(camera.pan.x).toBeGreaterThan(0);
    });

    it('clamps zoom to the configured range', () => {
      grip({ started: true, scale: 99 });
      expect(engine.state.camera.zoom).toBeCloseTo(cfg.twoHand.maxZoom, 5);

      engine.update(frameOf([]), 16);
      grip({ started: true, scale: 0.0001 });
      expect(engine.state.camera.zoom).toBeGreaterThanOrEqual(cfg.twoHand.minZoom);
    });

    it('a two-hand grip releases whatever one hand was holding', () => {
      engine.update(frameOf([gesture({ phase: Phase.START, position: aimAt(orb) })]), 16);
      expect(orb.heldBy).toBe('right');

      const events = grip({ started: true, scale: 1.2 });
      expect(kinds(events)).toContain('release');
      expect(orb.heldBy).toBeNull();
    });

    it('zoom accumulates across successive grips rather than snapping back', () => {
      grip({ started: true, scale: 1.5 });
      grip({ scale: 1.5 });
      engine.update(frameOf([]), 16);
      grip({ started: true, scale: 1.4 });
      expect(engine.state.camera.zoom).toBeCloseTo(1.5 * 1.4, 2);
    });

    it('organizes into a grid on a two-fisted grip, once per grip', () => {
      const first = engine.update(
        frameOf([], { twoHand: { ...IDLE_TWO_HAND, active: true, started: true, kind: GestureKind.GRAB } }),
        16,
      );
      expect(kinds(first)).toContain('organize');
      expect(engine.state.layout).toBe('grid');

      const second = engine.update(
        frameOf([], { twoHand: { ...IDLE_TWO_HAND, active: true, kind: GestureKind.GRAB } }),
        16,
      );
      expect(kinds(second)).not.toContain('organize');
    });

    it('re-arms organize only after the grip is let go', () => {
      engine.update(
        frameOf([], { twoHand: { ...IDLE_TWO_HAND, active: true, started: true, kind: GestureKind.GRAB } }),
        16,
      );
      engine.update(frameOf([]), 16);
      const again = engine.update(
        frameOf([], { twoHand: { ...IDLE_TWO_HAND, active: true, started: true, kind: GestureKind.GRAB } }),
        16,
      );
      expect(kinds(again)).toContain('organize');
    });

    it('a mixed grip neither zooms nor organizes', () => {
      const events = engine.update(
        frameOf([], {
          twoHand: { ...IDLE_TWO_HAND, active: true, started: true, kind: GestureKind.NONE, scale: 2 },
        }),
        16,
      );
      expect(kinds(events)).not.toContain('organize');
      expect(engine.state.camera.zoom).toBe(1);
    });
  });

  describe('organize and reset', () => {
    it('lays visible objects out on a grid without overlapping them', () => {
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      engine.organize();
      settle(80);

      const visible = engine.state.objects.filter((o) => o.visible);
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const gap = Math.hypot(
            visible[i].home.x - visible[j].home.x,
            visible[i].home.y - visible[j].home.y,
          );
          expect(gap).toBeGreaterThan(0.01);
        }
      }
    });

    it('peace restores layout, zoom and open state without dropping data', () => {
      engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      engine.organize();
      engine.update(
        frameOf([], { twoHand: { ...IDLE_TWO_HAND, active: true, started: true, kind: GestureKind.PINCH, scale: 2 } }),
        16,
      );

      const before = engine.state.objects.length;
      const events = engine.update(frameOf([], { peace: true }), 16);

      expect(kinds(events)).toContain('reset');
      expect(engine.state.camera.zoom).toBe(1);
      expect(engine.state.layout).toBe('ring');
      expect(engine.state.objects.filter((o) => o.kind === 'orb').every((o) => !o.open)).toBe(true);
      expect(engine.state.objects.length).toBe(before);
    });
  });

  describe('camera intents', () => {
    it('zooms, pans and rotates directly for the pointer fallback', () => {
      engine.zoomBy(2);
      engine.panBy(1, -0.5);
      engine.rotateBy(0.3);

      expect(engine.state.camera.zoom).toBeCloseTo(2, 5);
      expect(engine.state.camera.pan).toEqual({ x: 1, y: -0.5 });
      expect(engine.state.camera.rotation).toBeCloseTo(0.3, 5);
    });

    it('a direct zoom is not undone by the next two-hand grip', () => {
      engine.zoomBy(2);
      engine.update(
        frameOf([], { twoHand: { ...IDLE_TWO_HAND, active: true, started: true, kind: GestureKind.PINCH, scale: 1.5 } }),
        16,
      );
      expect(engine.state.camera.zoom).toBeCloseTo(3, 2);
    });

    it('clamps a direct zoom to the configured range', () => {
      engine.zoomBy(1000);
      expect(engine.state.camera.zoom).toBeCloseTo(cfg.twoHand.maxZoom, 5);
    });
  });

  describe('proximity', () => {
    it('leans the nearest object towards an approaching hand', () => {
      const restingX = orb.home.x;
      const near = { x: aimAt(orb).x - 0.02, y: aimAt(orb).y };
      for (let i = 0; i < 30; i++) {
        engine.update(frameOf([gesture({ kind: GestureKind.POINT, position: near })]), 16);
      }
      expect(orb.position.x).not.toBeCloseTo(restingX, 3);
    });

    it('does not move anything when proximity is disabled', () => {
      engine = new SceneEngine(bare({ proximityEnabled: false }));
      engine.load(GROUPS);
      orb = engine.state.objects.find((o) => o.id === 'orb:projects')!;

      const near = { x: aimAt(orb).x - 0.02, y: aimAt(orb).y };
      for (let i = 0; i < 30; i++) {
        engine.update(frameOf([gesture({ kind: GestureKind.POINT, position: near })]), 16);
      }
      expect(orb.position.x).toBeCloseTo(orb.home.x, 3);
    });

    it('still selects normally with every effect switched off', () => {
      engine = new SceneEngine(bare({ effectsEnabled: false, proximityEnabled: false, physicsEnabled: false }));
      engine.load(GROUPS);
      orb = engine.state.objects.find((o) => o.id === 'orb:projects')!;

      const events = engine.update(frameOf([gesture({ phase: Phase.END, tap: true, position: aimAt(orb) })]), 16);
      expect(kinds(events)).toContain('orb-open');
    });
  });
});
