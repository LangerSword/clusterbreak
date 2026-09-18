import { useRef } from "react";
import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Device, FitStatus, NodeMeter } from "../sim";
import type { Cell } from "./grid";
import { snapCell } from "./grid";
import type { RigNode } from "./useRig";

const VENDOR_COLORS: Record<string, string> = {
  NVIDIA: "#33473a",
  Apple: "#3a3f47",
  AMD: "#4a3436",
  Generic: "#313a44",
};

const FIT_CLASS: Record<FitStatus, string> = {
  comfortable: "fit-ok",
  tight: "fit-tight",
  does_not_fit: "fit-bad",
};

export interface NodeEstimate {
  tps: number | null;
  fit: FitStatus;
  /** "fitted" = efficiency comes from a measured benchmark; "estimate" = default parameter. */
  kind: "fitted" | "estimate";
}

interface Props {
  node: RigNode;
  device: Device;
  selected: boolean;
  linkStart: boolean;
  dragging: boolean;
  estimate: NodeEstimate;
  /** Live meter from the run simulator (null when no run is active). */
  meter: NodeMeter | null;
  unplugged: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, cell: Cell) => void;
  onDragChange: (id: string | null) => void;
}

export function NodeMesh({
  node,
  device,
  selected,
  linkStart,
  dragging,
  estimate,
  meter,
  unplugged,
  onSelect,
  onMove,
  onDragChange,
}: Props) {
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hitPoint = useRef(new THREE.Vector3());
  const cellRef = useRef<Cell>(node.cell);
  cellRef.current = node.cell;

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as unknown as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(node.id);
    onDragChange(node.id);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging) return;
    const p = e.ray.intersectPlane(groundPlane.current, hitPoint.current);
    if (!p) return;
    const c = snapCell(p.x, p.z);
    if (c[0] !== cellRef.current[0] || c[1] !== cellRef.current[1]) onMove(node.id, c);
  };

  const handleUp = (e: ThreeEvent<PointerEvent>) => {
    (e.target as unknown as HTMLElement).releasePointerCapture(e.pointerId);
    onDragChange(null);
  };

  const ringColor = unplugged
    ? "#5e6670"
    : linkStart
      ? "#e0b341"
      : selected
        ? "#9fd0ff"
        : estimate.fit === "comfortable"
          ? "#57d38c"
          : estimate.fit === "tight"
            ? "#e0b341"
            : "#e05c5c";

  return (
    <group position={[node.cell[0], 0, node.cell[1]]}>
      <mesh
        position={[0, 0.13, 0]}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        <boxGeometry args={[0.92, 0.26, 0.92]} />
        <meshStandardMaterial
          color={VENDOR_COLORS[device.vendor] ?? "#313a44"}
          metalness={0.45}
          roughness={0.5}
          transparent={unplugged}
          opacity={unplugged ? 0.3 : 1}
          emissive={selected || linkStart ? "#2c3a4a" : "#000000"}
          emissiveIntensity={selected || linkStart ? 0.7 : 0}
        />
      </mesh>
      <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.56, 0.61, 48]} />
        <meshBasicMaterial color={ringColor} transparent opacity={dragging ? 1 : 0.75} />
      </mesh>
      <Html center position={[0, 0.62, 0]} zIndexRange={[20, 0]} wrapperClass="node-html">
        <div className={`node-label ${FIT_CLASS[estimate.fit]} ${unplugged ? "unplugged" : ""}`}>
          <div className="nl-name">{device.name}</div>
          {unplugged ? (
            <div className="nl-tps">UNPLUGGED</div>
          ) : meter ? (
            <>
              <div className="nl-spec">
                vram {meter.footprintGb.toFixed(1)} / {meter.memGb} GB
              </div>
              <div className="nl-vram">
                <div
                  className={`nl-vram-fill ${meter.status}`}
                  style={{ width: `${Math.min(100, meter.vramPct * 100).toFixed(1)}%` }}
                />
              </div>
            </>
          ) : (
            <>
              <div className="nl-spec">
                {device.memoryGb}GB · {device.bandwidthGbps} GB/s
              </div>
              <div className="nl-tps">
                {estimate.tps == null
                  ? "no size data"
                  : `${estimate.kind === "estimate" ? "~" : ""}${estimate.tps.toFixed(1)} tok/s`}
              </div>
            </>
          )}
        </div>
      </Html>
    </group>
  );
}
