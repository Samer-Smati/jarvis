import type { Vec2 } from '../gestures/landmark.math';
import type { HoloConfig } from '../holo.config';
import type { SceneCamera, Vec3 } from './scene.types';

/**
 * Projection shared by the hit test and the renderer.
 *
 * The camera sits at +focal on the z axis looking back at the origin, so an
 * object's apparent size shrinks with depth. Both consumers compute that from
 * the same numbers here: if the hit test used a flat radius, distant orbs would
 * be grabbable well outside where they are drawn, which reads as the tracking
 * being broken rather than the maths.
 */
export function perspectiveScale(z: number, focal: number): number {
  // Clamped rather than allowed through zero: an object level with the camera
  // has no finite projected size, and a NaN radius silently disables hit testing.
  const depth = Math.max(focal - z, 0.35);
  return focal / depth;
}

/** Apparent radius of a sphere of `radius` sitting at depth `z`. */
export function projectedRadius(radius: number, z: number, focal: number): number {
  return radius * perspectiveScale(z, focal);
}

/**
 * Normalized gesture position (0..1, already mirrored by the gesture layer) to a
 * world point on the z = 0 plane, undoing the camera transform so the cursor
 * lands where the user sees their hand even while the scene is panned or turned.
 */
export function cursorToWorld(position: Vec2, camera: SceneCamera, config: HoloConfig): Vec3 {
  const { halfWidth, halfHeight } = config.scene;

  // Screen centre is the origin, and y is flipped: image space counts downward.
  const sx = (position.x - 0.5) * 2 * halfWidth;
  const sy = -(position.y - 0.5) * 2 * halfHeight;

  // Undo zoom and pan, then rotation, in the reverse order the renderer applies them.
  const zx = sx / camera.zoom - camera.pan.x;
  const zy = sy / camera.zoom - camera.pan.y;

  const cos = Math.cos(-camera.rotation);
  const sin = Math.sin(-camera.rotation);

  return { x: zx * cos - zy * sin, y: zx * sin + zy * cos, z: 0 };
}

export function distance3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Planar distance. Depth is deliberately excluded — see pickAt. */
export function distanceXY(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Frame-rate independent easing: the same fraction of the gap closes per second
 *  whether the deck runs at 30fps or 120. */
export function easeTowards(current: number, target: number, seconds: number, dt: number): number {
  if (seconds <= 0) {
    return target;
  }
  const t = 1 - Math.exp(-dt / seconds);
  return current + (target - current) * t;
}

/** Points evenly spaced on a ring, tilted through depth so it reads as 3D. */
export function ringPosition(index: number, count: number, radius: number, depth: number): Vec3 {
  const angle = count <= 0 ? 0 : (index / count) * Math.PI * 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * 0.42,
    z: Math.sin(angle) * depth * 0.5,
  };
}
