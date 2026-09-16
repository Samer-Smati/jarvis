import { HOLO_DEFAULT_CONFIG } from '../holo.config';
import { proximityFalloff, proximityResponse } from './proximity';
import type { SceneObject } from './scene.types';

const cfg = HOLO_DEFAULT_CONFIG;

const object = (x: number, y = 0): SceneObject => ({
  id: 'o',
  kind: 'orb',
  type: 'folder',
  label: 'O',
  position: { x, y, z: 0 },
  home: { x, y, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  radius: 0.6,
  scale: 1,
  rotation: 0,
  spin: 0,
  open: false,
  visible: true,
  heldBy: null,
  flying: false,
});

describe('proximity', () => {
  describe('proximityFalloff', () => {
    it('is full at contact and zero at the edge', () => {
      expect(proximityFalloff(0, 2)).toBe(1);
      expect(proximityFalloff(2, 2)).toBe(0);
      expect(proximityFalloff(5, 2)).toBe(0);
    });

    it('eases in rather than switching on at the boundary', () => {
      // Smoothstep: just inside the radius the response is still nearly nothing.
      expect(proximityFalloff(1.9, 2)).toBeLessThan(0.05);
      expect(proximityFalloff(1, 2)).toBeCloseTo(0.5, 5);
    });

    it('is inert for a zero radius', () => {
      expect(proximityFalloff(0, 0)).toBe(0);
    });
  });

  describe('proximityResponse', () => {
    it('is inert with no cursor', () => {
      expect(proximityResponse(object(0), null, cfg)).toEqual({
        offset: { x: 0, y: 0, z: 0 },
        scale: 1,
        strength: 0,
      });
    });

    it('leans towards the hand and swells', () => {
      const response = proximityResponse(object(0), { x: 0.3, y: 0, z: 0 }, cfg);
      expect(response.offset.x).toBeGreaterThan(0);
      expect(response.scale).toBeGreaterThan(1);
      expect(response.strength).toBeGreaterThan(0);
    });

    it('leans the other way for a hand on the other side', () => {
      const response = proximityResponse(object(0), { x: -0.3, y: 0, z: 0 }, cfg);
      expect(response.offset.x).toBeLessThan(0);
    });

    it('ignores an object outside the radius', () => {
      const far = proximityResponse(object(0), { x: cfg.proximity.radius * 2, y: 0, z: 0 }, cfg);
      expect(far.strength).toBe(0);
      expect(far.scale).toBe(1);
    });

    it('never leans further than the configured distance', () => {
      const response = proximityResponse(object(0), { x: 0.001, y: 0, z: 0 }, cfg);
      expect(Math.hypot(response.offset.x, response.offset.y)).toBeLessThanOrEqual(cfg.proximity.lean + 1e-9);
    });
  });
});
