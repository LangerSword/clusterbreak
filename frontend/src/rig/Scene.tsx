import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, QuadraticBezierLine } from "@react-three/drei";
import type { Device, RunState } from "../sim";
import type { Cell } from "./grid";
import { NodeMesh, type NodeEstimate } from "./NodeMesh";
import type { RigLink, RigNode } from "./useRig";

interface Props {
  nodes: RigNode[];
  links: RigLink[];
  devicesById: Map<string, Device>;
  estimates: Map<string, NodeEstimate>;
  selectedId: string | null;
  linkStartId: string | null;
  draggingId: string | null;
  /** Active run — drives live meters and unplugged-node visuals. */
  run: RunState | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, cell: Cell) => void;
  onDragChange: (id: string | null) => void;
}

export function Scene({
  nodes,
  links,
  devicesById,
  estimates,
  selectedId,
  linkStartId,
  draggingId,
  run,
  onSelect,
  onMove,
  onDragChange,
}: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: [10, 13, 10], zoom: 52, near: 0.1, far: 300 }}
      gl={{ antialias: true }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#0b0d10"]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[8, 14, 6]} intensity={1.15} />
      <directionalLight position={[-7, 9, -9]} intensity={0.35} color="#8fb7ff" />

      <Grid
        position={[0, -0.02, 0]}
        args={[1, 1]}
        cellSize={1}
        cellThickness={0.55}
        cellColor="#181d24"
        sectionSize={5}
        sectionThickness={1.1}
        sectionColor="#2a333f"
        infiniteGrid
        fadeDistance={46}
        fadeStrength={1.3}
      />

      {links.map((l) => {
        const a = byId.get(l.a);
        const b = byId.get(l.b);
        if (!a || !b) return null;
        const throttled = l.gbps < 1;
        return (
          <QuadraticBezierLine
            key={l.id}
            start={[a.cell[0], 0.3, a.cell[1]]}
            end={[b.cell[0], 0.3, b.cell[1]]}
            mid={[(a.cell[0] + b.cell[0]) / 2, 1.0, (a.cell[1] + b.cell[1]) / 2]}
            color={throttled ? "#e0b341" : "#4d5f74"}
            lineWidth={throttled ? 2.2 : 1.6}
          />
        );
      })}

      {nodes.map((n) => {
        const device = devicesById.get(n.deviceId);
        const est = estimates.get(n.id);
        if (!device || !est) return null;
        const meter = run?.meters.find((m) => m.nodeId === n.id) ?? null;
        const unplugged = run?.unplugged.includes(n.id) ?? false;
        return (
          <NodeMesh
            key={n.id}
            node={n}
            device={device}
            selected={selectedId === n.id}
            linkStart={linkStartId === n.id}
            dragging={draggingId === n.id}
            estimate={est}
            meter={meter}
            unplugged={unplugged}
            onSelect={onSelect}
            onMove={onMove}
            onDragChange={onDragChange}
          />
        );
      })}

      <OrbitControls
        makeDefault
        enabled={draggingId === null}
        enableDamping
        dampingFactor={0.09}
        maxPolarAngle={Math.PI / 2.2}
        minZoom={22}
        maxZoom={110}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
