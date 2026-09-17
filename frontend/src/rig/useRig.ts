import { useMemo, useReducer } from "react";
import { DEFAULT_LINK_GBPS } from "../sim";
import type { Cell } from "./grid";
import { cellKey, firstFreeCell } from "./grid";

/** Rig state: device nodes placed on the grid, and links between them. */

export interface RigNode {
  id: string;
  deviceId: string;
  cell: Cell;
}

export interface RigLink {
  id: string;
  a: string;
  b: string;
  /** Link speed in Gbps — used by the run simulator (throttling = fault injection). */
  gbps: number;
}

export interface RigState {
  nodes: RigNode[];
  links: RigLink[];
}

type Action =
  | { type: "add"; deviceId: string }
  | { type: "move"; id: string; cell: Cell }
  | { type: "remove"; id: string }
  | { type: "link"; a: string; b: string }
  | { type: "unlink"; id: string }
  | { type: "setLinkGbps"; id: string; gbps: number }
  | { type: "reset" };

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function reducer(state: RigState, action: Action): RigState {
  switch (action.type) {
    case "add": {
      const occupied = new Set(state.nodes.map((n) => cellKey(n.cell)));
      const cell = firstFreeCell(occupied);
      if (!cell) return state;
      return {
        ...state,
        nodes: [...state.nodes, { id: nextId("n"), deviceId: action.deviceId, cell }],
      };
    }
    case "move": {
      const others = new Set(
        state.nodes.filter((n) => n.id !== action.id).map((n) => cellKey(n.cell)),
      );
      if (others.has(cellKey(action.cell))) return state;
      return {
        ...state,
        nodes: state.nodes.map((n) => (n.id === action.id ? { ...n, cell: action.cell } : n)),
      };
    }
    case "remove":
      return {
        nodes: state.nodes.filter((n) => n.id !== action.id),
        links: state.links.filter((l) => l.a !== action.id && l.b !== action.id),
      };
    case "link": {
      if (action.a === action.b) return state;
      const dup = state.links.some(
        (l) => (l.a === action.a && l.b === action.b) || (l.a === action.b && l.b === action.a),
      );
      if (dup) return state;
      return {
        ...state,
        links: [...state.links, { id: nextId("l"), a: action.a, b: action.b, gbps: DEFAULT_LINK_GBPS }],
      };
    }
    case "unlink":
      return { ...state, links: state.links.filter((l) => l.id !== action.id) };
    case "setLinkGbps":
      return {
        ...state,
        links: state.links.map((l) => (l.id === action.id ? { ...l, gbps: action.gbps } : l)),
      };
    case "reset":
      return { nodes: [], links: [] };
  }
}

/** Union-find over links → node-id groups (placed order preserved inside groups). */
function connectedComponents(nodes: RigNode[], links: RigLink[]): string[][] {
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const l of links) {
    if (!parent.has(l.a) || !parent.has(l.b)) continue;
    parent.set(find(l.a), find(l.b));
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const root = find(n.id);
    const g = groups.get(root) ?? [];
    g.push(n.id);
    groups.set(root, g);
  }
  return [...groups.values()];
}

export function useRig() {
  const [state, dispatch] = useReducer(reducer, { nodes: [], links: [] });
  const occupied = useMemo(() => new Set(state.nodes.map((n) => cellKey(n.cell))), [state.nodes]);
  const components = useMemo(
    () => connectedComponents(state.nodes, state.links),
    [state.nodes, state.links],
  );
  return { ...state, occupied, components, dispatch };
}
