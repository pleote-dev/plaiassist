/**
 * Companion locomotion engine (environment-agnostic, no DOM / Electron imports).
 *
 * The avatar is treated as a little platformer character living on the screen:
 * horizontal "surfaces" (window edges, straight lines, text lines, DOM boxes,
 * the bottom of the screen) are platforms. She walks along them, jumps or climbs
 * to surfaces above, hops / climbs down to surfaces below and falls when the
 * platform under her disappears. She tries to stay close to the mouse / text
 * cursor, looking at it, without covering the text the user is working on.
 *
 * Coordinates: pixels, y grows downward. `pos` is the point between her feet.
 * Used by the Electron main process (desktop) and by the browser extension.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SurfaceKind = 'ground' | 'edge' | 'text' | 'element';

export interface Surface {
  id: string;
  x0: number;
  x1: number;
  y: number;
  kind: SurfaceKind;
}

export type LocoState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'prejump'
  | 'jump'
  | 'fall'
  | 'land'
  | 'climb'
  | 'climb_down'
  | 'grabbed';

export type CompanionMode = 'follow' | 'stay' | 'roam';

export interface CompanionSettings {
  enabled: boolean;
  mode: CompanionMode;
  avoidText: boolean;
  /** Preferred distance between her head and the cursor, in body heights. */
  followDistance: number;
  walkSpeed: number; // px/s
  runSpeed: number; // px/s
  climbSpeed: number; // px/s
  gravity: number; // px/s²
  /** Max height she can jump up, in body heights. */
  maxJumpUp: number;
  /** Max horizontal gap she can jump across, in body widths. */
  maxGap: number;
}

export const DEFAULT_SETTINGS: CompanionSettings = {
  enabled: true,
  mode: 'follow',
  avoidText: true,
  followDistance: 0.75,
  walkSpeed: 130,
  runSpeed: 300,
  climbSpeed: 160,
  gravity: 2400,
  maxJumpUp: 1.25,
  maxGap: 1.6,
};

export interface WorldInput {
  dt: number; // seconds
  cursor: { x: number; y: number };
  /** Text caret rectangle if known (browser); takes precedence for following. */
  caret?: Rect | null;
  surfaces: Surface[];
  /** Area she must stay within (screen work area / viewport). */
  bounds: Rect;
  /** Rectangles she must never cover (text being edited, cursor area). */
  protect: Rect[];
  /** Rectangles she should preferably not cover (other text). */
  avoid: Rect[];
}

export interface CompanionOutput {
  x: number;
  y: number;
  state: LocoState;
  facing: -1 | 1;
  /** Speed in body heights per second (drives walk-cycle cadence). */
  speedBH: number;
  vx: number;
  vy: number;
  lookX: number;
  lookY: number;
  surfaceKind: SurfaceKind | null;
  body: Rect;
  goal: { x: number; y: number } | null;
  mode: CompanionMode;
  enabled: boolean;
}

type Hop = 'jump' | 'drop' | 'climb' | 'walkgap';

type Action =
  | { type: 'walk'; x: number }
  | { type: 'hop'; hop: Hop; x: number; y: number; target: Surface };

