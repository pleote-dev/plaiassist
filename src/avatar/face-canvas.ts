import * as THREE from 'three';

/**
 * Anime face painted on a canvas and mapped onto a decal that shares the exact
 * vertices of the head mesh (with polygon offset). Eyes, nose and mouth can
 * therefore never end up "behind" the face — they are part of its surface.
 *
 * Coordinates below are in head-local metres (head centre = origin, +z = front).
 */
export const FACE_REGION = { x0: -0.12, x1: 0.12, y0: -0.16, y1: 0.08 };

export interface FaceDrawState {
  leftOpen: number; // character's left eye (+x)
  rightOpen: number; // character's right eye (-x)
  lookX: number; // -1..1 (+ = towards +x / screen right)
  lookY: number; // -1..1 (+ = up)
  smile: number; // -1..1
  mouthOpen: number; // 0..1
  mouthWidth: number; // ~0.6..1.2 (viseme)
  mouthRound: number; // 0..1 (viseme O/U)
  browRaise: number; // -1..1
  browTilt: number; // -1..1 (+ = inner ends up / worried)
  browAsym: number; // -1..1 (+ = left brow higher)
  blush: number; // 0..1
  happyEyes: number; // 0..1 (closed smiling ^^ eyes)
  squint: number; // -1..1 (lower lid raise)
  irisColor: string;
  browColor: string;
}

export const EYE = { x: 0.044, y: -0.018, w: 0.0215, h: 0.026 };
const MOUTH_Y = -0.087;

type P = [number, number];

