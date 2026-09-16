import { GestureKind, Phase } from '../gestures/gesture.types';
import { HOLO_DEFAULT_CONFIG } from '../holo.config';
import { PointerInput, type PointerCommand } from './pointer-input';

const cfg = HOLO_DEFAULT_CONFIG;
const W = 1000;
const H = 500;

describe('PointerInput', () => {
  let commands: PointerCommand[];
  let pointer: PointerInput;

  beforeEach(() => {
    commands = [];
    pointer = new PointerInput(cfg, (command) => commands.push(command));
  });

  const moveTo = (x: number, y: number, at: number) => pointer.move(x, y, W, H, at);

  it('emits no hands until the pointer is used', () => {
    expect(pointer.frame(0).hands).toEqual([]);
    expect(pointer.engaged).toBe(false);
  });

  it('normalizes the pointer into the space gestures use', () => {
    moveTo(250, 125, 0);
    const [gesture] = pointer.frame(0).hands;
    expect(gesture.position.x).toBeCloseTo(0.25, 5);
    expect(gesture.position.y).toBeCloseTo(0.25, 5);
  });

  it('clamps a pointer dragged outside the surface', () => {
    moveTo(-400, 9000, 0);
    const [gesture] = pointer.frame(0).hands;
    expect(gesture.position.x).toBe(0);
    expect(gesture.position.y).toBe(1);
  });

  it('points while idle and pinches while pressed', () => {
    moveTo(500, 250, 0);
    expect(pointer.frame(0).hands[0].kind).toBe(GestureKind.POINT);

    pointer.down(10);
    const pressed = pointer.frame(10).hands[0];
    expect(pressed.kind).toBe(GestureKind.PINCH);
    expect(pressed.phase).toBe(Phase.START);
  });

  it('holds the pinch across a drag', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    moveTo(560, 250, 40);
    const dragging = pointer.frame(40).hands[0];
    expect(dragging.kind).toBe(GestureKind.PINCH);
    expect(dragging.phase).toBe(Phase.HOLD);
  });

  it('reports a quick click as a tap', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    pointer.up(100);

    const released = pointer.frame(100).hands[0];
    expect(released.phase).toBe(Phase.END);
    expect(released.tap).toBe(true);
    expect(released.double).toBe(false);
  });

  it('does not call a long press a tap', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    pointer.up(cfg.pointer.tapMs + 200);
    expect(pointer.frame(0).hands[0].tap).toBe(false);
  });

  it('does not call a click that dragged a tap', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    moveTo(500 + cfg.pointer.tapDrift + 20, 250, 50);
    pointer.up(100);
    expect(pointer.frame(100).hands[0].tap).toBe(false);
  });

  it('reports a double click as the double pinch that expands a card', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    pointer.up(80);
    pointer.frame(80);

    pointer.down(160);
    pointer.frame(160);
    pointer.up(220);
    expect(pointer.frame(220).hands[0].double).toBe(true);
  });

  it('does not treat two slow clicks as a double', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    pointer.up(80);
    pointer.frame(80);

    const late = 80 + cfg.pointer.doubleClickMs + 100;
    pointer.down(late);
    pointer.frame(late);
    pointer.up(late + 60);
    expect(pointer.frame(late + 60).hands[0].double).toBe(false);
  });

  it('does not let a triple click read as two overlapping doubles', () => {
    const click = (at: number) => {
      pointer.down(at);
      pointer.frame(at);
      pointer.up(at + 40);
      return pointer.frame(at + 40).hands[0].double;
    };
    moveTo(500, 250, 0);
    expect(click(0)).toBe(false);
    expect(click(100)).toBe(true);
    expect(click(200)).toBe(false);
  });

  it('throws on a fast drag release', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    moveTo(700, 250, 20);
    moveTo(900, 250, 40);
    pointer.up(40);

    const frame = pointer.frame(40);
    expect(frame.flicks.length).toBe(1);
    expect(frame.flicks[0].velocity.x).toBeGreaterThan(0);
  });

  it('does not throw on a slow drag release', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    moveTo(520, 250, 400);
    pointer.up(800);
    expect(pointer.frame(800).flicks).toEqual([]);
  });

  it('consumes each edge once, so an expand cannot re-fire every frame', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    pointer.up(60);

    expect(pointer.frame(60).hands[0].tap).toBe(true);
    expect(pointer.frame(76).hands[0].tap).toBe(false);
    expect(pointer.frame(92).hands[0].phase).toBe(Phase.HOLD);
  });

  it('releases without activating when the pointer leaves mid-drag', () => {
    moveTo(500, 250, 0);
    pointer.down(0);
    pointer.frame(0);
    pointer.cancel();

    const frame = pointer.frame(50);
    expect(frame.hands[0].phase).toBe(Phase.END);
    expect(frame.hands[0].tap).toBe(false);
    expect(frame.flicks).toEqual([]);
  });

  it('never claims a two-hand grip', () => {
    moveTo(500, 250, 0);
    expect(pointer.frame(0).twoHand.active).toBe(false);
  });

  describe('commands', () => {
    it('zooms in and out on the wheel', () => {
      pointer.wheel(-100);
      pointer.wheel(100);
      expect(commands[0]).toEqual({ kind: 'zoom', factor: jasmine.any(Number) });
      expect((commands[0] as { factor: number }).factor).toBeGreaterThan(1);
      expect((commands[1] as { factor: number }).factor).toBeLessThan(1);
    });

    it('maps the keyboard shortcuts', () => {
      expect(pointer.key('g')).toBe(true);
      expect(pointer.key('r')).toBe(true);
      expect(pointer.key('Escape')).toBe(true);
      expect(pointer.key('+')).toBe(true);
      expect(pointer.key('ArrowLeft')).toBe(true);
      expect(pointer.key('ArrowLeft', true)).toBe(true);
      expect(commands.map((c) => c.kind)).toEqual([
        'organize',
        'reset',
        'collapse',
        'zoom',
        'pan',
        'rotate',
      ]);
    });

    it('ignores keys it does not own', () => {
      expect(pointer.key('q')).toBe(false);
      expect(commands).toEqual([]);
    });
  });

  it('forgets the pointer on reset', () => {
    moveTo(500, 250, 0);
    expect(pointer.engaged).toBe(true);
    pointer.reset();
    expect(pointer.engaged).toBe(false);
    expect(pointer.frame(0).hands).toEqual([]);
  });

  it('removes every listener it added on release', () => {
    const surface = document.createElement('div');
    const added: string[] = [];
    const removed: string[] = [];
    spyOn(surface, 'addEventListener').and.callFake((type: string) => void added.push(type));
    spyOn(surface, 'removeEventListener').and.callFake((type: string) => void removed.push(type));

    const detach = pointer.attach(surface, surface);
    detach();

    expect(added.length).toBeGreaterThan(0);
    expect(removed.sort()).toEqual(added.sort());
  });
});
