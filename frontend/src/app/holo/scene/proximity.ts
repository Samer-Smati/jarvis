import type { HoloConfig } from '../holo.config';
import { distanceXY } from './scene.math';
import type { SceneObject, Vec3 } from './scene.types';

/** How strongly an object responds to the hand, 1 at contact and 0 at the edge
 *  of the proximity radius. Smoothstep rather than linear, so the response eases
 *  in instead of switching on at the boundary. */
export function proximityFalloff(distance: number, radius: number): number {
  if (radius <= 0) {
    return 0;
  }
  const t = Math.min(Math.max(1 - distance / radius, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The nearest object's response to an approaching hand: it leans towards the
 * cursor and swells slightly, so the user sees what they are about to grab
 * before they close their fingers.
 *
 * Returns a target offset and scale rather than mutating, so the caller decides
 * whether effects are enabled and the engine stays declarative.
 */
export function proximityResponse(
  object: SceneObject,
  cursor: Vec3 | null,
  config: HoloConfig,
): { offset: Vec3; scale: number; strength: number } {
  const idle = { offset: { x: 0, y: 0, z: 0 }, scale: 1, strength: 0 };
  if (!cursor) {
    return idle;
  }

  const distance = distanceXY(cursor, object.home);
  const strength = proximityFalloff(distance, config.proximity.radius);
  if (strength <= 0) {
    return idle;
  }

  // Direction from the object's resting place towards the hand.
  const dx = cursor.x - object.home.x;
  const dy = cursor.y - object.home.y;
  const length = Math.hypot(dx, dy) || 1;
  const lean = config.proximity.lean * strength;

  return {
    offset: { x: (dx / length) * lean, y: (dy / length) * lean, z: lean * 0.5 },
    scale: 1 + config.proximity.swell * strength,
    strength,
  };
}