interface Arc {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
  T: number;
  t: number;
  target: Surface;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export class CompanionEngine {
  settings: CompanionSettings = { ...DEFAULT_SETTINGS };
  bodyW = 90;
  bodyH = 270;

  private pos = { x: 200, y: 200 };
  private vel = { x: 0, y: 0 };
  private prev = { x: 200, y: 200 };
  private state: LocoState = 'fall';
  private stateTime = 0;
  private facing: -1 | 1 = 1;
  private support: Surface | null = null;
  private plan: Action[] = [];
  private arc: Arc | null = null;
  private climbTarget: { y: number; target: Surface } | null = null;
  private goal: { x: number; y: number } | null = null;
  private goalTimer = 0;
  private lastGoalCursor = { x: -9999, y: -9999 };
  private cursorStill = 0;
  private lastCursor = { x: 0, y: 0 };
  private manualTarget: { x: number; y: number; until: number } | null = null;
  private roamTimer = 4;
  private time = 0;
  private grabOffset = { x: 0, y: 0 };
  private paused = false;
  private lastInput: WorldInput | null = null;

  constructor(settings?: Partial<CompanionSettings>) {
    if (settings) this.setSettings(settings);
  }

  // ------------------------------------------------------------------ API
  setSettings(s: Partial<CompanionSettings>) {
    this.settings = { ...this.settings, ...s };
    if (s.mode || s.enabled !== undefined) this.plan = [];
  }

  /**
   * Freeze her in place (e.g. while her context menu is open), so the menu is not a chase.
   * A jump already in the air is finished; walking stops at once.
   */
  setPaused(on: boolean) {
    this.paused = on;
    if (on) {
      const airborne = !['idle', 'walk', 'run', 'land', 'prejump'].includes(this.state);
      this.plan = airborne && this.plan[0]?.type === 'hop' ? [this.plan[0]] : [];
      this.goal = null;
      this.manualTarget = null;
      this.vel.x = airborne ? this.vel.x : 0;
    } else {
      this.goalTimer = 0.6; // small grace before she starts moving again
    }
  }

  isPaused() {
    return this.paused;
  }

  setMetrics(bodyW: number, bodyH: number) {
    if (Number.isFinite(bodyW) && Number.isFinite(bodyH) && bodyW > 10 && bodyH > 10) {
      this.bodyW = bodyW;
      this.bodyH = bodyH;
    }
  }

  /** Place her somewhere (she will fall to the nearest surface below). */
  dropIn(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = Number.isFinite(x) ? x : this.lastInput ? this.lastInput.bounds.x + this.lastInput.bounds.w / 2 : 200;
      y = Number.isFinite(y) ? y : this.lastInput ? this.lastInput.bounds.y + this.bodyH : 300;
    }
    this.pos = { x, y };
    this.prev = { x, y };
    this.vel = { x: 0, y: 0 };
    this.setState('fall');
    this.plan = [];
    this.arc = null;
    this.support = null;
  }

  /** Ask her to walk to a screen point (stand as close as possible). */
  walkTo(x: number, y: number, holdSeconds = 20) {
    this.manualTarget = { x, y, until: this.time + holdSeconds };
    this.plan = [];
    this.goalTimer = 0;
  }

  /** One-shot jump in a direction. Returns false if no reachable surface. */
  jump(direction: 'up' | 'down' | 'left' | 'right'): boolean {
    const inp = this.lastInput;
    if (!inp || !this.support || !this.isGrounded()) return false;
    const cands = this.standable(inp.surfaces).filter((s) => s !== this.support);
    let best: { s: Surface; d: number } | null = null;
    for (const s of cands) {
      const cx = clamp(this.pos.x, s.x0, s.x1);
      const dx = cx - this.pos.x;
      const dy = s.y - this.pos.y;
      let ok = false;
      if (direction === 'up') ok = dy < -10 && Math.abs(dx) < this.bodyW * 3;
      if (direction === 'down') ok = dy > 10 && Math.abs(dx) < this.bodyW * 3;
      if (direction === 'left') ok = s.x1 < this.support.x0 + 5 && Math.abs(dy) < this.bodyH;
      if (direction === 'right') ok = s.x0 > this.support.x1 - 5 && Math.abs(dy) < this.bodyH;
      if (!ok) continue;
      const d = Math.hypot(dx, dy);
      if (!best || d < best.d) best = { s, d };
    }
    if (!best) {
      // simple hop in place / sideways
      const dir = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
      const x = clamp(this.pos.x + dir * this.bodyW, this.support.x0, this.support.x1);
      this.plan = [{ type: 'hop', hop: 'jump', x, y: this.support.y, target: this.support }];
      return true;
    }
    const e = this.edge(this.support, this.pos.x, best.s);
    if (!e) return false;
    this.plan = [
      { type: 'walk', x: e.takeoff },
      { type: 'hop', hop: e.hop, x: e.land, y: best.s.y, target: best.s },
    ];
    this.manualTarget = { x: e.land, y: best.s.y, until: this.time + 15 };
    return true;
  }

  /** The world scrolled under her (browser): move everything she knows about. */
  shift(dx: number, dy: number) {
    this.pos.x += dx;
    this.pos.y += dy;
    this.prev.x += dx;
    this.prev.y += dy;
    if (this.arc) {
      this.arc.x0 += dx;
      this.arc.x1 += dx;
      this.arc.y0 += dy;
      this.arc.y1 += dy;
    }
    if (this.climbTarget) this.climbTarget.y += dy;
    this.plan = this.plan.map((a) => (a.type === 'walk' ? { ...a, x: a.x + dx } : { ...a, x: a.x + dx, y: a.y + dy }));
    if (this.goal) this.goal = { x: this.goal.x + dx, y: this.goal.y + dy };
    if (this.support) this.support = { ...this.support, x0: this.support.x0 + dx, x1: this.support.x1 + dx, y: this.support.y + dy };
  }

