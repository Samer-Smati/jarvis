import { HOLO_DEFAULT_CONFIG } from '../holo.config';
import { gridDimensions, gridPositions } from './grid.layout';

const cfg = HOLO_DEFAULT_CONFIG;

describe('grid layout', () => {
  describe('gridDimensions', () => {
    it('covers every object', () => {
      for (const count of [1, 2, 3, 5, 7, 12, 30, 97]) {
        const { columns, rows } = gridDimensions(count, 1.6, cfg.grid.targetAspect);
        expect(columns * rows).toBeGreaterThanOrEqual(count);
      }
    });

    it('never degenerates into a single long row', () => {
      const { columns, rows } = gridDimensions(12, 1.6, cfg.grid.targetAspect);
      expect(rows).toBeGreaterThan(1);
      expect(columns).toBeGreaterThan(1);
    });

    it('adapts to the viewport rather than using a fixed shape', () => {
      const wide = gridDimensions(12, 3, cfg.grid.targetAspect);
      const tall = gridDimensions(12, 0.4, cfg.grid.targetAspect);
      expect(wide.columns).toBeGreaterThan(tall.columns);
    });

    it('handles an empty deck', () => {
      expect(gridDimensions(0, 1.6, 1.6)).toEqual({ columns: 0, rows: 0 });
    });
  });

  describe('gridPositions', () => {
    it('returns one cell per object', () => {
      expect(gridPositions(7, 0.5, cfg).length).toBe(7);
    });

    it('centres the block on the origin', () => {
      const cells = gridPositions(9, 0.4, cfg);
      const meanX = cells.reduce((sum, c) => sum + c.x, 0) / cells.length;
      expect(meanX).toBeCloseTo(0, 6);
      // Vertically it is the block that is centred, not the mean of occupied
      // cells: a partial last row holds fewer objects but still occupies a row.
      expect(Math.min(...cells.map((c) => c.y))).toBeCloseTo(-Math.max(...cells.map((c) => c.y)), 6);
    });

    it('centres a partially filled last row instead of letting it hang left', () => {
      // 7 objects over 3 columns leaves one alone on the final row.
      const cells = gridPositions(7, 0.4, cfg);
      const lastRowY = Math.min(...cells.map((c) => c.y));
      const lastRow = cells.filter((c) => c.y === lastRowY);
      const meanX = lastRow.reduce((sum, c) => sum + c.x, 0) / lastRow.length;
      expect(meanX).toBeCloseTo(0, 6);
    });

    it('keeps every cell on the interaction plane, even for a large deck', () => {
      const cells = gridPositions(120, 0.6, cfg);
      for (const cell of cells) {
        expect(Math.abs(cell.x)).toBeLessThanOrEqual(cfg.scene.halfWidth);
        expect(Math.abs(cell.y)).toBeLessThanOrEqual(cfg.scene.halfHeight);
      }
    });

    it('never overlaps two cells', () => {
      const cells = gridPositions(24, 0.4, cfg);
      const seen = new Set(cells.map((c) => `${c.x.toFixed(4)}:${c.y.toFixed(4)}`));
      expect(seen.size).toBe(cells.length);
    });

    it('lays a grid out flat, so far columns are no harder to reach than near ones', () => {
      expect(gridPositions(12, 0.4, cfg).every((c) => c.z === 0)).toBe(true);
    });

    it('returns nothing for an empty deck', () => {
      expect(gridPositions(0, 0.4, cfg)).toEqual([]);
    });
  });
});
