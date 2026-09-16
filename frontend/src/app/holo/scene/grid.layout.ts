import type { HoloConfig } from '../holo.config';
import type { Vec3 } from './scene.types';

/**
 * Responsive grid solver.
 *
 * Rows and columns are derived from the object count and the plane's aspect, so
 * the same code lays out 3 objects and 300 without a table of special cases. The
 * column count is the one that lands closest to the configured target aspect,
 * which keeps a 12-object grid from degenerating into a single long row.
 */
export function gridDimensions(count: number, aspect: number, targetAspect: number): {
  columns: number;
  rows: number;
} {
  if (count <= 0) {
    return { columns: 0, rows: 0 };
  }

  let best = { columns: 1, rows: count, error: Infinity };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    // Aspect of the resulting block, in cells, corrected by the viewport's own.
    const blockAspect = (columns / rows) * (1 / Math.max(aspect, 1e-3));
    const error = Math.abs(Math.log(blockAspect / targetAspect));
    if (error < best.error) {
      best = { columns, rows, error };
    }
  }
  return { columns: best.columns, rows: best.rows };
}

/**
 * Cell centres for `count` objects, centred on the origin and sized to fit the
 * plane. `radius` is the largest object's radius, so nothing overlaps whatever
 * the mix of orbs and cards.
 */
export function gridPositions(count: number, radius: number, config: HoloConfig): Vec3[] {
  if (count <= 0) {
    return [];
  }
  const { halfWidth, halfHeight } = config.scene;
  const { spacing, fill, targetAspect } = config.grid;

  const aspect = halfWidth / Math.max(halfHeight, 1e-3);
  const { columns, rows } = gridDimensions(count, aspect, targetAspect);

  // Start from the spacing the objects want, then shrink to fit rather than
  // letting a large deck run off the plane.
  const wanted = radius * spacing;
  const maxX = columns > 1 ? (halfWidth * 2 * fill) / (columns - 1) : Infinity;
  const maxY = rows > 1 ? (halfHeight * 2 * fill) / (rows - 1) : Infinity;
  const step = Math.min(wanted, maxX, maxY);

  const originY = ((rows - 1) * step) / 2;

  const positions: Vec3[] = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    // Each row is centred on its own, not left-aligned to the block. A last row
    // holding one of four columns would otherwise hang off to one side, which
    // reads as a layout bug rather than as a deliberate arrangement.
    const inRow = Math.min(columns, count - row * columns);
    const originX = -((inRow - 1) * step) / 2;
    positions.push({
      x: originX + column * step,
      // Flat in depth: a grid is for reading, and depth parallax makes the far
      // columns harder to hit than the near ones.
      y: originY - row * step,
      z: 0,
    });
  }
  return positions;
}