  getSupportId() {
    return this.support?.id ?? null;
  }

  grab(cursorX: number, cursorY: number) {
    this.grabOffset = { x: cursorX - this.pos.x, y: cursorY - this.pos.y };
    this.setState('grabbed');
    this.plan = [];
    this.arc = null;
    this.support = null;
  }

  release() {
    if (this.state !== 'grabbed') return;
    this.vel.x = clamp(this.vel.x, -900, 900);
    this.vel.y = clamp(this.vel.y, -900, 900);
    this.setState('fall');
  }

  isGrabbed() {
    return this.state === 'grabbed';
  }

  getPosition() {
    return { ...this.pos };
  }

  // ------------------------------------------------------------------ helpers
  private setState(s: LocoState) {
    if (this.state !== s) {
      this.state = s;
      this.stateTime = 0;
    }
  }

  private isGrounded() {
    return ['idle', 'walk', 'run', 'land', 'prejump'].includes(this.state);
  }

  private standable(surfaces: Surface[]) {
    return surfaces.filter((s) => s.x1 - s.x0 >= this.bodyW * 0.35);
  }

  private body(x = this.pos.x, y = this.pos.y): Rect {
    return { x: x - this.bodyW / 2, y: y - this.bodyH, w: this.bodyW, h: this.bodyH };
  }

  private findSupport(surfaces: Surface[], x: number, y: number, tol = 6, prefer?: Surface | null) {
    const m = this.bodyW * 0.12;
    if (prefer) {
      const same = surfaces.find(
        (s) => s.id === prefer.id && Math.abs(s.y - y) <= tol + 2 && x >= s.x0 - m && x <= s.x1 + m
      );
      if (same) return same;
    }
    let best: Surface | null = null;
    for (const s of surfaces) {
      if (x < s.x0 - m || x > s.x1 + m) continue;
      const d = Math.abs(s.y - y);
      if (d <= tol && (!best || d < Math.abs(best.y - y))) best = s;
    }
    return best;
  }

