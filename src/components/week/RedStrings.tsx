"use client";

import { useEffect, useState, type RefObject } from "react";

export interface StringLink {
  shiftId: string;
  messageId: string;
}

interface Path {
  key: string;
  d: string;
  a: [number, number];
  b: [number, number];
}

/**
 * Red string from each uncovered shift card to the chat message that blocks it. Decorative: the same
 * facts are written out in the uncovered panel, so it is hidden from assistive tech and on narrow screens.
 */
export function RedStrings({ container, links, version }: { container: RefObject<HTMLElement | null>; links: StringLink[]; version: string }) {
  const [paths, setPaths] = useState<Path[]>([]);

  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (window.innerWidth < 1024) return setPaths([]);
        const box = root.getBoundingClientRect();
        const next: Path[] = [];
        for (const l of links) {
          const card = root.querySelector<HTMLElement>(`[data-shift-id="${l.shiftId}"]`);
          const msg = root.querySelector<HTMLElement>(`[data-message-id="${l.messageId}"]`);
          if (!card || !msg) continue;
          const c = card.getBoundingClientRect();
          const m = msg.getBoundingClientRect();
          const a: [number, number] = [c.left - box.left + 6, c.top - box.top + c.height / 2];
          const b: [number, number] = [m.right - box.left - 4, m.top - box.top + Math.min(24, m.height / 2)];
          const sag = Math.min(140, Math.abs(a[0] - b[0]) * 0.25 + 40);
          const midX = (a[0] + b[0]) / 2;
          const midY = Math.max(a[1], b[1]) + sag;
          next.push({ key: `${l.shiftId}-${l.messageId}`, a, b, d: `M ${a[0]} ${a[1]} Q ${midX} ${midY} ${b[0]} ${b[1]}` });
        }
        setPaths(next);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [container, links, version]);

  if (paths.length === 0) return null;
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid="red-strings">
      {paths.map((p) => (
        <g key={p.key}>
          <path d={p.d} fill="none" stroke="#c0262d" strokeWidth="2.5" strokeLinecap="round" style={{ filter: "drop-shadow(0 2px 1px rgba(0,0,0,.35))" }} />
          <circle cx={p.a[0]} cy={p.a[1]} r="5" fill="#c0262d" />
          <circle cx={p.b[0]} cy={p.b[1]} r="5" fill="#c0262d" />
        </g>
      ))}
    </svg>
  );
}