export class FaceCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private S: number;
  private lastKey = '';

  constructor(size = 1024) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.S = size;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  private px(x: number) {
    return ((x - FACE_REGION.x0) / (FACE_REGION.x1 - FACE_REGION.x0)) * this.S;
  }
  private py(y: number) {
    return ((FACE_REGION.y1 - y) / (FACE_REGION.y1 - FACE_REGION.y0)) * this.S;
  }
  private len(l: number) {
    return (l / (FACE_REGION.x1 - FACE_REGION.x0)) * this.S;
  }

  draw(s: FaceDrawState) {
    const key = Object.values(s)
      .map((v) => (typeof v === 'number' ? v.toFixed(3) : v))
      .join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    const c = this.ctx;
    c.clearRect(0, 0, this.S, this.S);
    c.lineCap = 'round';
    c.lineJoin = 'round';

    this.drawBlush(s);
    this.drawNose();
    this.drawMouth(s);
    this.drawEye(-1, s.rightOpen, s);
    this.drawEye(1, s.leftOpen, s);
    this.drawBrow(-1, s);
    this.drawBrow(1, s);

    this.texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------- eyes
  private eyeCurves(sgn: number, open: number, s: FaceDrawState) {
    const { w, h } = EYE;
    const ex = sgn * EYE.x;
    const ey = EYE.y;
    const n = 28;
    const happy = s.happyEyes;
    const o = Math.max(0, Math.min(1, open)) * (1 - happy);
    const sq = s.squint;
    const top: P[] = [];
    const bot: P[] = [];
    for (let i = 0; i <= n; i++) {
      const u = -1 + (2 * i) / n;
      const uu = 1 - u * u;
      const tilt = 0.14 * u * h; // outer corner slightly higher (cat-eye)
      const openTop = ey + h * 0.95 * Math.pow(uu, 0.5) * (1 - Math.max(0, sq) * 0.12) + tilt;
      const openBot = ey - h * 0.8 * Math.pow(uu, 0.8) + tilt + sq * 0.32 * h * uu;
      const closedL = ey - h * 0.2 * uu + tilt;
      const happyL = ey + h * 0.32 * uu + tilt - 0.12 * h;
      const cl = closedL + (happyL - closedL) * happy;
      const x = ex + sgn * u * w;
      top.push([x, cl + (openTop - cl) * o]);
      bot.push([x, cl + (Math.min(openBot, openTop) - cl) * o]);
    }
    return { top, bot, o, ex, ey };
  }

  private drawEye(sgn: number, open: number, s: FaceDrawState) {
    const c = this.ctx;
    const { w, h } = EYE;
    const { top, bot, o, ex, ey } = this.eyeCurves(sgn, open, s);

    if (o > 0.06) {
      // Sclera
      c.save();
      c.beginPath();
      top.forEach(([x, y], i) => (i ? c.lineTo(this.px(x), this.py(y)) : c.moveTo(this.px(x), this.py(y))));
      for (let i = bot.length - 1; i >= 0; i--) c.lineTo(this.px(bot[i][0]), this.py(bot[i][1]));
      c.closePath();
      c.fillStyle = '#FFF8EC';
      c.fill();
      c.clip();

      // Iris
      const cx = ex + s.lookX * w * 0.38;
      const cy = ey - 0.06 * h + s.lookY * h * 0.22;
      const rx = 0.6 * w;
      const ry = 0.8 * h;
      const g = c.createLinearGradient(0, this.py(cy + ry), 0, this.py(cy - ry));
      g.addColorStop(0, '#0E0805');
      g.addColorStop(0.42, s.irisColor);
      g.addColorStop(0.85, '#D9A548');
      g.addColorStop(1, '#F2CF7A');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(this.px(cx), this.py(cy), this.len(rx), this.len(ry), 0, 0, Math.PI * 2);
      c.fill();
      c.lineWidth = this.len(0.0009);
      c.strokeStyle = '#0B0604';
      c.stroke();

      // Pupil
      c.fillStyle = '#060404';
      c.beginPath();
      c.ellipse(this.px(cx), this.py(cy + 0.08 * ry), this.len(rx * 0.36), this.len(ry * 0.42), 0, 0, Math.PI * 2);
      c.fill();

      // Gold inner glow (lower crescent)
      const rg = c.createRadialGradient(
        this.px(cx), this.py(cy - ry * 0.55), 0,
        this.px(cx), this.py(cy - ry * 0.55), this.len(rx * 0.95)
      );
      rg.addColorStop(0, 'rgba(255,214,120,0.55)');
      rg.addColorStop(1, 'rgba(255,214,120,0)');
      c.fillStyle = rg;
      c.beginPath();
      c.ellipse(this.px(cx), this.py(cy), this.len(rx), this.len(ry), 0, 0, Math.PI * 2);
      c.fill();

      // Catchlights (light from upper-left, same for both eyes)
      c.fillStyle = 'rgba(255,255,255,0.96)';
      c.beginPath();
      c.ellipse(this.px(cx - rx * 0.36), this.py(cy + ry * 0.4), this.len(rx * 0.3), this.len(ry * 0.22), -0.5, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.ellipse(this.px(cx + rx * 0.34), this.py(cy - ry * 0.4), this.len(rx * 0.12), this.len(rx * 0.1), 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,236,190,0.8)';
      c.beginPath();
      c.ellipse(this.px(cx + rx * 0.05), this.py(cy + ry * 0.62), this.len(rx * 0.07), this.len(rx * 0.07), 0, 0, Math.PI * 2);
      c.fill();

      // Upper-lid shadow
      const sg = c.createLinearGradient(0, this.py(ey + h), 0, this.py(ey + 0.15 * h));
      sg.addColorStop(0, 'rgba(70,35,20,0.42)');
      sg.addColorStop(1, 'rgba(70,35,20,0)');
      c.fillStyle = sg;
      c.fillRect(this.px(ex - w * 1.2), this.py(ey + h * 1.2), this.len(w * 2.4), this.len(h * 1.4));
      c.restore();

      // Lower lash line
      c.strokeStyle = 'rgba(40,20,14,0.75)';
      c.lineWidth = this.len(0.0011);
      c.beginPath();
      let first = true;
      bot.forEach(([x, y]) => {
        const u = (x - ex) / (sgn * w);
        if (u < 0.15 || u > 0.98) return;
        if (first) c.moveTo(this.px(x), this.py(y));
        else c.lineTo(this.px(x), this.py(y));
        first = false;
      });
      c.stroke();

      // Double-eyelid crease
      c.strokeStyle = `rgba(130,80,55,${0.38 * o})`;
      c.lineWidth = this.len(0.0009);
      c.beginPath();
      first = true;
      top.forEach(([x, y]) => {
        const u = (x - ex) / (sgn * w);
        if (u < -0.45 || u > 0.85) return;
        const yy = y + 0.0062 * o;
        if (first) c.moveTo(this.px(x), this.py(yy));
        else c.lineTo(this.px(x), this.py(yy));
        first = false;
      });
      c.stroke();
    }

    // Thick upper lash with outer wing (noir eyeliner)
    const th = (u: number) => {
      const t = Math.max(0, Math.min(1, (u + 0.6) / 1.6));
      return 0.0013 + 0.0032 * t * t * (3 - 2 * t);
    };
    const pts = top.filter(([x]) => {
      const u = (x - ex) / (sgn * w);
      return u >= -0.95;
    });
    const end = top[top.length - 1];
    const wing: P = [ex + sgn * w * 1.34, end[1] + h * (0.12 + 0.2 * Math.max(o, 0.25))];
    c.fillStyle = '#100A08';
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(this.px(x), this.py(y - 0.0004)) : c.moveTo(this.px(x), this.py(y - 0.0004))));
    c.lineTo(this.px(wing[0]), this.py(wing[1]));
    for (let i = pts.length - 1; i >= 0; i--) {
      const [x, y] = pts[i];
      const u = (x - ex) / (sgn * w);
      c.lineTo(this.px(x), this.py(y + th(u)));
    }
    c.closePath();
    c.fill();

    // A few outer lashes
    if (o > 0.3) {
      c.strokeStyle = '#100A08';
      c.lineWidth = this.len(0.0011);
      [0.55, 0.78].forEach((u0, k) => {
        const idx = Math.round(((u0 + 1) / 2) * (top.length - 1));
        const [x, y] = top[idx];
        c.beginPath();
        c.moveTo(this.px(x), this.py(y + th(u0) * 0.8));
        c.quadraticCurveTo(
          this.px(x + sgn * 0.003), this.py(y + th(u0) + 0.003),
          this.px(x + sgn * (0.005 + k * 0.002)), this.py(y + th(u0) + 0.0045)
        );
        c.stroke();
      });
    }
  }

  private drawBrow(sgn: number, s: FaceDrawState) {
    const c = this.ctx;
    const { w, h } = EYE;
    const ex = sgn * EYE.x;
    const base =
      EYE.y + h + 0.012 + s.browRaise * 0.0065 + sgn * s.browAsym * 0.004 - Math.max(0, s.squint) * 0.002;
    const inner: P = [ex - sgn * w * 0.85, base + s.browTilt * 0.0065 - 0.001];
    const outer: P = [ex + sgn * w * 1.25, base - 0.0025 - s.browTilt * 0.002];
    const ctrl: P = [(inner[0] + outer[0]) / 2, Math.max(inner[1], outer[1]) + 0.0045 * (1 - Math.max(0, s.browTilt) * 0.5)];
    const n = 16;
    const upper: P[] = [];
    const lower: P[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = (1 - t) * (1 - t) * inner[0] + 2 * (1 - t) * t * ctrl[0] + t * t * outer[0];
      const y = (1 - t) * (1 - t) * inner[1] + 2 * (1 - t) * t * ctrl[1] + t * t * outer[1];
      const thk = 0.0027 * (1 - t) + 0.0007 * t;
      upper.push([x, y + thk * 0.5]);
      lower.push([x, y - thk * 0.5]);
    }
    c.fillStyle = s.browColor;
    c.beginPath();
    upper.forEach(([x, y], i) => (i ? c.lineTo(this.px(x), this.py(y)) : c.moveTo(this.px(x), this.py(y))));
    for (let i = lower.length - 1; i >= 0; i--) c.lineTo(this.px(lower[i][0]), this.py(lower[i][1]));
    c.closePath();
    c.fill();
  }

  // ---------------------------------------------------------------- nose
  private drawNose() {
    const c = this.ctx;
    c.strokeStyle = 'rgba(160,95,70,0.5)';
    c.lineWidth = this.len(0.0013);
    c.beginPath();
    c.moveTo(this.px(0.0035), this.py(-0.043));
    c.quadraticCurveTo(this.px(0.0068), this.py(-0.055), this.px(0.0018), this.py(-0.0592));
    c.stroke();
    c.fillStyle = 'rgba(150,85,65,0.35)';
    c.beginPath();
    c.ellipse(this.px(-0.0022), this.py(-0.0596), this.len(0.0013), this.len(0.0008), 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.beginPath();
    c.ellipse(this.px(-0.0012), this.py(-0.0505), this.len(0.0011), this.len(0.0016), 0, 0, Math.PI * 2);
    c.fill();
  }

  // ---------------------------------------------------------------- mouth
  private drawMouth(s: FaceDrawState) {
    const c = this.ctx;
    const smile = s.smile;
    const round = s.mouthRound;
    const grin = Math.max(0, smile - 0.8) * 0.9;
    const eo = Math.max(s.mouthOpen, grin);
    const mw = 0.0165 * (1 + 0.25 * Math.max(0, smile)) * s.mouthWidth * (1 - 0.38 * round);
    const cy = MOUTH_Y;
    const cu = smile * 0.0068; // corners up/down
    const L: P = [-mw, cy + cu];
    const R: P = [mw, cy + cu];

    if (eo < 0.06) {
      c.strokeStyle = '#5A2622';
      c.lineWidth = this.len(0.0021);
      c.beginPath();
      c.moveTo(this.px(L[0]), this.py(L[1]));
      c.quadraticCurveTo(this.px(0), this.py(cy - smile * 0.0085 - 0.0008), this.px(R[0]), this.py(R[1]));
      c.stroke();
      // corner ticks (dimples) when smiling
      if (smile > 0.3) {
        c.lineWidth = this.len(0.0011);
        [L, R].forEach(([x, y], i) => {
          const sg = i ? 1 : -1;
          c.beginPath();
          c.moveTo(this.px(x - sg * 0.0012), this.py(y - 0.0008));
          c.lineTo(this.px(x + sg * 0.0012), this.py(y + 0.0016));
          c.stroke();
        });
      }
      // lower lip hint
      c.strokeStyle = 'rgba(190,100,90,0.35)';
      c.lineWidth = this.len(0.0016);
      c.beginPath();
      c.moveTo(this.px(-0.004), this.py(cy - 0.0062 - smile * 0.004));
      c.quadraticCurveTo(this.px(0), this.py(cy - 0.0078 - smile * 0.004), this.px(0.004), this.py(cy - 0.0062 - smile * 0.004));
      c.stroke();
      return;
    }

    const depth = 0.004 + eo * 0.024 + Math.max(0, smile) * 0.006;
    c.save();
    c.beginPath();
    if (round > 0.5) {
      c.ellipse(this.px(0), this.py(cy - depth * 0.4), this.len(mw * 0.95), this.len(depth * 0.62), 0, 0, Math.PI * 2);
    } else {
      c.moveTo(this.px(L[0]), this.py(L[1]));
      c.quadraticCurveTo(this.px(0), this.py(cy + cu * 0.25 + round * 0.004), this.px(R[0]), this.py(R[1]));
      c.quadraticCurveTo(this.px(mw * 0.55), this.py(cy - depth), this.px(0), this.py(cy - depth));
      c.quadraticCurveTo(this.px(-mw * 0.55), this.py(cy - depth), this.px(L[0]), this.py(L[1]));
    }
    c.closePath();
    c.fillStyle = '#5E1B22';
    c.fill();
    c.clip();
    // tongue
    c.fillStyle = '#D9707C';
    c.beginPath();
    c.ellipse(this.px(0), this.py(cy - depth * 0.95), this.len(mw * 0.7), this.len(depth * 0.45), 0, 0, Math.PI * 2);
    c.fill();
    // upper teeth
    if (eo > 0.16 || smile > 0.6) {
      c.fillStyle = '#FFFAF2';
      c.fillRect(this.px(-mw), this.py(cy + cu + 0.002), this.len(2 * mw), this.len(0.0028 + Math.abs(cu) * 0.6));
    }
    c.restore();
    c.strokeStyle = '#3A1512';
    c.lineWidth = this.len(0.0012);
    c.stroke();
  }

  // ---------------------------------------------------------------- blush
  private drawBlush(s: FaceDrawState) {
    const c = this.ctx;
    const a = 0.12 + s.blush * 0.38;
    [-1, 1].forEach((sg) => {
      const x = sg * 0.06;
      const y = -0.048;
      const g = c.createRadialGradient(this.px(x), this.py(y), 0, this.px(x), this.py(y), this.len(0.021));
      g.addColorStop(0, `rgba(255,120,105,${a})`);
      g.addColorStop(1, 'rgba(255,120,105,0)');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(this.px(x), this.py(y), this.len(0.024), this.len(0.015), 0, 0, Math.PI * 2);
      c.fill();
      if (s.blush > 0.35) {
        c.strokeStyle = `rgba(220,90,80,${(s.blush - 0.35) * 0.9})`;
        c.lineWidth = this.len(0.0008);
        for (let k = -1; k <= 1; k++) {
          c.beginPath();
          c.moveTo(this.px(x + k * 0.005 - 0.002), this.py(y - 0.003));
          c.lineTo(this.px(x + k * 0.005 + 0.002), this.py(y + 0.003));
          c.stroke();
        }
      }
    });
  }
}