  /** Movement between two surfaces, or null if impossible. */
  private edge(A: Surface, ax: number, B: Surface) {
    const m = Math.min(this.bodyW * 0.2, (A.x1 - A.x0) / 2, (B.x1 - B.x0) / 2);
    const dy = B.y - A.y;
    let gap = 0;
    let takeoff: number;
    let land: number;
    if (B.x1 < A.x0) {
      gap = A.x0 - B.x1;
      takeoff = A.x0 + m;
      land = B.x1 - m;
    } else if (B.x0 > A.x1) {
      gap = B.x0 - A.x1;
      takeoff = A.x1 - m;
      land = B.x0 + m;
    } else {
      const o0 = Math.max(A.x0, B.x0) + m;
      const o1 = Math.min(A.x1, B.x1) - m;
      takeoff = o1 >= o0 ? clamp(ax, o0, o1) : (Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2;
      land = takeoff;
      if (dy > 0) {
        // dropping: prefer stepping off an end of A if B extends beyond it
        if (B.x0 < A.x0 - this.bodyW * 0.5 && Math.abs(ax - A.x0) < Math.abs(ax - A.x1)) {
          takeoff = A.x0 + m;
          land = Math.max(B.x0 + m, A.x0 - this.bodyW * 0.6);
        } else if (B.x1 > A.x1 + this.bodyW * 0.5) {
          takeoff = A.x1 - m;
          land = Math.min(B.x1 - m, A.x1 + this.bodyW * 0.6);
        }
      }
    }
    const walk = Math.abs(ax - takeoff);
    const maxGap = this.settings.maxGap * this.bodyW;
    const jumpUp = this.settings.maxJumpUp * this.bodyH;
    let hop: Hop;
    let cost: number;
    if (Math.abs(dy) < 5) {
      if (gap < 8) {
        hop = 'walkgap';
        cost = gap;
      } else if (gap <= maxGap) {
        hop = 'jump';
        cost = 40 + gap * 1.2;
      } else return null;
    } else if (dy < 0) {
      const up = -dy;
      if (up <= jumpUp && gap <= maxGap) {
        hop = 'jump';
        cost = 60 + up * 0.6 + gap * 1.2;
      } else if (gap <= this.bodyW * 0.7) {
        hop = 'climb';
        cost = 140 + up * 1.4 + gap;
        land = takeoff = gap > 0 ? takeoff : takeoff;
      } else return null;
    } else {
      if (gap > maxGap) return null;
      if (dy > this.bodyH * 2.6 && gap <= this.bodyW * 0.7) {
        hop = 'climb';
        cost = 90 + dy * 0.45;
      } else {
        hop = 'drop';
        cost = 30 + dy * 0.25 + gap * 1.2;
      }
    }
    return { hop, cost: cost + walk, takeoff, land };
  }

  private planTo(surfaces: Surface[], goalS: Surface, goalX: number): Action[] | null {
    const start = this.support;
    if (!start) return null;
    if (goalS.id === start.id) return [{ type: 'walk', x: goalX }];
    const nodes = this.standable(surfaces);
    if (!nodes.includes(start)) nodes.push(start);
    const dist = new Map<string, number>();
    const ax = new Map<string, number>();
    const prev = new Map<string, { from: Surface; e: NonNullable<ReturnType<CompanionEngine['edge']>> }>();
    const done = new Set<string>();
    dist.set(start.id, 0);
    ax.set(start.id, this.pos.x);
    for (let iter = 0; iter < nodes.length; iter++) {
      let u: Surface | null = null;
      let best = Infinity;
      for (const n of nodes) {
        const d = dist.get(n.id);
        if (d !== undefined && d < best && !done.has(n.id)) {
          best = d;
          u = n;
        }
      }
      if (!u) break;
      done.add(u.id);
      if (u.id === goalS.id) break;
      const ux = ax.get(u.id)!;
      for (const v of nodes) {
        if (done.has(v.id) || v.id === u.id) continue;
        const e = this.edge(u, ux, v);
        if (!e) continue;
        const nd = best + e.cost;
        if (nd < (dist.get(v.id) ?? Infinity)) {
          dist.set(v.id, nd);
          ax.set(v.id, e.land);
          prev.set(v.id, { from: u, e });
        }
      }
    }
    if (!prev.has(goalS.id)) return null;
    const hops: { from: Surface; to: Surface; e: NonNullable<ReturnType<CompanionEngine['edge']>> }[] = [];
    let cur = goalS;
    while (cur.id !== start.id) {
      const p = prev.get(cur.id)!;
      hops.unshift({ from: p.from, to: cur, e: p.e });
      cur = p.from;
    }
    const actions: Action[] = [];
    hops.forEach((h) => {
      actions.push({ type: 'walk', x: h.e.takeoff });
      actions.push({ type: 'hop', hop: h.e.hop, x: h.e.land, y: h.to.y, target: h.to });
    });
    actions.push({ type: 'walk', x: goalX });
    return actions;
  }

  private scoreSpot(inp: WorldInput, s: Surface, x: number, target: { x: number; y: number }, ideal: number) {
    const b = this.body(x, s.y);
    const area = b.w * b.h;
    const hx = x;
    const hy = s.y - this.bodyH * 0.86;
    const d = Math.hypot(target.x - hx, target.y - hy);
    let cost = Math.abs(d - ideal);
    // never stand on top of the cursor / caret
    if (target.x > b.x - 20 && target.x < b.x + b.w + 20 && target.y > b.y - 20 && target.y < b.y + b.h + 10)
      cost += 4000;
    for (const r of inp.protect) cost += (overlapArea(b, r) / area) * 6000;
    if (this.settings.avoidText) for (const r of inp.avoid) cost += (overlapArea(b, r) / area) * 1400;
    const B = inp.bounds;
    if (b.y < B.y) cost += ((B.y - b.y) / b.h) * 3000;
    if (b.x < B.x) cost += ((B.x - b.x) / b.w) * 2000;
    if (b.x + b.w > B.x + B.w) cost += ((b.x + b.w - B.x - B.w) / b.w) * 2000;
    cost += Math.abs(x - this.pos.x) * 0.08 + Math.abs(s.y - this.pos.y) * 0.08;
    if (s.kind === 'text') cost += 25; // prefer real edges over text lines
    if (this.support && s.id === this.support.id && Math.abs(x - this.pos.x) < 30) cost -= 45;
    return cost;
  }

  private chooseGoal(inp: WorldInput, target: { x: number; y: number }, ideal: number) {
    let best: { s: Surface; x: number; c: number } | null = null;
    const offsets = [0, ideal * 0.6, ideal * 0.9, ideal * 1.3, ideal * 1.8];
    for (const s of this.standable(inp.surfaces)) {
      const lo = s.x0 + Math.min(this.bodyW * 0.3, (s.x1 - s.x0) / 2);
      const hi = s.x1 - Math.min(this.bodyW * 0.3, (s.x1 - s.x0) / 2);
      const xs = new Set<number>();
      offsets.forEach((o) => {
        xs.add(clamp(target.x - o, lo, hi));
        xs.add(clamp(target.x + o, lo, hi));
      });
      if (this.support && s.id === this.support.id) xs.add(clamp(this.pos.x, lo, hi));
      xs.forEach((x) => {
        const c = this.scoreSpot(inp, s, x, target, ideal);
        if (!best || c < best.c) best = { s, x, c };
      });
    }
    return best as { s: Surface; x: number; c: number } | null;
  }

  // ------------------------------------------------------------------ update
  update(inp: WorldInput): CompanionOutput {
    const dt = clamp(Number.isFinite(inp.dt) ? inp.dt : 0, 0, 0.05);
    // self-heal: any invalid number (bad metrics, bad command) puts her back on screen
    if (!Number.isFinite(this.pos.x) || !Number.isFinite(this.pos.y) || !Number.isFinite(this.vel.x) || !Number.isFinite(this.vel.y)) {
      const B = inp.bounds;
      this.dropIn(B.x + B.w / 2, B.y + this.bodyH);
    }
    this.time += dt;
    this.stateTime += dt;
    this.lastInput = inp;
    const S = this.settings;
    this.prev = { ...this.pos };

    // cursor stillness
    if (Math.hypot(inp.cursor.x - this.lastCursor.x, inp.cursor.y - this.lastCursor.y) > 3) this.cursorStill = 0;
    else this.cursorStill += dt;
    this.lastCursor = { ...inp.cursor };

    const surfaces = inp.surfaces;

    switch (this.state) {
      case 'grabbed': {
        this.pos.x = inp.cursor.x - this.grabOffset.x;
        this.pos.y = inp.cursor.y - this.grabOffset.y;
        break;
      }
      case 'fall': {
        this.vel.y += S.gravity * dt;
        this.vel.x *= Math.pow(0.4, dt);
        const ny = this.pos.y + this.vel.y * dt;
        const nx = clamp(this.pos.x + this.vel.x * dt, inp.bounds.x + this.bodyW / 2, inp.bounds.x + inp.bounds.w - this.bodyW / 2);
        let landed: Surface | null = null;
        if (this.vel.y >= 0) {
          for (const s of surfaces) {
            if (nx < s.x0 || nx > s.x1) continue;
            if (s.y >= this.pos.y - 1 && s.y <= ny + 1 && (!landed || s.y < landed.y)) landed = s;
          }
        }
        if (landed) {
          this.pos = { x: nx, y: landed.y };
          this.support = landed;
          this.vel = { x: 0, y: 0 };
          this.setState('land');
          this.plan = [];
        } else {
          this.pos = { x: nx, y: ny };
          const bottom = inp.bounds.y + inp.bounds.h;
          if (this.pos.y > bottom + this.bodyH) this.dropIn(this.pos.x, inp.bounds.y + this.bodyH);
        }
        break;
      }
      case 'jump': {
        const a = this.arc!;
        a.t += dt;
        const u = a.T > 0 ? clamp(a.t / a.T, 0, 1) : 1;
        this.pos.x = a.x0 + (a.x1 - a.x0) * u;
        this.pos.y = a.y0 + (a.y1 - a.y0) * u - a.h * 4 * u * (1 - u);
        if (u >= 1) {
          this.arc = null;
          const s = this.findSupport(surfaces, a.x1, a.y1, 10, a.target);
          if (s) {
            this.pos.y = s.y;
            this.support = s;
            this.setState('land');
          } else {
            this.vel = { x: 0, y: 200 };
            this.setState('fall');
            this.lastGoalCursor = { x: -9999, y: -9999 }; // re-plan after the fall
          }
          this.plan.shift();
        }
        break;
      }
      case 'climb':
      case 'climb_down': {
        const c = this.climbTarget!;
        const dir = Math.sign(c.y - this.pos.y);
        const step = S.climbSpeed * dt;
        if (Math.abs(c.y - this.pos.y) <= step) {
          this.pos.y = c.y;
          const s = this.findSupport(surfaces, this.pos.x, c.y, 10, c.target);
          this.climbTarget = null;
          this.plan.shift();
          if (s) {
            this.support = s;
            this.setState('land');
          } else {
            this.vel = { x: 0, y: 0 };
            this.setState('fall');
          }
        } else this.pos.y += dir * step;
        break;
      }
      default: {
        // grounded: validate support
        const s = this.findSupport(surfaces, this.pos.x, this.pos.y, 7, this.support);
        if (!s) {
          this.support = null;
          this.vel = { x: 0, y: 0 };
          this.plan = [];
          this.setState('fall');
          break;
        }
        this.support = s;
        this.pos.y += (s.y - this.pos.y) * Math.min(1, dt * 20);

        if (this.state === 'land' && this.stateTime < 0.16) break;
        if (this.state === 'prejump') {
          if (this.stateTime >= 0.12) this.startHop();
          break;
        }

        this.think(inp);
        this.execute(inp, dt);
      }
    }

    // velocity estimate
    this.vel.x = this.state === 'fall' ? this.vel.x : (this.pos.x - this.prev.x) / Math.max(dt, 1e-3);
    if (this.state !== 'fall') this.vel.y = (this.pos.y - this.prev.y) / Math.max(dt, 1e-3);
    if (this.state === 'grabbed') {
      this.vel.x = (this.pos.x - this.prev.x) / Math.max(dt, 1e-3);
      this.vel.y = (this.pos.y - this.prev.y) / Math.max(dt, 1e-3);
    }

    // facing & gaze
    const tgt = inp.caret ? { x: inp.caret.x + inp.caret.w / 2, y: inp.caret.y + inp.caret.h / 2 } : inp.cursor;
    if (this.state === 'idle' || this.state === 'land') this.facing = tgt.x >= this.pos.x ? 1 : -1;
    const hx = this.pos.x;
    const hy = this.pos.y - this.bodyH * 0.86;
    const lookX = clamp((tgt.x - hx) / 500, -1, 1);
    const lookY = clamp((hy - tgt.y) / 350, -1, 1);

    let state = this.state;
    if (state === 'jump' && this.arc) {
      const u = this.arc.t / this.arc.T;
      if (u > 0.5 && this.arc.y1 >= this.arc.y0 - this.arc.h) state = 'fall';
    }
    const speed = Math.abs(this.vel.x) / this.bodyH;
    return {
      x: this.pos.x,
      y: this.pos.y,
      state,
      facing: this.facing,
      speedBH: state === 'climb' || state === 'climb_down' ? S.climbSpeed / this.bodyH : speed,
      vx: this.vel.x,
      vy: this.vel.y,
      lookX,
      lookY,
      surfaceKind: this.support?.kind ?? null,
      body: this.body(),
      goal: this.goal,
      mode: S.mode,
      enabled: S.enabled,
    };
  }

  /** Decide whether to pick a new destination. */
  private think(inp: WorldInput) {
    const S = this.settings;
    if (this.paused) return;
    this.goalTimer -= inp.dt;
    if (this.goalTimer > 0) return;
    this.goalTimer = 0.4;

    if (this.manualTarget && this.time > this.manualTarget.until) this.manualTarget = null;

    let target: { x: number; y: number } | null = null;
    let ideal = S.followDistance * this.bodyH;
    if (this.manualTarget) {
      target = this.manualTarget;
      ideal = this.bodyH * 0.5;
    } else if (!S.enabled || S.mode === 'stay') {
      return;
    } else if (S.mode === 'roam') {
      this.roamTimer -= 0.4;
      if (this.roamTimer > 0 && this.plan.length) return;
      if (this.roamTimer > 0 && this.goal) return;
      this.roamTimer = 7 + Math.random() * 9;
      const B = inp.bounds;
      target = { x: B.x + Math.random() * B.w, y: B.y + Math.random() * B.h };
      ideal = 0;
    } else {
      target = inp.caret ? { x: inp.caret.x + inp.caret.w / 2, y: inp.caret.y + inp.caret.h / 2 } : inp.cursor;
      const moved = Math.hypot(target.x - this.lastGoalCursor.x, target.y - this.lastGoalCursor.y);
      const b = this.body();
      const area = b.w * b.h;
      const bad =
        inp.protect.some((r) => overlapArea(b, r) / area > 0.04) ||
        (target.x > b.x - 10 && target.x < b.x + b.w + 10 && target.y > b.y - 10 && target.y < b.y + b.h);
      const offscreen = b.y < inp.bounds.y - b.h * 0.25;
      const far = Math.hypot(target.x - this.pos.x, target.y - (this.pos.y - this.bodyH * 0.86)) > ideal * 2.2;
      const settled = this.cursorStill > 0.35 || !!inp.caret;
      if (!bad && !offscreen && !(settled && (moved > this.bodyW || far))) return;
      if (!bad && !offscreen && !settled) return;
    }

    this.lastGoalCursor = { ...target };
    const g = this.chooseGoal(inp, target, ideal);
    if (!g) return;
    if (this.support && g.s.id === this.support.id && Math.abs(g.x - this.pos.x) < 24) {
      this.plan = [];
      this.goal = null;
      return;
    }
    const p = this.planTo(inp.surfaces, g.s, g.x);
    if (p) {
      this.plan = p;
      this.goal = { x: g.x, y: g.s.y };
    }
  }

  private execute(inp: WorldInput, dt: number) {
    const a = this.plan[0];
    if (!a) {
      if (this.state !== 'land' || this.stateTime > 0.16) this.setState('idle');
      if (this.manualTarget && !this.plan.length && this.goal === null) this.manualTarget = null;
      return;
    }
    if (a.type === 'walk') {
      const sup = this.support!;
      const tx = clamp(a.x, sup.x0, sup.x1);
      const dx = tx - this.pos.x;
      if (Math.abs(dx) < 2) {
        this.pos.x = tx;
        this.plan.shift();
        if (!this.plan.length) {
          this.goal = null;
          this.setState('idle');
        }
        return;
      }
      const remaining = this.plan.reduce((acc, p, i) => {
        if (p.type === 'walk') return acc + Math.abs(p.x - (i === 0 ? this.pos.x : p.x));
        return acc + 150;
      }, 0);
      // strolling (roam) walks; following runs when far away
      const run = this.settings.mode === 'roam' ? remaining > 1400 : remaining > 520 || Math.abs(dx) > 420;
      const v = run ? this.settings.runSpeed : this.settings.walkSpeed;
      // accelerate gently
      const curV = Math.min(v, Math.abs(this.vel.x) + v * 4 * dt + 20);
      this.pos.x += Math.sign(dx) * Math.min(curV * dt, Math.abs(dx));
      this.facing = dx > 0 ? 1 : -1;
      this.setState(run ? 'run' : 'walk');
      return;
    }
    // hop
    this.facing = a.x > this.pos.x + 2 ? 1 : a.x < this.pos.x - 2 ? -1 : this.facing;
    if (a.hop === 'walkgap') {
      this.pos.x = a.x;
      this.pos.y = a.y;
      this.support = a.target;
      this.plan.shift();
      return;
    }
    if (a.hop === 'climb') {
      this.climbTarget = { y: a.y, target: a.target };
      this.pos.x = a.x;
      this.setState(a.y < this.pos.y ? 'climb' : 'climb_down');
      return;
    }
    this.setState('prejump');
  }

  private startHop() {
    const a = this.plan[0];
    if (!a || a.type !== 'hop') {
      this.setState('idle');
      return;
    }
    const dx = a.x - this.pos.x;
    const dy = a.y - this.pos.y;
    const dist = Math.hypot(dx, dy);
    let h: number;
    let T: number;
    if (a.hop === 'drop') {
      h = this.bodyH * 0.12 + Math.abs(dx) * 0.1;
      T = clamp(Math.sqrt((2 * Math.max(dy, 1)) / this.settings.gravity) + 0.22, 0.3, 1.1);
    } else {
      h = this.bodyH * 0.3 + Math.max(0, -dy) * 0.35;
      T = clamp(0.38 + dist / 1100, 0.4, 0.85);
    }
    this.arc = { x0: this.pos.x, y0: this.pos.y, x1: a.x, y1: a.y, h, T, t: 0, target: a.target };
    this.support = null;
    this.setState('jump');
  }
}
