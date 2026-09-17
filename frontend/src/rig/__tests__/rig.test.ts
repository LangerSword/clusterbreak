import { describe, expect, it } from "vitest";
import { cellKey, firstFreeCell, snapCell, spiralCells } from "../grid";
import { reducer, type RigState } from "../useRig";

/**
 * Rig interaction logic: what the pointer handlers on the 3D board call into.
 * The drag/snap/link flows must be correct even though they are driven by
 * canvas pointer events in the browser.
 */

const empty: RigState = { nodes: [], links: [] };

describe("grid math", () => {
  it("snaps to the nearest cell and clamps to the board limits", () => {
    expect(snapCell(0.4, -0.4)).toEqual([0, 0]);
    expect(snapCell(2.6, 2.4)).toEqual([3, 2]);
    expect(snapCell(99, -99)).toEqual([14, -14]);
  });

  it("spiral starts at the origin and visits no cell twice", () => {
    const cells = spiralCells();
    expect(cells[0]).toEqual([0, 0]);
    const keys = new Set(cells.map(cellKey));
    expect(keys.size).toBe(cells.length);
  });

  it("firstFreeCell skips occupied cells in placement order", () => {
    const occupied = new Set(["0,0", "-1,-1"]);
    expect(firstFreeCell(occupied)).toEqual([-1, 0]);
  });
});

describe("rig reducer", () => {
  it("adds devices to successive free spiral cells", () => {
    let s = reducer(empty, { type: "add", deviceId: "rtx3090_24gb" });
    s = reducer(s, { type: "add", deviceId: "rtx4060_8gb" });
    expect(s.nodes.map((n) => n.cell)).toEqual([
      [0, 0],
      [-1, -1],
    ]);
  });

  it("rejects a move onto a cell occupied by another node", () => {
    let s = reducer(empty, { type: "add", deviceId: "a" });
    s = reducer(s, { type: "add", deviceId: "b" });
    const n2 = s.nodes[1]!;
    s = reducer(s, { type: "move", id: n2.id, cell: [0, 0] });
    expect(s.nodes.find((n) => n.id === n2.id)!.cell).toEqual([-1, -1]);
  });

  it("allows a move to a free cell", () => {
    let s = reducer(empty, { type: "add", deviceId: "a" });
    s = reducer(s, { type: "add", deviceId: "b" });
    const n2 = s.nodes[1]!;
    s = reducer(s, { type: "move", id: n2.id, cell: [5, 5] });
    expect(s.nodes.find((n) => n.id === n2.id)!.cell).toEqual([5, 5]);
  });

  it("links are undirected-unique and self-links are ignored", () => {
    let s = reducer(empty, { type: "add", deviceId: "a" });
    s = reducer(s, { type: "add", deviceId: "b" });
    const a = s.nodes[0]!.id;
    const b = s.nodes[1]!.id;
    s = reducer(s, { type: "link", a, b });
    s = reducer(s, { type: "link", a: b, b: a }); // reversed duplicate
    s = reducer(s, { type: "link", a, b: a }); // self-link
    expect(s.links).toHaveLength(1);
  });

  it("removing a node also removes its links", () => {
    let s = reducer(empty, { type: "add", deviceId: "a" });
    s = reducer(s, { type: "add", deviceId: "b" });
    const a = s.nodes[0]!.id;
    const b = s.nodes[1]!.id;
    s = reducer(s, { type: "link", a, b });
    s = reducer(s, { type: "remove", id: a });
    expect(s.nodes).toHaveLength(1);
    expect(s.links).toHaveLength(0);
  });

  it("reset clears everything", () => {
    let s = reducer(empty, { type: "add", deviceId: "a" });
    s = reducer(s, { type: "reset" });
    expect(s).toEqual({ nodes: [], links: [] });
  });
});
