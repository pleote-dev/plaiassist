import type { Rect, Surface } from './engine';

/**
 * Finds "walkable" horizontal lines and text lines in a screenshot.
 * Pure function: works on a BGRA/RGBA pixel buffer (luminance is channel-order
 * agnostic enough for edge detection). Returned coordinates are in screen px.
 */
export interface AnalysisOptions {
  /** capture px → screen px: X = offsetX + x / scaleX */
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  /** minimum edge length in screen px */
  minEdgePx?: number;
  /** regions to ignore (e.g. the avatar herself) */
  exclude?: Rect[];
  edgeThreshold?: number;
  textThreshold?: number;
}

export interface AnalysisResult {
  edges: Surface[];
  textLines: Rect[];
}

export function analyzeScreen(px: Uint8Array, w: number, h: number, o: AnalysisOptions): AnalysisResult {
  const L = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    L[i] = (px[j] * 0.2 + px[j + 1] * 0.6 + px[j + 2] * 0.2) | 0;
  }
  const minLen = Math.max(12, Math.round((o.minEdgePx ?? 90) * o.scaleX));
  const TE = o.edgeThreshold ?? 12;
  const TT = o.textThreshold ?? 38;

  // ---------------------------------------------------------- horizontal edges
  type Run = { x0: number; x1: number; y: number };
  const runs: Run[] = [];
  for (let y = 0; y < h - 1; y++) {
    const r0 = y * w;
    const r1 = r0 + w;
    let start = -1;
    let lastHit = -10;
    for (let x = 0; x <= w; x++) {
      const hit = x < w && Math.abs(L[r0 + x] - L[r1 + x]) >= TE;
      if (hit) {
        if (start < 0) start = x;
        lastHit = x;
      } else if (start >= 0 && (x - lastHit > 2 || x === w)) {
        if (lastHit - start + 1 >= minLen) runs.push({ x0: start, x1: lastHit, y: y + 1 });
        start = -1;
      }
    }
  }
  // merge runs in neighbouring rows (keep the upper one, union the span)
  runs.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const merged: Run[] = [];
  for (const r of runs) {
    const m = merged.find(
      (q) => r.y - q.y <= 2 && r.y >= q.y && Math.min(q.x1, r.x1) - Math.max(q.x0, r.x0) > 0.5 * (r.x1 - r.x0)
    );
    if (m) {
      m.x0 = Math.min(m.x0, r.x0);
      m.x1 = Math.max(m.x1, r.x1);
    } else merged.push({ ...r });
  }

  // ---------------------------------------------------------- text lines
  const TW = 12;
  const tilesX = Math.ceil(w / TW);
  const mark = new Uint8Array(tilesX * h);
  for (let y = 0; y < h; y++) {
    const r0 = y * w;
    for (let tx = 0; tx < tilesX; tx++) {
      let c = 0;
      const xe = Math.min(w - 1, (tx + 1) * TW);
      for (let x = tx * TW; x < xe; x++) if (Math.abs(L[r0 + x] - L[r0 + x + 1]) >= TT) c++;
      mark[y * tilesX + tx] = c >= 2 ? 1 : 0;
    }
  }
  type Band = { tx0: number; tx1: number; y0: number; y1: number };
  const bands: Band[] = [];
  const maxH = Math.max(22, 40 * o.scaleY);
  for (let tx = 0; tx < tilesX; tx++) {
    let y0 = -1;
    let last = -10;
    const flush = () => {
      const hgt = last - y0 + 1;
      if (y0 >= 0 && hgt >= 3 && hgt <= maxH) bands.push({ tx0: tx, tx1: tx, y0, y1: last });
      y0 = -1;
    };
    for (let y = 0; y < h; y++) {
      if (mark[y * tilesX + tx]) {
        if (y0 < 0) y0 = y;
        last = y;
      } else if (y0 >= 0 && y - last > 1) flush();
    }
    flush();
  }
  bands.sort((a, b) => a.y0 - b.y0 || a.tx0 - b.tx0);
  const lines: Band[] = [];
  for (const b of bands) {
    const m = lines.find((l) => l.tx1 >= b.tx0 - 2 && l.tx1 < b.tx0 + 1 && Math.abs(l.y0 - b.y0) <= 3 && Math.abs(l.y1 - b.y1) <= 4);
    if (m) {
      m.tx1 = b.tx0;
      m.y0 = Math.min(m.y0, b.y0);
      m.y1 = Math.max(m.y1, b.y1);
    } else lines.push({ ...b });
  }

  // ---------------------------------------------------------- to screen space
  const X = (x: number) => o.offsetX + x / o.scaleX;
  const Y = (y: number) => o.offsetY + y / o.scaleY;
  const excl = o.exclude ?? [];
  const cut = (x0: number, x1: number, y: number): [number, number][] => {
    let parts: [number, number][] = [[x0, x1]];
    for (const r of excl) {
      if (y < r.y || y > r.y + r.h - 8) continue;
      const next: [number, number][] = [];
      for (const [a, b] of parts) {
        if (b < r.x || a > r.x + r.w) next.push([a, b]);
        else {
          if (a < r.x) next.push([a, r.x]);
          if (b > r.x + r.w) next.push([r.x + r.w, b]);
        }
      }
      parts = next;
    }
    return parts;
  };

  const textLinesRaw: Rect[] = lines
    .filter((l) => l.tx1 - l.tx0 >= 1)
    .map((l) => ({ x: X(l.tx0 * TW), y: Y(l.y0), w: ((l.tx1 - l.tx0 + 1) * TW) / o.scaleX, h: (l.y1 - l.y0 + 1) / o.scaleY }));
  const edges: Surface[] = [];
  merged.forEach((r, i) => {
    const y = Math.round(Y(r.y));
    cut(X(r.x0), X(r.x1 + 1), y).forEach(([a, b], k) => {
      if (b - a >= (o.minEdgePx ?? 90) * 0.8) edges.push({ id: `e${i}_${k}_${y}`, x0: a, x1: b, y, kind: 'edge' });
    });
  });
  // drop "edges" that are really letter strokes inside a text line
  const inText = (e: Surface) =>
    textLinesRaw.some((t) => {
      if (e.y <= t.y + 1 || e.y >= t.y + t.h + 1) return false;
      const ov = Math.min(e.x1, t.x + t.w) - Math.max(e.x0, t.x);
      return ov > 0.4 * (e.x1 - e.x0);
    });
  for (let i = edges.length - 1; i >= 0; i--) if (inText(edges[i])) edges.splice(i, 1);
  edges.sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
  if (edges.length > 160) edges.length = 160;

  const textLines: Rect[] = textLinesRaw.filter((r) => !excl.some((e) => r.x >= e.x && r.x + r.w <= e.x + e.w && r.y >= e.y && r.y + r.h <= e.y + e.h));

  return { edges, textLines };
}

/** Text line rects → standable surfaces (top of long lines) + merged blocks. */
export function textSurfaces(lines: Rect[], minW: number): Surface[] {
  return lines
    .filter((r) => r.w >= minW)
    .map((r, i) => ({ id: `t${i}_${Math.round(r.y)}`, x0: r.x, x1: r.x + r.w, y: Math.round(r.y - 2), kind: 'text' as const }));
}

/** Rects of text lines near a point (the text the user is working on). */
export function protectAround(lines: Rect[], p: { x: number; y: number }, radiusX = 260, radiusY = 70): Rect[] {
  const out: Rect[] = [{ x: p.x - radiusX * 0.6, y: p.y - 40, w: radiusX * 1.2, h: 80 }];
  for (const r of lines) {
    const cy = r.y + r.h / 2;
    if (Math.abs(cy - p.y) <= radiusY && r.x <= p.x + radiusX && r.x + r.w >= p.x - radiusX) out.push(r);
  }
  return out;
}
