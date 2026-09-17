/** Grid math for the rig board: snap-to-cell placement on an integer lattice. */

export type Cell = readonly [number, number];

export const GRID_LIMIT = 14;

const clamp = (v: number) => Math.max(-GRID_LIMIT, Math.min(GRID_LIMIT, v));

/** Normalize negative zero (Math.round(-0.4) === -0) so cell values stay canonical. */
const norm = (v: number) => (v === 0 ? 0 : v);

export const cellKey = (c: Cell) => `${c[0]},${c[1]}`;

export function snapCell(x: number, z: number): Cell {
  return [norm(clamp(Math.round(x))), norm(clamp(Math.round(z)))] as const;
}

/** Cells ordered from the origin outward (ring by ring) — used for auto-placement. */
export function spiralCells(): Cell[] {
  const cells: Cell[] = [[0, 0]];
  for (let r = 1; r <= GRID_LIMIT; r++) {
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) === r) cells.push([x, z]);
      }
    }
  }
  return cells;
}

export function firstFreeCell(occupied: Set<string>): Cell | null {
  for (const c of spiralCells()) {
    if (!occupied.has(cellKey(c))) return c;
  }
  return null;
}
