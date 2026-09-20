/**
 * Hand-authored icon set for the site — 24×24, stroke-based, `currentColor`.
 * No icon font, no dependency: these are drawn here so the marks belong to the
 * product rather than to a generic library.
 */

type P = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
  "aria-hidden": true,
});

/** The mark: a node with a break through it — Clusterbreak's whole idea. */
export function MarkIcon({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)} strokeWidth={1.7}>
      <path d="M12 2.6 20.2 7v10L12 21.4 3.8 17V7z" />
      <path d="M12 8.2 10 12h3l-2 3.8" />
    </svg>
  );
}

/** Break-it physics: a bolt through a chip. */
export function IconBolt({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
      <path d="M13.4 6.6 9 12.4h3.2l-1.6 5 4.4-5.8h-3.2z" />
    </svg>
  );
}

/** Verdict card: a card with a checked line. */
export function IconCard({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M6.5 10.2h6M6.5 13.4h3.5" />
      <path d="M14.2 13.2l1.5 1.6 2.4-3" />
    </svg>
  );
}

/** Detect: crosshair over a chip. */
export function IconCrosshair({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="6.2" />
      <path d="M12 2.6v3.2M12 18.2v3.2M2.6 12h3.2M18.2 12h3.2" />
      <circle cx="12" cy="12" r="1.6" />
    </svg>
  );
}

/** Live data: stacked plates (a measured table). */
export function IconDb({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <ellipse cx="12" cy="6.4" rx="7" ry="2.9" />
      <path d="M5 6.4v5.6c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V6.4" />
      <path d="M5 12v5.6c0 1.6 3.1 2.9 7 2.9s7-1.3 7-2.9V12" />
    </svg>
  );
}

/** Share: node with an arrow leaving it. */
export function IconShare({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="6.5" cy="12" r="2.8" />
      <circle cx="17.5" cy="6.6" r="2.6" />
      <circle cx="17.5" cy="17.4" r="2.6" />
      <path d="M9 10.7 15 7.8M9 13.3l6 2.9" />
    </svg>
  );
}

/** Deploy: cloud with an arrow into it. */
export function IconCloud({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M7.2 18.4h9.3a3.9 3.9 0 0 0 .5-7.8 5.2 5.2 0 0 0-10-1.6 3.9 3.9 0 0 0 .2 9.4z" />
      <path d="M12 15.6V9.8M9.6 12.2 12 9.8l2.4 2.4" />
    </svg>
  );
}

/** Board: an isometric grid of cells. */
export function IconGrid({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3.2 20.4 8v8L12 20.8 3.6 16V8z" />
      <path d="M12 3.2v17.6M3.6 8l16.8 8M20.4 8 3.6 16" />
    </svg>
  );
}

/** Home: roof + door, used for the way back from the simulator. */
export function IconHome({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 10.6 12 4l8 6.6" />
      <path d="M6 10.2V20h12v-9.8" />
      <path d="M10.2 20v-5.2h3.6V20" />
    </svg>
  );
}

/** Docs: an open page. */
export function IconDocs({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 3.6h8.4L19 8.2V20.4H6z" />
      <path d="M14.2 3.8v4.6h4.6" />
      <path d="M9 12.4h6M9 15.6h4" />
    </svg>
  );
}

/** Run: a play triangle in a circle. */
export function IconRun({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M10.4 8.8 15.4 12l-5 3.2z" />
    </svg>
  );
}
