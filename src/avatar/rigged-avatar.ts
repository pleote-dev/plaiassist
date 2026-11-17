import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FaceCanvas, FaceDrawState, FACE_REGION } from './face-canvas';
import { StrandSystem, StrandDef, Collider } from './strands';

// ============================================================================
// Public types
// ============================================================================

export type PoseName =
  | 'idle'
  | 'pointing'
  | 'waving'
  | 'thinking'
  | 'happy'
  | 'explaining'
  | 'listening'
  | 'shrugging'
  | 'nodding'
  | 'shaking_head'
  | 'greeting'
  | 'celebrating'
  | 'focused'
  | 'dancing';

export type EmotionName =
  | 'neutral'
  | 'happy'
  | 'excited'
  | 'thinking'
  | 'curious'
  | 'surprised'
  | 'sad'
  | 'concerned'
  | 'confident'
  | 'playful'
  | 'wink';

export type HandGesture = 'relaxed' | 'open' | 'fist' | 'point' | 'peace' | 'thumbsUp';
export type LocoAnim =
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

export type Viseme = 'rest' | 'A' | 'E' | 'I' | 'O' | 'U' | 'M' | 'F' | 'C';

export interface JointEuler {
  x?: number;
  y?: number;
  z?: number;
}

type Side = 'left' | 'right';
type FingerName = 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Pinky';
export type FingerJointName = `${Side}${FingerName}${1 | 2 | 3}`;

export type BodyJointName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftClavicle'
  | 'leftShoulder'
  | 'leftElbow'
  | 'leftWrist'
  | 'rightClavicle'
  | 'rightShoulder'
  | 'rightElbow'
  | 'rightWrist'
  | 'leftHip'
  | 'leftKnee'
  | 'leftAnkle'
  | 'rightHip'
  | 'rightKnee'
  | 'rightAnkle';

export type JointName = BodyJointName | FingerJointName;

export type OutfitStyle = 'casual' | 'formal' | 'sporty' | 'elegant' | 'cyberpunk' | 'fantasy';

export interface AppearanceConfig {
  hairColor: string;
  eyeColor: string;
  skinTone: string;
  outfit: string;
  headphoneColor?: string;
  clothingColor?: string;
  shoeColor?: string;
  accessoryColor?: string;
  // Face tab of the configuration window
  faceShape?: FaceShape | string;
  faceRoundness?: number | string; // 0..100 (50 = default)
  eyeStyle?: EyeStyle | string;
  eyeSize?: number | string; // 20..100 (50 = default)
  noseSize?: number | string; // 20..100 (50 = default)
  mouthSize?: number | string; // 20..100 (50 = default)
  hairStyle?: HairStyle | string;
  // Body tab
  bodyType?: BodyType | string;
  bodyHeight?: number | string; // 100..200 (150 = default)
  bodyWidth?: number | string; // 50..150 (100 = default)
  shoulderWidth?: number | string; // 50..150 % (100 = default)
  waistSize?: number | string; // 50..120 % (80 = default)
}

export type BodyType = 'average' | 'athletic' | 'slim' | 'curvy';

const BODY_TYPES: Record<BodyType, { width: number; shoulder: number; waist: number; hip: number; bust: number; limb: number; leg: number }> = {
  average: { width: 1, shoulder: 1, waist: 1, hip: 1, bust: 1, limb: 1, leg: 1 },
  athletic: { width: 1.03, shoulder: 1.1, waist: 1.06, hip: 0.96, bust: 0.85, limb: 1.1, leg: 1.02 },
  slim: { width: 0.9, shoulder: 0.95, waist: 0.88, hip: 0.92, bust: 0.8, limb: 0.86, leg: 1.03 },
  curvy: { width: 1.04, shoulder: 0.98, waist: 0.86, hip: 1.15, bust: 1.3, limb: 1.05, leg: 1 },
};

export type FaceShape = 'oval' | 'round' | 'square' | 'heart';
export type EyeStyle = 'normal' | 'large' | 'almond' | 'cat';
export type HairStyle = 'long' | 'short' | 'curly' | 'ponytail';

interface HeadParams {
  taper1: number;
  taper2: number;
  chinPoint: number;
  cheek: number;
  cheekT: number;
  yLow: number;
  nose: number;
}

const FACE_SHAPES: Record<FaceShape, Omit<HeadParams, 'nose'>> = {
  oval: { taper1: 0.3, taper2: 0.12, chinPoint: 0, cheek: 0.035, cheekT: 0.3, yLow: 1.13 },
  round: { taper1: 0.17, taper2: 0.06, chinPoint: 0.08, cheek: 0.075, cheekT: 0.38, yLow: 1.05 },
  square: { taper1: 0.09, taper2: 0.04, chinPoint: 0.26, cheek: 0.02, cheekT: 0.3, yLow: 1.08 },
  heart: { taper1: 0.36, taper2: 0.2, chinPoint: 0.05, cheek: 0.07, cheekT: 0.12, yLow: 1.17 },
};

const EYE_STYLES: Record<EyeStyle, { w: number; h: number; tilt: number; wing: number }> = {
  normal: { w: 1, h: 1, tilt: 0.14, wing: 1 },
  large: { w: 1.12, h: 1.2, tilt: 0.1, wing: 0.8 },
  almond: { w: 1.1, h: 0.8, tilt: 0.22, wing: 1.15 },
  cat: { w: 1.06, h: 0.88, tilt: 0.34, wing: 1.7 },
};

export interface FacialState {
  emotion: EmotionName;
  mouthOpen: number;
  smile: number;
  eyebrowTilt: number; // + = inner ends up (worried), - = frown
  eyebrowRaise: number;
  leftEyeOpen: number;
  rightEyeOpen: number;
  lookAt: { x: number; y: number };
  blush?: number;
  happyEyes?: number;
  squint?: number;
  browAsym?: number;
}

// ============================================================================
// Anatomical joint limits
//
// Convention (identical for both sides — mirroring handled internally):
//   x = flexion / extension  (shoulder & hip: negative = raise limb forward;
//                             elbow: negative = bend; knee: positive = bend;
//                             fingers: positive = curl)
//   y = twist / rotation     (shoulder: positive = external rotation)
//   z = abduction            (positive = away from the body's midline)
// ============================================================================

interface JointLimits {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

const BODY_LIMITS: Record<string, JointLimits> = {
  hips: { x: [-0.35, 0.35], y: [-0.6, 0.6], z: [-0.25, 0.25] },
  spine: { x: [-0.35, 0.5], y: [-0.5, 0.5], z: [-0.3, 0.3] },
  chest: { x: [-0.3, 0.35], y: [-0.45, 0.45], z: [-0.25, 0.25] },
  neck: { x: [-0.5, 0.5], y: [-0.7, 0.7], z: [-0.35, 0.35] },
  head: { x: [-0.5, 0.5], y: [-0.8, 0.8], z: [-0.4, 0.4] },
  Clavicle: { x: [-0.2, 0.2], y: [-0.3, 0.3], z: [-0.15, 0.4] },
  Shoulder: { x: [-3.0, 0.9], y: [-1.4, 1.6], z: [-0.35, 2.9] },
  Elbow: { x: [-2.5, 0], y: [-1.4, 1.4], z: [-0.05, 0.05] },
  Wrist: { x: [-1.2, 1.1], y: [-0.3, 0.3], z: [-0.5, 0.4] },
  Hip: { x: [-1.9, 0.5], y: [-0.6, 0.6], z: [-0.3, 0.9] },
  Knee: { x: [0, 2.4], y: [-0.1, 0.1], z: [0, 0] },
  Ankle: { x: [-0.7, 0.8], y: [-0.3, 0.3], z: [-0.3, 0.3] },
  Finger1: { x: [-0.2, 1.6], y: [0, 0], z: [-0.35, 0.35] },
  Finger2: { x: [0, 1.8], y: [0, 0], z: [0, 0] },
  Finger3: { x: [0, 1.3], y: [0, 0], z: [0, 0] },
  Thumb1: { x: [-0.3, 0.9], y: [0, 0], z: [-0.5, 0.6] },
  Thumb2: { x: [0, 1.0], y: [0, 0], z: [0, 0] },
  Thumb3: { x: [0, 1.2], y: [0, 0], z: [0, 0] },
};

const FINGERS: FingerName[] = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

export const BODY_JOINTS: BodyJointName[] = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftClavicle', 'leftShoulder', 'leftElbow', 'leftWrist',
  'rightClavicle', 'rightShoulder', 'rightElbow', 'rightWrist',
  'leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle',
];

export const ALL_JOINTS: JointName[] = [
  ...BODY_JOINTS,
  ...(['left', 'right'] as Side[]).flatMap((s) =>
    FINGERS.flatMap((f) => [1, 2, 3].map((n) => `${s}${f}${n}` as FingerJointName))
  ),
];

function limitsFor(name: JointName): JointLimits {
  if (BODY_LIMITS[name]) return BODY_LIMITS[name];
  const m = name.match(/^(left|right)(Thumb|Index|Middle|Ring|Pinky)([123])$/);
  if (m) return BODY_LIMITS[(m[2] === 'Thumb' ? 'Thumb' : 'Finger') + m[3]];
  const base = name.replace(/^(left|right)/, '');
  return BODY_LIMITS[base] ?? { x: [-1, 1], y: [-1, 1], z: [-1, 1] };
}

// ============================================================================
// Helpers
// ============================================================================

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const damp = (c: number, t: number, l: number, dt: number) =>
  THREE.MathUtils.lerp(c, t, 1 - Math.exp(-l * dt));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function toonGradient(steps: number[]): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Tapered limb with rounded ends; top at y=0, extends to y=-len. */
function limbGeometry(
  rTop: number,
  rBot: number,
  len: number,
  bulgeAt = 0.3,
  bulgeAmt = 0,
  radial = 18,
  caps = true
): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  if (caps) {
    for (let k = 0; k <= 5; k++) {
      const a = -Math.PI / 2 + (k / 5) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(1e-4, rBot * Math.cos(a)), -len + rBot * Math.sin(a)));
    }
  }
  for (let k = caps ? 1 : 0; k <= 12; k++) {
    const t = k / 12;
    const fromTop = 1 - t;
    const r =
      rBot + (rTop - rBot) * t + bulgeAmt * Math.exp(-((fromTop - bulgeAt) ** 2) / 0.035);
    pts.push(new THREE.Vector2(r, -len + t * len));
  }
  if (caps) {
    for (let k = 1; k <= 5; k++) {
      const a = (k / 5) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(1e-4, rTop * Math.cos(a)), rTop * Math.sin(a)));
    }
  }
  return new THREE.LatheGeometry(pts, radial);
}

// --- limb skin profiles (garments are generated from these so they always sit outside the skin)
interface LimbProfile {
  rTop: number;
  rBot: number;
  len: number;
  bulgeAt: number;
  bulgeAmt: number;
}
const UPPER_ARM: LimbProfile = { rTop: 0.038, rBot: 0.029, len: 0.27, bulgeAt: 0.25, bulgeAmt: 0.004 };
const FOREARM: LimbProfile = { rTop: 0.03, rBot: 0.021, len: 0.24, bulgeAt: 0.22, bulgeAmt: 0.005 };
const THIGH: LimbProfile = { rTop: 0.072, rBot: 0.045, len: 0.42, bulgeAt: 0.2, bulgeAmt: 0.006 };
const SHIN: LimbProfile = { rTop: 0.044, rBot: 0.026, len: 0.4, bulgeAt: 0.28, bulgeAmt: 0.009 };

/** Skin radius of a limb at local height y (0 = joint, -len = next joint). */
function limbRadiusAt(P: LimbProfile, y: number) {
  const t = clamp((y + P.len) / P.len, 0, 1); // 0 bottom .. 1 top
  const fromTop = 1 - t;
  return P.rBot + (P.rTop - P.rBot) * t + P.bulgeAmt * Math.exp(-((fromTop - P.bulgeAt) ** 2) / 0.035);
}

function skinLimb(P: LimbProfile) {
  return limbGeometry(P.rTop, P.rBot, P.len, P.bulgeAt, P.bulgeAmt);
}

/**
 * Tube following a limb's skin profile between yTop and yBot (local heights),
 * offset outward: r = skin * scale + add. Optional rounded ends.
 */
function sleeveGeometry(P: LimbProfile, yTop: number, yBot: number, scale: number, add: number, radial = 20) {
  const pts: THREE.Vector2[] = [];
  const n = 16;
  for (let k = 0; k <= n; k++) {
    const y = yBot + ((yTop - yBot) * k) / n;
    pts.push(new THREE.Vector2(limbRadiusAt(P, y) * scale + add, y));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/** Radius a garment ring/torus must have at height y to stay on top of the sleeve. */
function sleeveRadius(P: LimbProfile, y: number, scale: number, add: number) {
  return limbRadiusAt(P, y) * scale + add;
}

// --- torso profile, in hip-space (y = 0 at the hips joint) -------------------
const TORSO: [number, number, number][] = [
  [-0.15, 0.05, 0.045],
  [-0.12, 0.12, 0.085],
  [-0.06, 0.158, 0.1],
  [0.0, 0.155, 0.098],
  [0.06, 0.136, 0.09],
  [0.13, 0.106, 0.077],
  [0.2, 0.113, 0.08],
  [0.27, 0.127, 0.086],
  [0.33, 0.137, 0.087],
  [0.39, 0.146, 0.082],
  [0.43, 0.148, 0.075],
  [0.46, 0.122, 0.066],
  [0.48, 0.075, 0.052],
  [0.5, 0.04, 0.038],
];
/** Body proportions (config "Body" tab). Mutated by RiggedAvatar.applyBody(). */
export const BODY = { width: 1, shoulder: 1, waist: 1, hip: 1, bust: 1 };

function bodyFactor(y: number) {
  const top = 1 - smooth(0.46, 0.5, y); // the neck base keeps its size
  const w = 1 + (BODY.width - 1) * top;
  const sh = 1 + (BODY.shoulder - 1) * smooth(0.33, 0.43, y) * top;
  const wa = 1 + (BODY.waist - 1) * Math.exp(-(((y - 0.14) / 0.075) ** 2));
  const hp = 1 + (BODY.hip - 1) * Math.exp(-(((y + 0.03) / 0.09) ** 2));
  return w * sh * wa * hp;
}

const _ab = { a: 0, b: 0 };
function torsoAB(y: number) {
  rawTorsoAB(y);
  const f = bodyFactor(y);
  _ab.a *= f;
  _ab.b *= 1 + (f - 1) * 0.65;
  return _ab;
}
function rawTorsoAB(y: number) {
  if (y <= TORSO[0][0]) {
    _ab.a = TORSO[0][1];
    _ab.b = TORSO[0][2];
    return _ab;
  }
  for (let i = 0; i < TORSO.length - 1; i++) {
    const [y0, a0, b0] = TORSO[i];
    const [y1, a1, b1] = TORSO[i + 1];
    if (y <= y1) {
      const t = (1 - Math.cos(((y - y0) / (y1 - y0)) * Math.PI)) / 2;
      _ab.a = a0 + (a1 - a0) * t;
      _ab.b = b0 + (b1 - b0) * t;
      return _ab;
    }
  }
  const l = TORSO[TORSO.length - 1];
  _ab.a = l[1];
  _ab.b = l[2];
  return _ab;
}
const BUST_Y = 0.285;
function bust(x: number, y: number) {
  let z = 0;
  for (const s of [-1, 1]) {
    const cx = s * 0.056 * BODY.width;
    z += 0.042 * BODY.bust * Math.exp(-((x - cx) ** 2) / (0.042 * Math.sqrt(BODY.bust)) ** 2 - ((y - BUST_Y) ** 2) / 0.048 ** 2);
  }
  return z;
}
function torsoPoint(y: number, phi: number, inflate: number, add: number, out: THREE.Vector3) {
  const { a, b } = torsoAB(y);
  const sx = Math.sin(phi);
  const cz = Math.cos(phi);
  let z = (b * inflate + add) * cz;
  if (cz > 0) z += bust(a * sx, y) * cz * inflate;
  return out.set((a * inflate + add) * sx, y, z);
}

function torsoGeometry(
  y0: number,
  top: number | ((phiF: number) => number),
  rings: number,
  seg: number,
  inflate: number,
  add: number,
  yShift: number,
  endShrink: [number, number] = [0, 0]
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= seg; j++) {
      const phi = Math.PI + (j / seg) * Math.PI * 2;
      const phiF = Math.atan2(Math.sin(phi), Math.cos(phi));
      const yTop = typeof top === 'number' ? top : top(phiF);
      const y = y0 + (yTop - y0) * (i / rings);
      // skin pieces are slightly narrower near the joints between segments so they
      // never poke through clothes worn on the neighbouring segment when bending
      const sb = endShrink[0] * (1 - smooth(0, 0.04, y - y0));
      const st = endShrink[1] * (1 - smooth(0, 0.04, yTop - y));
      torsoPoint(y, phi, inflate * (1 - sb - st), add, v);
      pos.push(v.x, v.y + yShift, v.z);
      uv.push(j / seg, i / rings);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.torsoArgs = [y0, top, rings, seg, inflate, add, yShift, endShrink];
  return g;
}

/** Animated flared skirt (folds sway over time). Built in hip-space. */
export interface Capsule {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();
const _cv = new THREE.Vector3();
const _cab = new THREE.Vector3();
const _cinv = new THREE.Matrix4();

class Skirt {
  static RINGS = [0, 0.08, 0.18, 0.3, 0.42, 0.55, 0.68, 0.8, 0.9, 0.955, 0.965, 1];
  private shape!: { yHem: number; hemA: number; hemB: number; inflate: number; seg: number };
  readonly mesh: THREE.Mesh;
  /** Extra clearance over the legs (outer layers use more so they stay over inner ones). */
  margin = 0.014;
  private base: Float32Array; // phi, y, a, b, t per vertex
  private geo: THREE.BufferGeometry;
  constructor(
    material: THREE.Material,
    private yTop: number,
    yHem: number,
    hemA: number,
    hemB: number,
    private folds: number,
    private foldAmp: number,
    inflate: number,
    bandColor: THREE.Color,
    bodyColor: THREE.Color,
    seg = 80
  ) {
    this.shape = { yHem, hemA, hemB, inflate, seg };
    const ts = Skirt.RINGS;
    const pos: number[] = [];
    const col: number[] = [];
    const base: number[] = [];
    const idx: number[] = [];
    const top = torsoAB(yTop);
    const aTop = top.a * inflate + 0.004;
    const bTop = top.b * inflate + 0.004;
    ts.forEach((t) => {
      const y = yTop + (yHem - yTop) * t;
      const e = Math.pow(t, 1.15);
      let a = aTop + (hemA - aTop) * e;
      let b = bTop + (hemB - bTop) * e;
      if (y > -0.14) {
        const tr = torsoAB(y);
        a = Math.max(a, tr.a * inflate + 0.01);
        b = Math.max(b, tr.b * inflate + 0.01);
      }
      const c = t >= 0.96 ? bandColor : bodyColor;
      for (let j = 0; j <= seg; j++) {
        const phi = Math.PI + (j / seg) * Math.PI * 2;
        base.push(phi, y, a, b, t);
        pos.push(0, 0, 0);
        col.push(c.r, c.g, c.b);
      }
    });
    for (let i = 0; i < ts.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * (seg + 1) + j;
        const b = a + 1;
        const c = a + seg + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.base = new Float32Array(base);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.update(0, 0, 0);
  }

  radiusAt(y: number) {
    // rough outer envelope, used as a collider for ribbons
    const b = this.base;
    let best = 0;
    let bestA = 0.2;
    let bestB = 0.15;
    for (let i = 0; i < b.length; i += 5 * 81) {
      const d = Math.abs(b[i + 1] - y);
      if (i === 0 || d < best) {
        best = d;
        bestA = b[i + 2];
        bestB = b[i + 3];
      }
    }
    return { a: bestA * (1 + this.foldAmp), b: bestB * (1 + this.foldAmp) };
  }

  /** Recompute the radii after the body proportions changed (hips/waist width). */
  rebuildShape() {
    const { yHem, hemA, hemB, inflate, seg } = this.shape;
    const top = torsoAB(this.yTop);
    const aTop = top.a * inflate + 0.004;
    const bTop = top.b * inflate + 0.004;
    const hipK = BODY.hip * BODY.width;
    let o = 0;
    Skirt.RINGS.forEach((t) => {
      const y = this.yTop + (yHem - this.yTop) * t;
      const e = Math.pow(t, 1.15);
      let a = aTop + (hemA * hipK - aTop) * e;
      let b = bTop + (hemB * hipK - bTop) * e;
      if (y > -0.14) {
        const tr = torsoAB(y);
        a = Math.max(a, tr.a * inflate + 0.01);
        b = Math.max(b, tr.b * inflate + 0.01);
      }
      for (let j = 0; j <= seg; j++, o += 5) {
        this.base[o + 2] = a;
        this.base[o + 3] = b;
      }
    });
  }

  update(time: number, swayX: number, swayZ: number, legs: Capsule[] = []) {
    const p = this.geo.attributes.position.array as Float32Array;
    const b = this.base;
    // legs are given in hips space; bring them into this mesh's space
    this.mesh.updateMatrix();
    _cinv.copy(this.mesh.matrix).invert();
    const caps = legs.map((c) => ({
      a: c.a.clone().applyMatrix4(_cinv),
      b: c.b.clone().applyMatrix4(_cinv),
      r: c.r + this.margin,
    }));
    for (let i = 0, v = 0; i < b.length; i += 5, v += 3) {
      const phi = b[i];
      const y = b[i + 1];
      const t = b[i + 4];
      const ft = Math.pow(t, 1.3);
      const f =
        1 +
        this.foldAmp * ft * Math.sin(this.folds * phi + 0.7 * Math.sin(time * 1.1 + phi * 2)) +
        0.012 * ft * Math.sin(time * 1.7 + phi * 3);
      p[v] = b[i + 2] * f * Math.sin(phi) + swayX * t * t;
      p[v + 1] = y + 0.006 * ft * Math.sin(this.folds * 0.5 * phi + time * 1.3);
      p[v + 2] = b[i + 3] * f * Math.cos(phi) + swayZ * t * t;
      if (t > 0.02 && caps.length) {
        // keep the fabric outside the thighs / shins (it drapes over a raised knee)
        _cv.set(p[v], p[v + 1], p[v + 2]);
        for (const c of caps) {
          _cab.subVectors(c.b, c.a);
          const L2 = _cab.lengthSq() || 1e-6;
          const u = clamp(_ca.subVectors(_cv, c.a).dot(_cab) / L2, 0, 1);
          _cb.copy(c.a).addScaledVector(_cab, u);
          _ca.subVectors(_cv, _cb);
          const d = _ca.length();
          if (d < c.r) {
            if (d < 1e-5) _ca.set(Math.sin(phi), 0, Math.cos(phi));
            else _ca.multiplyScalar(1 / d);
            _cv.copy(_cb).addScaledVector(_ca, c.r);
          }
        }
        p[v] = _cv.x;
        p[v + 1] = _cv.y;
        p[v + 2] = _cv.z;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

// ============================================================================
// Poses (anatomical values — see convention above)
// ============================================================================

interface PoseDef {
  joints: Partial<Record<JointName, JointEuler>>;
  hands: [HandGesture, HandGesture]; // [left, right]
}

const ARMS_DOWN: Partial<Record<JointName, JointEuler>> = {
  leftShoulder: { x: 0.05, y: 0.15, z: 0.2 },
  rightShoulder: { x: 0.05, y: 0.15, z: 0.2 },
  leftElbow: { x: -0.18 },
  rightElbow: { x: -0.18 },
  leftWrist: { z: 0.12 },
  rightWrist: { z: 0.12 },
};

const POSES: Record<PoseName, PoseDef> = {
  idle: {
    joints: {
      ...ARMS_DOWN,
      head: { x: 0.03, z: 0.03 },
      hips: { z: 0.025 },
      spine: { z: -0.02 },
      rightHip: { x: -0.05, z: 0.02 },
      rightKnee: { x: 0.1 },
      rightAnkle: { x: 0.04 },
      leftHip: { z: 0.03 },
    },
    hands: ['relaxed', 'relaxed'],
  },
  pointing: {
    joints: {
      ...ARMS_DOWN,
      chest: { y: -0.12 },
      head: { y: -0.18 },
      rightShoulder: { x: -1.45, y: 0.1, z: 0.18 },
      rightElbow: { x: -0.08 },
      rightWrist: { x: 0.05 },
    },
    hands: ['relaxed', 'point'],
  },
  waving: {
    joints: {
      ...ARMS_DOWN,
      chest: { z: 0.04 },
      head: { z: -0.08, x: -0.03 },
      rightClavicle: { z: 0.12 },
      rightShoulder: { x: -0.2, y: 1.35, z: 1.3 },
      rightElbow: { x: -1.75 },
    },
    hands: ['relaxed', 'open'],
  },
  greeting: {
    joints: {
      ...ARMS_DOWN,
      head: { x: 0.12, z: -0.06 },
      spine: { x: 0.08 },
      rightClavicle: { z: 0.12 },
      rightShoulder: { x: -0.2, y: 1.35, z: 1.3 },
      rightElbow: { x: -1.75 },
    },
    hands: ['relaxed', 'open'],
  },
  thinking: {
    joints: {
      chest: { x: 0.04, y: -0.06 },
      head: { x: -0.08, y: -0.12, z: 0.13 },
      leftShoulder: { x: -0.3, y: -0.55, z: 0.08 },
      leftElbow: { x: -1.55 },
      rightShoulder: { x: -0.8, y: -0.7, z: 0.1 },
      rightElbow: { x: -2.4 },
      rightWrist: { x: 0.3 },
      rightHip: { x: -0.05 },
      rightKnee: { x: 0.12 },
    },
    hands: ['relaxed', 'point'],
  },
  happy: {
    joints: {
      head: { x: -0.06, z: 0.1 },
      chest: { x: -0.04 },
      leftShoulder: { x: -0.45, y: 0.45, z: -0.05 },
      leftElbow: { x: -2.0 },
      rightShoulder: { x: -0.45, y: 0.45, z: -0.05 },
      rightElbow: { x: -2.0 },
      leftWrist: { x: 0.2 },
      rightWrist: { x: 0.2 },
    },
    hands: ['fist', 'fist'],
  },
  celebrating: {
    joints: {
      chest: { x: -0.08 },
      head: { x: -0.14 },
      leftShoulder: { x: -0.25, z: 2.55 },
      rightShoulder: { x: -0.25, z: 2.55 },
      leftElbow: { x: -0.35 },
      rightElbow: { x: -0.35 },
      leftClavicle: { z: 0.2 },
      rightClavicle: { z: 0.2 },
    },
    hands: ['fist', 'fist'],
  },
  explaining: {
    joints: {
      chest: { x: 0.03, y: 0.06 },
      head: { x: 0.03, y: 0.08 },
      leftShoulder: { x: -0.45, y: 0.15, z: 0.3 },
      leftElbow: { x: -1.25, y: 0.8 },
      rightShoulder: { x: -0.55, y: 0.15, z: 0.35 },
      rightElbow: { x: -1.35, y: 0.8 },
    },
    hands: ['open', 'open'],
  },
  listening: {
    joints: {
      spine: { x: 0.04 },
      head: { x: 0.06, y: 0.1, z: 0.16 },
      leftShoulder: { x: -0.2, y: -0.55, z: 0.12 },
      leftElbow: { x: -1.05 },
      rightShoulder: { x: -0.2, y: -0.55, z: 0.12 },
      rightElbow: { x: -1.05 },
    },
    hands: ['relaxed', 'relaxed'],
  },
  shrugging: {
    joints: {
      head: { z: 0.14, x: -0.04 },
      leftClavicle: { z: 0.3 },
      rightClavicle: { z: 0.3 },
      leftShoulder: { x: -0.15, y: -0.3, z: 0.45 },
      leftElbow: { x: -1.5, y: 1.1 },
      rightShoulder: { x: -0.15, y: -0.3, z: 0.45 },
      rightElbow: { x: -1.5, y: 1.1 },
    },
    hands: ['open', 'open'],
  },
  focused: {
    joints: {
      spine: { x: 0.07 },
      head: { x: 0.14 },
      leftShoulder: { x: -0.45, y: -0.5, z: 0.1 },
      leftElbow: { x: -1.35 },
      rightShoulder: { x: -0.45, y: -0.5, z: 0.1 },
      rightElbow: { x: -1.35 },
    },
    hands: ['relaxed', 'relaxed'],
  },
  dancing: {
    joints: {
      chest: { x: -0.04 },
      leftShoulder: { x: -0.3, y: 0.4, z: 1.0 },
      leftElbow: { x: -1.3 },
      rightShoulder: { x: -0.3, y: 0.4, z: 1.0 },
      rightElbow: { x: -1.3 },
      rightHip: { x: -0.05 },
      rightKnee: { x: 0.12 },
    },
    hands: ['peace', 'open'],
  },
  nodding: { joints: { ...ARMS_DOWN }, hands: ['relaxed', 'relaxed'] },
  shaking_head: { joints: { ...ARMS_DOWN }, hands: ['relaxed', 'relaxed'] },
};

// curls per finger [seg1, seg2, seg3] and spread for seg1
const HAND_SHAPES: Record<HandGesture, Record<FingerName, [number, number, number, number]>> = {
  relaxed: {
    Thumb: [0.15, 0.2, 0.15, 0.05],
    Index: [0.18, 0.28, 0.2, 0.02],
    Middle: [0.24, 0.34, 0.24, 0],
    Ring: [0.3, 0.4, 0.28, 0.02],
    Pinky: [0.36, 0.46, 0.3, 0.05],
  },
  open: {
    Thumb: [-0.1, 0.05, 0.05, 0.3],
    Index: [0.02, 0.05, 0.03, 0.12],
    Middle: [0.03, 0.05, 0.03, 0],
    Ring: [0.04, 0.06, 0.04, 0.1],
    Pinky: [0.05, 0.06, 0.04, 0.22],
  },
  fist: {
    Thumb: [0.6, 0.6, 0.6, -0.2],
    Index: [1.45, 1.6, 1.1, 0],
    Middle: [1.5, 1.65, 1.1, 0],
    Ring: [1.5, 1.65, 1.1, 0],
    Pinky: [1.5, 1.6, 1.0, 0],
  },
  point: {
    Thumb: [0.55, 0.5, 0.4, -0.1],
    Index: [0, 0, 0, 0],
    Middle: [1.45, 1.6, 1.1, 0],
    Ring: [1.5, 1.65, 1.1, 0],
    Pinky: [1.5, 1.6, 1.0, 0],
  },
  peace: {
    Thumb: [0.55, 0.5, 0.4, -0.1],
    Index: [0, 0, 0, 0.18],
    Middle: [0, 0, 0, 0],
    Ring: [1.5, 1.65, 1.1, 0],
    Pinky: [1.5, 1.6, 1.0, 0],
  },
  thumbsUp: {
    Thumb: [-0.2, 0, 0, 0.5],
    Index: [1.45, 1.6, 1.1, 0],
    Middle: [1.5, 1.65, 1.1, 0],
    Ring: [1.5, 1.65, 1.1, 0],
    Pinky: [1.5, 1.6, 1.0, 0],
  },
};

const VISEMES: Record<Viseme, { open: number; width: number; round: number }> = {
  rest: { open: 0, width: 1, round: 0 },
  A: { open: 0.78, width: 1.05, round: 0 },
  E: { open: 0.45, width: 1.18, round: 0 },
  I: { open: 0.3, width: 1.22, round: 0 },
  O: { open: 0.62, width: 0.8, round: 0.85 },
  U: { open: 0.35, width: 0.62, round: 1 },
  M: { open: 0, width: 0.95, round: 0 },
  F: { open: 0.12, width: 1.05, round: 0 },
  C: { open: 0.26, width: 1.0, round: 0.1 },
};

function charToViseme(ch: string): { v: Viseme; w: number } {
  if ('a'.includes(ch)) return { v: 'A', w: 1 };
  if ('e'.includes(ch)) return { v: 'E', w: 1 };
  if ('iy'.includes(ch)) return { v: 'I', w: 0.9 };
  if ('o'.includes(ch)) return { v: 'O', w: 1 };
  if ('uw'.includes(ch)) return { v: 'U', w: 0.9 };
  if ('mbp'.includes(ch)) return { v: 'M', w: 0.7 };
  if ('fv'.includes(ch)) return { v: 'F', w: 0.7 };
  if (' -'.includes(ch)) return { v: 'rest', w: 0.6 };
  if (',;:'.includes(ch)) return { v: 'rest', w: 2.2 };
  if ('.!?…'.includes(ch)) return { v: 'rest', w: 3 };
  if (/[a-z0-9]/.test(ch)) return { v: 'C', w: 0.55 };
  return { v: 'rest', w: 0.3 };
}

// ============================================================================
// Rigged avatar
// ============================================================================

const HEAD_SCALE = 1.1;
const CHEST_Y = 0.24; // chest joint in hip-space

export class RiggedAvatar {
  public readonly root: THREE.Group;
  public readonly joints: Record<JointName, THREE.Group>;

  private appearance: AppearanceConfig;
  private target: Record<string, { x: number; y: number; z: number }> = {};
  private current: Record<string, { x: number; y: number; z: number }> = {};
  private meta: Record<string, { mirror: number; spreadSign: number; finger: boolean }> = {};
  private currentPose: PoseName = 'idle';
  private hands: [HandGesture, HandGesture] = ['relaxed', 'relaxed'];
  private customModel: THREE.Object3D | null = null;

  private headContent!: THREE.Group;
  private headGeo!: THREE.BufferGeometry;
  private headBase!: Float32Array;
  private headParams: HeadParams = { ...FACE_SHAPES.oval, nose: 1 };
  private faceStyle = { eyeW: 0.0215, eyeH: 0.026, eyeTilt: 0.14, wing: 1, noseScale: 1, mouthScale: 1 };
  private hairStyle: HairStyle = 'long';
  private hairTie: THREE.Mesh | null = null;
  private napeMesh: THREE.Mesh | null = null;
  private faceKey = '';
  private bodyKey = '1|1|1|1|1|1|1';
  private legK = 1;
  private limbK = 1;
  private hipsBaseY = 0.93;
  private anchors: (() => void)[] = [];
  /** Behaviour tab: idle body sway / turning towards the cursor. */
  public behavior = { idleMotion: true, idleTurn: true, idleCycle: true };
  private basePose: PoseName = 'idle';
  private cycleTimer = 10;
  private cycleUntil = 0;
  private autoPose = false;
  private autoTimer = 20;
  private holdUntil = 0;
  /** Set by the companion while she roams because the user is away: livelier pose changes. */
  public roamingIdle = false;

  /** Behaviour "Enable idle rotation": alternate poses while nothing else is happening. */
  private updateIdleCycle(dt: number) {
    // a temporary pose (Hermes) wins until it expires
    if (this.holdUntil) {
      if (this.time < this.holdUntil) return;
      this.holdUntil = 0;
      this.applyPose(this.basePose);
      this.cycleTimer = 6 + Math.random() * 6;
    }
    // "Auto" default pose: pick another default every 14–28 s (when not talking)
    if (this.autoPose && !this.speaking) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.autoTimer = 14 + Math.random() * 14;
        this.basePose = this.pickAutoPose();
        if (!this.cycleUntil && !(this.loco.active && this.loco.state !== 'idle')) this.applyPose(this.basePose);
      }
    }
    const busy = this.speaking || (this.loco.active && this.loco.state !== 'idle');
    if (!this.behavior.idleCycle || busy) {
      if (this.cycleUntil) {
        this.cycleUntil = 0;
        this.applyPose(this.basePose);
      }
      this.cycleTimer = Math.max(this.cycleTimer, 6);
      return;
    }
    if (this.cycleUntil) {
      if (this.time >= this.cycleUntil) {
        this.cycleUntil = 0;
        this.applyPose(this.basePose);
        this.cycleTimer = this.roamingIdle ? 2 + Math.random() * 3 : 9 + Math.random() * 9;
      }
      return;
    }
    this.cycleTimer -= dt * (this.roamingIdle ? 2.5 : 1);
    if (this.cycleTimer > 0) return;
    const variants: [PoseName, number][] = (
      [
        ['thinking', 3.5],
        ['listening', 3],
        ['nodding', 2],
        ['happy', 2.5],
        ['explaining', 3],
        ['focused', 3],
        ['dancing', 4],
        ['greeting', 2.2],
        ['shrugging', 2.2],
      ] as [PoseName, number][]
    ).filter(([p]) => p !== this.basePose);
    const [p, d] = variants[Math.floor(Math.random() * variants.length)];
    this.applyPose(p);
    this.cycleUntil = this.time + d;
  }
  /** Set when proportions changed; renderers re-fit their camera and clear it. */
  public bodyChanged = false;
  private chestVolume!: THREE.Group;
  private face!: FaceCanvas;
  private hair!: StrandSystem;
  private sash!: StrandSystem;
  private skirts: Skirt[] = [];
  private outerSkirt!: Skirt;

  // materials
  private skinMat!: THREE.MeshToonMaterial;
  private faceSkinMat!: THREE.MeshToonMaterial;
  private hairMat!: THREE.MeshStandardMaterial;
  private hairCapMat!: THREE.MeshStandardMaterial;
  private hairShineMat!: THREE.MeshBasicMaterial;
  private satinMat!: THREE.MeshStandardMaterial;
  private goldMat!: THREE.MeshStandardMaterial;
  private sheerMat!: THREE.MeshStandardMaterial;
  private sheerSkirtMat!: THREE.MeshStandardMaterial;
  private sheerLegMat!: THREE.MeshStandardMaterial;
  private sashMat!: THREE.MeshStandardMaterial;
  private satinSkirtMat!: THREE.MeshStandardMaterial;
  private headphoneBandMat!: THREE.MeshStandardMaterial;
  private headphoneGlowMat!: THREE.MeshBasicMaterial;
  private shoeMat!: THREE.MeshStandardMaterial;
  private shirtWhiteMat!: THREE.MeshStandardMaterial;
  private outfitParts: Record<OutfitStyle, THREE.Object3D[]> = {
    casual: [],
    formal: [],
    sporty: [],
    elegant: [],
    cyberpunk: [],
    fantasy: [],
  };

  private addOutfitPart<T extends THREE.Object3D>(style: OutfitStyle, obj: T): T {
    this.outfitParts[style].push(obj);
    return obj;
  }

  private normalizeOutfitStyle(outfit?: string): OutfitStyle {
    switch (outfit) {
      case 'formal':
      case 'sporty':
      case 'elegant':
      case 'cyberpunk':
      case 'fantasy':
      case 'casual':
        return outfit;
      case 'noir-gold':
      default:
        return 'casual';
    }
  }

  private applyOutfitStyle(outfit?: string) {
    const active = this.normalizeOutfitStyle(outfit);
    (Object.keys(this.outfitParts) as OutfitStyle[]).forEach((k) => {
      const vis = k === active;
      this.outfitParts[k].forEach((obj) => {
        obj.visible = vis;
      });
    });
  }

  // face state
  private targetFace: Required<FacialState>;
  private currentFace: Required<FacialState>;
  private mouthShape = { open: 0, width: 1, round: 0 };
  private emotionGaze = { x: 0, y: 0 };
  private saccade = { x: 0, y: 0, timer: 1.5 };

  private blinkTimer = 2.4;
  private blinkT = -1;
  private doubleBlink = false;
  private speaking = false;
  private speakIntensity = 0.7;
  private lipSeq: { v: Viseme; t0: number; t1: number }[] | null = null;
  private lipStart = 0;
  private externalViseme: { v: Viseme; w: number; until: number } | null = null;
  private time = 0;

  // locomotion (desktop / browser companion)
  private loco = {
    active: false,
    state: 'idle' as LocoAnim,
    facing: 1,
    speed: 0,
    vy: 0,
    lookX: 0,
    phase: 0,
    t: 0,
    w: 0,
    yaw: 0.12,
  };
  private locoTargets: Partial<Record<JointName, { x: number; y: number; z: number }>> = {};
  private hairExt = new THREE.Vector3();

  // collision scratch
  private hcM = new THREE.Matrix4();
  private hcInv = new THREE.Matrix4();
  private chestM = new THREE.Matrix4();
  private chestInv = new THREE.Matrix4();
  private hipsM = new THREE.Matrix4();
  private hipsInv = new THREE.Matrix4();
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();

  constructor(initialAppearance?: Partial<AppearanceConfig>) {
    this.root = new THREE.Group();
    this.appearance = {
      hairColor: '#C9A15A',
      eyeColor: '#7A4A1C',
      skinTone: '#F7DCC0',
      outfit: 'noir-gold',
      headphoneColor: '#E6C26E',
      ...initialAppearance,
    };

    const neutral: Required<FacialState> = {
      emotion: 'neutral',
      mouthOpen: 0,
      smile: 0.66,
      eyebrowTilt: 0,
      eyebrowRaise: 0,
      leftEyeOpen: 1,
      rightEyeOpen: 1,
      lookAt: { x: 0, y: 0 },
      blush: 0.15,
      happyEyes: 0,
      squint: 0.1,
      browAsym: 0,
    };
    this.targetFace = { ...neutral, lookAt: { x: 0, y: 0 } };
    this.currentFace = { ...neutral, lookAt: { x: 0, y: 0 } };

    this.joints = {} as Record<JointName, THREE.Group>;
    this.initMaterials();
    this.applyFaceSettings(this.appearance);
    this.buildBody();

    ALL_JOINTS.forEach((n) => {
      this.target[n] = { x: 0, y: 0, z: 0 };
      this.current[n] = { x: 0, y: 0, z: 0 };
    });

    this.applyBody(this.appearance);
    this.root.updateMatrixWorld(true);
    this.buildHair();
    this.buildSash();
    this.addOutfitPart('casual', this.sash.mesh); // the back bow + ribbons belong to the casual (noir-gold) dress
    this.applyOutfitStyle(this.appearance.outfit);

    this.setPose('idle');
    this.setEmotion('neutral');
    // start in pose (no initial tween)
    ALL_JOINTS.forEach((n) => Object.assign(this.current[n], this.target[n]));
    this.applyJoints({});
  }

  // ==========================================================================
  // Materials
  // ==========================================================================

  private initMaterials() {
    const grad = toonGradient([185, 228, 255]);
    this.skinMat = new THREE.MeshToonMaterial({ color: this.appearance.skinTone, gradientMap: grad });

    this.hairMat = new THREE.MeshStandardMaterial({
      color: this.appearance.hairColor,
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.18,
      side: THREE.DoubleSide,
    });
    this.hairCapMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.hairColor).multiplyScalar(0.92),
      roughness: 0.45,
      metalness: 0.15,
    });
    this.hairShineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.appearance.hairColor).lerp(new THREE.Color('#FFF6DA'), 0.55),
      transparent: true,
      opacity: 0.75,
    });

    const primary = this.getOutfitPrimaryColor();
    const accent = this.getOutfitAccentColor();

    this.satinMat = new THREE.MeshStandardMaterial({ color: primary, roughness: 0.3, metalness: 0.35 });
    this.satinSkirtMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.35,
      side: THREE.DoubleSide,
    });
    this.goldMat = new THREE.MeshStandardMaterial({
      color: accent,
      roughness: 0.26,
      metalness: 0.85,
      emissive: new THREE.Color(accent).multiplyScalar(0.18),
    });
    this.sheerMat = new THREE.MeshStandardMaterial({
      color: primary.clone().lerp(new THREE.Color('#2a2430'), 0.4),
      transparent: true,
      opacity: 0.5,
      roughness: 0.5,
      metalness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sheerSkirtMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.52,
      roughness: 0.5,
      metalness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sheerLegMat = new THREE.MeshStandardMaterial({
      color: '#15121a',
      transparent: true,
      opacity: 0.4,
      roughness: 0.45,
      metalness: 0.15,
      depthWrite: false,
    });
    this.sashMat = new THREE.MeshStandardMaterial({
      color: accent,
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      roughness: 0.35,
      metalness: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.headphoneBandMat = new THREE.MeshStandardMaterial({
      color: this.appearance.headphoneColor || '#E6C26E',
      roughness: 0.25,
      metalness: 0.85,
      emissive: new THREE.Color(this.appearance.headphoneColor || '#E6C26E').multiplyScalar(0.15),
    });
    this.headphoneGlowMat = new THREE.MeshBasicMaterial({ color: '#FFD978' });
    this.shoeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.shoeColor || primary),
      roughness: 0.32,
      metalness: 0.3,
    });
    this.shirtWhiteMat = new THREE.MeshStandardMaterial({
      color: '#F5F6FA',
      roughness: 0.55,
      metalness: 0.05,
    });
  }

  private getOutfitPrimaryColor(): THREE.Color {
    if (this.appearance.clothingColor) {
      return new THREE.Color(this.appearance.clothingColor);
    }
    switch (this.appearance.outfit) {
      case 'casual':
        return new THREE.Color('#2E4A7D');
      case 'formal':
        return new THREE.Color('#141418');
      case 'sporty':
        return new THREE.Color('#C94A38');
      case 'elegant':
        return new THREE.Color('#5C2D1E');
      case 'cyberpunk':
        return new THREE.Color('#1A0B2E');
      case 'fantasy':
        return new THREE.Color('#4B2C6E');
      case 'noir-gold':
      default:
        return new THREE.Color('#0D0D12');
    }
  }

  private getOutfitAccentColor(): THREE.Color {
    if (this.appearance.accessoryColor) {
      return new THREE.Color(this.appearance.accessoryColor);
    }
    switch (this.appearance.outfit) {
      case 'casual':
        return new THREE.Color('#F5DFA0');
      case 'sporty':
        return new THREE.Color('#FFFFFF');
      case 'elegant':
        return new THREE.Color('#20B2AA');
      case 'cyberpunk':
        return new THREE.Color('#FF00CC');
      case 'fantasy':
        return new THREE.Color('#FFD700');
      case 'formal':
      case 'noir-gold':
      default:
        return new THREE.Color('#D9B35E');
    }
  }

  // ==========================================================================
  // Skeleton & body
  // ==========================================================================

  private joint(name: JointName, parent: THREE.Object3D, x: number, y: number, z: number, order: THREE.EulerOrder = 'XYZ') {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    g.rotation.order = order;
    parent.add(g);
    this.joints[name] = g;
    const side = name.startsWith('left') ? 1 : name.startsWith('right') ? -1 : 1;
    this.meta[name] = { mirror: side, spreadSign: 1, finger: false };
    return g;
  }

  private buildBody() {
    const hips = this.joint('hips', this.root, 0, 0.93, 0);
    const spine = this.joint('spine', hips, 0, 0.1, 0);
    const chest = this.joint('chest', spine, 0, CHEST_Y - 0.1, 0);

    // --- Skin torso (pelvis / abdomen / chest) --------------------------------
    // pelvis is always covered by a fitted satin base layer (briefs/bodysuit), so raising a leg
    // under a skirt or between trouser legs never reveals bare skin
    hips.add(new THREE.Mesh(torsoGeometry(-0.15, 0.1, 10, 40, 1, 0, 0, [0, 0.07]), this.satinMat));
    spine.add(new THREE.Mesh(torsoGeometry(0.07, 0.26, 8, 40, 1, 0, -0.1, [0.07, 0.05]), this.skinMat));
    this.chestVolume = new THREE.Group();
    this.chestVolume.position.y = 0;
    chest.add(this.chestVolume);
    this.chestVolume.add(new THREE.Mesh(torsoGeometry(0.2, 0.5, 18, 48, 1, 0, -CHEST_Y, [0.06, 0]), this.skinMat));

    // collarbone hint
    [-1, 1].forEach((s) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.025, 0.226, 0.062),
        new THREE.Vector3(s * 0.07, 0.232, 0.06),
        new THREE.Vector3(s * 0.115, 0.226, 0.05),
      ]);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.004, 6, false), this.skinMat);
      this.chestVolume.add(m);
    });

    this.buildOutfit(hips, spine);

    // --- Neck & choker ---------------------------------------------------------
    const neck = this.joint('neck', chest, 0, 0.235, -0.004);
    const neckMesh = new THREE.Mesh(limbGeometry(0.036, 0.031, 0.17, 0, 0, 20, false), this.skinMat);
    neckMesh.rotation.x = Math.PI; // so it extends upward from y=0
    neckMesh.position.y = -0.03;
    neck.add(neckMesh);

    // neck skin radius at a given neck-local height (lathe 0.036 → 0.031 over 0.17, starting at y=-0.03)
    const neckR = (y: number) => 0.036 + (0.031 - 0.036) * clamp((y + 0.03) / 0.17, 0, 1);
    const choker = new THREE.Mesh(new THREE.TorusGeometry(neckR(0.045) + 0.0055 * 0.85, 0.0055, 10, 40), this.satinMat);
    choker.rotation.x = Math.PI / 2;
    choker.position.y = 0.045;
    neck.add(choker);
    const chokerTrim = new THREE.Mesh(new THREE.TorusGeometry(neckR(0.0395) + 0.0055 * 0.85 + 0.002, 0.0015, 6, 40), this.goldMat);
    chokerTrim.rotation.x = Math.PI / 2;
    chokerTrim.position.y = 0.0395;
    neck.add(chokerTrim);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0075, 0.0018, 8, 20), this.goldMat);
    ring.position.set(0, 0.032, neckR(0.032) + 0.0095);
    neck.add(ring);
    const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.0055, 0), this.goldMat);
    charm.scale.set(0.8, 1.3, 0.5);
    charm.position.set(0, 0.021, neckR(0.021) + 0.011);
    neck.add(charm);

    // --- Head ------------------------------------------------------------------
    const head = this.joint('head', neck, 0, 0.1, 0);
    this.headContent = new THREE.Group();
    this.headContent.position.set(0, 0.105, 0.008);
    this.headContent.scale.setScalar(HEAD_SCALE);
    head.add(this.headContent);
    this.buildHead(this.headContent);
    this.buildHeadphones(this.headContent);

    // --- Limbs ------------------------------------------------------------------
    this.buildArm('left', chest);
    this.buildArm('right', chest);
    this.buildLeg('left', hips);
    this.buildLeg('right', hips);
  }

  private buildOutfit(hips: THREE.Group, spine: THREE.Group) {
    // Strapless sweetheart corset bodice (no shoulder straps)
    const bodiceTop = (phiF: number) => {
      const a = Math.abs(phiF);
      return (
        0.322 -
        0.024 * Math.exp(-(phiF * phiF) / 0.02) +
        0.014 * (Math.exp(-((phiF - 0.45) ** 2) / 0.035) + Math.exp(-((phiF + 0.45) ** 2) / 0.035)) -
        0.028 * smooth(1.3, 2.6, a)
      );
    };
    spine.add(this.addOutfitPart('casual', new THREE.Mesh(torsoGeometry(0.07, 0.25, 8, 48, 1.045, 0.003, -0.1), this.satinMat)));
    this.chestVolume.add(
      this.addOutfitPart('casual', new THREE.Mesh(torsoGeometry(0.22, bodiceTop, 12, 64, 1.045, 0.003, -CHEST_Y), this.satinMat))
    );

    // Gold piping along the neckline
    const v = new THREE.Vector3();
    const piping = () => {
      const edge: THREE.Vector3[] = [];
      for (let j = 0; j < 96; j++) {
        const phi = Math.PI + (j / 96) * Math.PI * 2;
        const phiF = Math.atan2(Math.sin(phi), Math.cos(phi));
        torsoPoint(bodiceTop(phiF), phi, 1.05, 0.003, v);
        edge.push(new THREE.Vector3(v.x, v.y - CHEST_Y, v.z));
      }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 160, 0.0042, 8, true);
    };
    this.chestVolume.add(this.rebuildable(this.addOutfitPart('casual', new THREE.Mesh(piping(), this.goldMat)), piping));

    // Gold corset boning seams (split between the spine and chest segments)
    [-0.62, -0.26, 0.26, 0.62].forEach((phi) => {
      const bone = (part: 'lower' | 'upper') => () => {
        const pts: THREE.Vector3[] = [];
        const yTop = bodiceTop(phi) - 0.012;
        for (let k = 0; k <= 10; k++) {
          const y = 0.135 + (yTop - 0.135) * (k / 10);
          torsoPoint(y, phi, 1.05, 0.003, v);
          pts.push(new THREE.Vector3(v.x, v.y - 0.1, v.z));
        }
        const sel =
          part === 'lower'
            ? pts.filter((p) => p.y + 0.1 <= 0.25).map((p) => p.clone())
            : pts.filter((p) => p.y + 0.1 >= 0.22).map((p) => new THREE.Vector3(p.x, p.y + 0.1 - CHEST_Y, p.z));
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sel), 12, 0.0016, 5);
      };
      spine.add(this.rebuildable(this.addOutfitPart('casual', new THREE.Mesh(bone('lower')(), this.goldMat)), bone('lower')));
      this.chestVolume.add(this.rebuildable(this.addOutfitPart('casual', new THREE.Mesh(bone('upper')(), this.goldMat)), bone('upper')));
    });

    // Gold waist belt + buckle
    spine.add(this.addOutfitPart('casual', new THREE.Mesh(torsoGeometry(0.105, 0.13, 2, 64, 1.075, 0.003, -0.1), this.goldMat)));
    const buckle = this.addOutfitPart('casual', new THREE.Mesh(new THREE.OctahedronGeometry(0.016, 0), this.goldMat));
    buckle.scale.set(1, 0.8, 0.35);
    this.anchorZ(buckle, 0, 0.0175, 0.1175, 1.075, 0.006, 1);
    spine.add(buckle);
    const gem = this.addOutfitPart('casual', new THREE.Mesh(new THREE.SphereGeometry(0.0055, 12, 10), this.headphoneGlowMat));
    this.anchorZ(gem, 0, 0.0175, 0.1175, 1.075, 0.011, 1);
    spine.add(gem);

    // Opaque black satin under-skirt + sheer chiffon over-skirt, both gold-hemmed
    const gold = this.getOutfitAccentColor();
    const prim = this.getOutfitPrimaryColor();
    const inner = new Skirt(this.satinSkirtMat, 0.12, -0.24, 0.24, 0.2, 14, 0.045, 1.06, gold, prim);
    const outer = new Skirt(
      this.sheerSkirtMat,
      0.125,
      -0.42,
      0.31,
      0.26,
      11,
      0.07,
      1.09,
      gold,
      prim.clone().lerp(new THREE.Color('#2a2430'), 0.4)
    );
    outer.mesh.renderOrder = 2;
    outer.margin = 0.036;
    hips.add(this.addOutfitPart('casual', inner.mesh));
    hips.add(this.addOutfitPart('casual', outer.mesh));
    this.skirts = [inner, outer];
    this.outerSkirt = outer;

    // Sheer bow at the back of the waist
    [-1, 1].forEach((s) => {
      const loop = this.addOutfitPart('casual', new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 8, 24), this.sashMat));
      loop.scale.set(1, 0.62, 0.35);
      loop.rotation.z = s * 0.35;
      this.anchorZ(loop, s * 0.03, 0.022, 0.12, 1.075, 0.012, -1);
      spine.add(loop);
    });
    const knot = this.addOutfitPart('casual', new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 10), this.goldMat));
    knot.scale.set(1, 0.9, 0.6);
    this.anchorZ(knot, 0, 0.02, 0.12, 1.075, 0.012, -1);
    spine.add(knot);

    // --- FORMAL: Tailored blazer + white collared shirt + trousers ---
    spine.add(this.addOutfitPart('formal', new THREE.Mesh(torsoGeometry(0.07, 0.25, 8, 48, 1.035, 0.003, -0.1), this.shirtWhiteMat)));
    this.chestVolume.add(
      this.addOutfitPart(
        'formal',
        new THREE.Mesh(
          torsoGeometry(0.22, (phi) => 0.345 - 0.035 * Math.exp(-(phi * phi) / 0.04), 10, 48, 1.03, 0.002, -CHEST_Y),
          this.shirtWhiteMat
        )
      )
    );
    spine.add(this.addOutfitPart('formal', new THREE.Mesh(torsoGeometry(0.0, 0.25, 8, 48, 1.075, 0.005, -0.1), this.satinMat)));
    this.chestVolume.add(
      this.addOutfitPart(
        'formal',
        new THREE.Mesh(
          torsoGeometry(0.22, (phi) => (Math.abs(phi) < 0.26 ? 0.21 : 0.35), 10, 56, 1.075, 0.005, -CHEST_Y),
          this.satinMat
        )
      )
    );
    hips.add(this.addOutfitPart('formal', new THREE.Mesh(torsoGeometry(-0.15, 0.06, 8, 40, 1.06, 0.004, 0), this.satinMat)));

    // --- SPORTY: Athletic crop top + high-waist shorts ---
    this.chestVolume.add(
      this.addOutfitPart(
        'sporty',
        new THREE.Mesh(
          torsoGeometry(0.235, (phi) => 0.34 - 0.025 * Math.exp(-(phi * phi) / 0.06), 10, 48, 1.045, 0.002, -CHEST_Y),
          this.satinMat
        )
      )
    );
    hips.add(this.addOutfitPart('sporty', new THREE.Mesh(torsoGeometry(-0.15, 0.09, 8, 44, 1.06, 0.003, 0), this.satinMat)));
    spine.add(this.addOutfitPart('sporty', new THREE.Mesh(torsoGeometry(0.06, 0.11, 3, 44, 1.07, 0.003, -0.1), this.satinMat)));

    // --- ELEGANT: Halter V-neck mini-dress ---
    spine.add(this.addOutfitPart('elegant', new THREE.Mesh(torsoGeometry(0.07, 0.25, 8, 48, 1.045, 0.003, -0.1), this.satinMat)));
    this.chestVolume.add(
      this.addOutfitPart(
        'elegant',
        new THREE.Mesh(
          torsoGeometry(0.22, (phi) => 0.335 - 0.055 * Math.exp(-(phi * phi) / 0.03), 10, 56, 1.04, 0.002, -CHEST_Y),
          this.satinMat
        )
      )
    );
    const halterBand = this.addOutfitPart('elegant', new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.006, 8, 28), this.satinMat));
    halterBand.rotation.x = Math.PI / 2;
    halterBand.position.y = 0.265;
    this.chestVolume.add(halterBand);
    const elegantSkirt = new Skirt(this.satinSkirtMat, 0.11, -0.22, 0.22, 0.18, 12, 0.035, 1.06, gold, prim);
    hips.add(this.addOutfitPart('elegant', elegantSkirt.mesh));
    this.skirts.push(elegantSkirt);

    // --- CYBERPUNK: Strapped corset dress with front zip O-ring & buckled straps ---
    spine.add(this.addOutfitPart('cyberpunk', new THREE.Mesh(torsoGeometry(0.07, 0.25, 8, 48, 1.05, 0.003, -0.1), this.satinMat)));
    this.chestVolume.add(
      this.addOutfitPart('cyberpunk', new THREE.Mesh(torsoGeometry(0.22, bodiceTop, 10, 56, 1.045, 0.002, -CHEST_Y), this.satinMat))
    );
    const zipLine = this.addOutfitPart('cyberpunk', new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.18, 8), this.goldMat));
    this.anchorZ(zipLine, 0, 0.02, 0.22, 1.06, 0, 1);
    this.chestVolume.add(zipLine);
    const zipRing = this.addOutfitPart('cyberpunk', new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 8, 20), this.goldMat));
    this.anchorZ(zipRing, 0, 0.09, 0.3, 1.07, 0, 1);
    this.chestVolume.add(zipRing);
    [-1, 1].forEach((s) => {
      const strapCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.075, 0.085, 0.085),
        new THREE.Vector3(s * 0.085, 0.19, 0.01),
        new THREE.Vector3(s * 0.075, 0.08, -0.08),
      ]);
      this.chestVolume.add(
        this.addOutfitPart('cyberpunk', new THREE.Mesh(new THREE.TubeGeometry(strapCurve, 16, 0.008, 6, false), this.satinMat))
      );
      const bkl = this.addOutfitPart('cyberpunk', new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.018, 0.008), this.goldMat));
      bkl.position.set(s * 0.08, 0.135, 0.065);
      this.chestVolume.add(bkl);
    });
    const cyberSkirt = new Skirt(this.satinSkirtMat, 0.11, -0.28, 0.27, 0.22, 14, 0.055, 1.07, gold, prim);
    hips.add(this.addOutfitPart('cyberpunk', cyberSkirt.mesh));
    this.skirts.push(cyberSkirt);

    // --- FANTASY: Fairy sheer asymmetrical bodice + draped tulle skirt + butterfly accents ---
    spine.add(this.addOutfitPart('fantasy', new THREE.Mesh(torsoGeometry(0.07, 0.25, 8, 48, 1.045, 0.003, -0.1), this.sheerMat)));
    this.chestVolume.add(
      this.addOutfitPart('fantasy', new THREE.Mesh(torsoGeometry(0.22, bodiceTop, 10, 56, 1.04, 0.002, -CHEST_Y), this.sheerMat))
    );
    const fairySkirt = new Skirt(this.sheerSkirtMat, 0.11, -0.38, 0.3, 0.25, 12, 0.065, 1.08, gold, prim);
    fairySkirt.mesh.rotation.z = 0.09; // asymmetrical draped hem
    fairySkirt.mesh.renderOrder = 2;
    fairySkirt.margin = 0.024;
    hips.add(this.addOutfitPart('fantasy', fairySkirt.mesh));
    this.skirts.push(fairySkirt);
    [-1, 1].forEach((s) => {
      const wing = this.addOutfitPart('fantasy', new THREE.Mesh(new THREE.CircleGeometry(0.024, 14), this.goldMat));
      wing.scale.set(1.2, 0.75, 1);
      wing.rotation.z = s * 0.4;
      this.anchorZ(wing, s * 0.018, 0.055, 0.27, 1.08, 0, 1);
      this.chestVolume.add(wing);
    });
  }

  // --------------------------------------------------------------------------
  // Head & face
  // --------------------------------------------------------------------------

  private deformHead(v: THREE.Vector3) {
    const R = 0.115;
    const P = this.headParams;
    let { x, y, z } = v;
    const t = clamp(-y / R, 0, 1);
    y = y < 0 ? y * P.yLow : y * 1.03;
    const taper = P.taper1 * t + P.taper2 * t * t + P.chinPoint * Math.pow(smooth(0.72, 1, t), 2);
    x *= Math.max(0.05, 1 - taper) * (1 + P.cheek * Math.exp(-(((t - P.cheekT) / 0.2) ** 2)));
    z *= 1 - 0.1 * t;
    if (z > 0) z *= 0.93;
    else z *= 1.08;
    if (z > 0) {
      const ns = P.nose;
      z += 0.0065 * ns * Math.exp(-(x * x) / (0.008 * ns) ** 2 - ((y + 0.05) ** 2) / (0.014 * ns) ** 2); // nose
      z += 0.006 * t * t; // chin forward
    }
    v.set(x, y, z);
  }

  /** Place a decoration on the torso surface (front +1 / back -1) and keep it there when the body changes. */
  private anchorZ(obj: THREE.Object3D, x: number, y: number, yh: number, k: number, c: number, side: 1 | -1) {
    const place = () => obj.position.set(x * BODY.width, y, side * (torsoAB(yh).b * k + c));
    place();
    this.anchors.push(place);
  }

  /** Mesh whose geometry is regenerated when the body proportions change. */
  private rebuildable<T extends THREE.Mesh>(mesh: T, make: () => THREE.BufferGeometry): T {
    mesh.userData.rebuild = make;
    return mesh;
  }

  /** Scale the meshes hanging directly from a limb joint (thickness kxz, length ky). */
  private scaleLimbMeshes(joint: THREE.Object3D, kxz: number, ky: number) {
    joint.children.forEach((c) => {
      if (!(c as THREE.Mesh).isMesh || this.isJoint(c)) return;
      const ud = c.userData;
      if (!ud.base) ud.base = { py: c.position.y, s: c.scale.clone() };
      const b = ud.base;
      c.position.y = b.py * ky;
      const r = c.rotation;
      const ring = Math.abs(Math.abs(r.x) - Math.PI / 2) < 0.01 && Math.abs(r.y) < 0.01 && Math.abs(r.z) < 0.01;
      const plain = Math.abs(r.x) < 0.01 && Math.abs(r.y) < 0.01 && Math.abs(r.z) < 0.01;
      if (plain) c.scale.set(b.s.x * kxz, b.s.y * ky, b.s.z * kxz);
      else if (ring) c.scale.set(b.s.x * kxz, b.s.y * kxz, b.s.z);
      else c.scale.copy(b.s).multiplyScalar(kxz);
    });
  }

  private isJoint(o: THREE.Object3D) {
    return Object.values(this.joints).includes(o as THREE.Group);
  }

  /** Body tab: body type + height / width / shoulders / waist. */
  private applyBody(a: Partial<AppearanceConfig>) {
    const num = (v: any, d: number) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
    const type = (BODY_TYPES as any)[String(a.bodyType ?? 'average')] ? (String(a.bodyType ?? 'average') as BodyType) : 'average';
    const T = BODY_TYPES[type];
    const width = clamp(1 + (num(a.bodyWidth, 100) - 100) / 250, 0.8, 1.2) * T.width;
    const shoulder = clamp(1 + (num(a.shoulderWidth, 100) - 100) / 250, 0.8, 1.2) * T.shoulder;
    const waist = clamp(1 + (num(a.waistSize, 80) - 80) / 150, 0.78, 1.3) * T.waist;
    const legK = clamp(1 + (num(a.bodyHeight, 150) - 150) / 250, 0.8, 1.2) * T.leg;
    const limbK = (1 + (width - 1) * 0.6) * T.limb;
    const key = [width, shoulder, waist, T.hip, T.bust, legK, limbK].map((n) => n.toFixed(3)).join('|');
    if (key === this.bodyKey) return false;
    this.bodyKey = key;

    Object.assign(BODY, { width, shoulder, waist, hip: T.hip, bust: T.bust });
    this.legK = legK;
    this.limbK = limbK;

    // torso geometry (skin + every garment built from the torso profile)
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const args = m.geometry?.userData?.torsoArgs;
      const make = m.userData.rebuild as (() => THREE.BufferGeometry) | undefined;
      if (args || make) {
        const g = args ? (torsoGeometry as any)(...args) : make!();
        m.geometry.dispose();
        m.geometry = g;
      }
    });
    this.skirts.forEach((sk) => sk.rebuildShape());
    this.anchors.forEach((f) => f());

    // skeleton proportions
    const hipF = bodyFactor(-0.06);
    const shF = bodyFactor(0.43);
    (['left', 'right'] as Side[]).forEach((sd) => {
      const sg = sd === 'left' ? 1 : -1;
      this.joints[`${sd}Hip` as JointName].position.x = sg * 0.085 * hipF;
      this.joints[`${sd}Clavicle` as JointName].position.x = sg * 0.02 * width;
      this.joints[`${sd}Shoulder` as JointName].position.x = sg * 0.13 * shF;
      this.joints[`${sd}Knee` as JointName].position.y = -THIGH.len * legK;
      this.joints[`${sd}Ankle` as JointName].position.y = -SHIN.len * legK;
      this.joints[`${sd}Elbow` as JointName] && this.scaleLimbMeshes(this.joints[`${sd}Elbow` as JointName], limbK, 1);
      this.scaleLimbMeshes(this.joints[`${sd}Shoulder` as JointName], limbK, 1);
      this.scaleLimbMeshes(this.joints[`${sd}Hip` as JointName], limbK * Math.sqrt(T.hip), legK);
      this.scaleLimbMeshes(this.joints[`${sd}Knee` as JointName], limbK, legK);
    });
    this.hipsBaseY = 0.93 + (THIGH.len + SHIN.len) * (legK - 1);
    this.joints.hips.position.y = this.hipsBaseY;
    this.root.updateMatrixWorld(true);
    if (this.hair) this.setHairStyle(this.hairStyle, true);
    return true;
  }

  /** Re-shape the head (face shape / roundness / nose) in place; the face decal shares these vertices. */
  private reshapeHead() {
    const p = this.headGeo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(this.headBase[i * 3], this.headBase[i * 3 + 1], this.headBase[i * 3 + 2]);
      this.deformHead(v);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    this.headGeo.computeVertexNormals();
    this.headGeo.computeBoundingSphere();
  }

  private applyFaceSettings(a: Partial<AppearanceConfig>) {
    const num = (v: any, d: number) => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? d : Number(v));
    const shape = (FACE_SHAPES as any)[String(a.faceShape ?? 'oval')] ? (String(a.faceShape ?? 'oval') as FaceShape) : 'oval';
    const round = clamp(num(a.faceRoundness, 50) / 100, 0, 1);
    const nose = clamp(0.5 + num(a.noseSize, 50) / 100, 0.6, 1.5);
    const eyeStyle = (EYE_STYLES as any)[String(a.eyeStyle ?? 'normal')] ? (String(a.eyeStyle ?? 'normal') as EyeStyle) : 'normal';
    const eyeK = clamp(0.7 + (0.6 * num(a.eyeSize, 50)) / 100, 0.75, 1.35);
    const mouthK = clamp(0.6 + (0.8 * num(a.mouthSize, 50)) / 100, 0.7, 1.45);

    const headKey = `${shape}|${round}|${nose}`;
    if (headKey !== this.faceKey) {
      this.faceKey = headKey;
      const base = FACE_SHAPES[shape];
      const k = 1 + (0.5 - round) * 0.7; // less round → more tapered jaw
      this.headParams = {
        ...base,
        taper1: base.taper1 * k,
        taper2: base.taper2 * k,
        chinPoint: base.chinPoint * k,
        cheek: Math.max(0, base.cheek + (round - 0.5) * 0.06),
        yLow: base.yLow - (round - 0.5) * 0.08,
        nose,
      };
      if (this.headGeo) this.reshapeHead();
    }
    const es = EYE_STYLES[eyeStyle];
    this.faceStyle = {
      eyeW: 0.0215 * es.w * eyeK,
      eyeH: 0.026 * es.h * eyeK,
      eyeTilt: es.tilt,
      wing: es.wing,
      noseScale: nose,
      mouthScale: mouthK,
    };
    const hs = String(a.hairStyle ?? this.hairStyle) as HairStyle;
    if (['long', 'short', 'curly', 'ponytail'].includes(hs) && hs !== this.hairStyle) this.setHairStyle(hs);
  }

  /** Rebuild the hair strands for another hairstyle. */
  public setHairStyle(style: HairStyle, force = false) {
    if (style === this.hairStyle && !force && this.hair) return;
    this.hairStyle = style;
    if (!this.hair) return;
    this.headContent.remove(this.hair.mesh);
    this.hair.mesh.geometry.dispose();
    this.buildHair();
  }

  private buildHead(hc: THREE.Group) {
    const headGeo = new THREE.SphereGeometry(0.115, 72, 54);
    const p = headGeo.attributes.position;
    this.headGeo = headGeo;
    this.headBase = new Float32Array(p.array as Float32Array);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      this.deformHead(v);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    headGeo.computeVertexNormals();
    this.faceSkinMat = new THREE.MeshToonMaterial({
      color: this.appearance.skinTone,
      gradientMap: toonGradient([212, 238, 255]),
    });
    const headMesh = new THREE.Mesh(headGeo, this.faceSkinMat);
    hc.add(headMesh);

    // Face decal: exact subset of head triangles + polygon offset (never hidden)
    this.face = new FaceCanvas(1024);
    const idx = headGeo.index!;
    const faceIdx: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      const ok = [a, b, c].every((k) => {
        const z = p.getZ(k);
        const y = p.getY(k);
        const x = p.getX(k);
        return z > 0.015 && y > FACE_REGION.y0 && y < FACE_REGION.y1 && x > FACE_REGION.x0 && x < FACE_REGION.x1;
      });
      if (ok) faceIdx.push(a, b, c);
    }
    const faceGeo = new THREE.BufferGeometry();
    faceGeo.setAttribute('position', p);
    faceGeo.setAttribute('normal', headGeo.attributes.normal);
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = (p.getX(i) - FACE_REGION.x0) / (FACE_REGION.x1 - FACE_REGION.x0);
      uv[i * 2 + 1] = (p.getY(i) - FACE_REGION.y0) / (FACE_REGION.y1 - FACE_REGION.y0);
    }
    faceGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    faceGeo.setIndex(faceIdx);
    const faceMat = new THREE.MeshBasicMaterial({
      map: this.face.texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    const faceMesh = new THREE.Mesh(faceGeo, faceMat);
    faceMesh.renderOrder = 1;
    hc.add(faceMesh);

    // Ears (mostly under the headphones)
    [-1, 1].forEach((s) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), this.skinMat);
      ear.scale.set(0.45, 1, 0.7);
      ear.position.set(s * 0.108, -0.02, -0.004);
      hc.add(ear);
    });

    // Hair cap (crown) — front hairline tilted up so the face stays clear
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.127, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.56),
      this.hairCapMat
    );
    cap.rotation.x = -0.42;
    cap.position.set(0, 0.004, -0.004);
    hc.add(cap);

    // Nape volume (static under-layer)
    const nape = new THREE.Mesh(
      new THREE.CylinderGeometry(0.122, 0.128, 0.2, 32, 1, true, Math.PI / 2 + 0.35, Math.PI - 0.7),
      this.hairCapMat
    );
    nape.material = this.hairCapMat;
    (nape.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    nape.position.set(0, -0.07, -0.012);
    hc.add(nape);
    this.napeMesh = nape;

  }

  private buildHeadphones(hc: THREE.Group) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.143, 0.0095, 12, 64, Math.PI), this.headphoneBandMat);
    band.position.set(0, -0.004, -0.004);
    hc.add(band);
    const pad = new THREE.Mesh(
      new THREE.TorusGeometry(0.135, 0.0075, 10, 40, Math.PI * 0.5),
      new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.6 })
    );
    pad.rotation.z = Math.PI * 0.25;
    pad.position.copy(band.position);
    hc.add(pad);

    const cupMat = new THREE.MeshStandardMaterial({ color: '#111116', roughness: 0.22, metalness: 0.6 });
    const cushionMat = new THREE.MeshStandardMaterial({ color: '#1c1c22', roughness: 0.8 });
    [-1, 1].forEach((s) => {
      const g = new THREE.Group();
      g.position.set(s * 0.138, -0.016, -0.004);
      hc.add(g);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.046, 0.03, 36), cupMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.x = s * 0.008;
      g.add(cup);
      const cushion = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.011, 10, 28), cushionMat);
      cushion.rotation.y = Math.PI / 2;
      cushion.position.x = -s * 0.008;
      g.add(cushion);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.0038, 8, 40), this.headphoneBandMat);
      rim.rotation.y = Math.PI / 2;
      rim.position.x = s * 0.024;
      g.add(rim);
      const glow = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0028, 8, 32), this.headphoneGlowMat);
      glow.rotation.y = Math.PI / 2;
      glow.position.x = s * 0.0245;
      g.add(glow);
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.009, 20), this.headphoneBandMat);
      dot.rotation.y = s * Math.PI / 2;
      dot.position.x = s * 0.0245;
      g.add(dot);
      // yoke
      const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.0035, 8, 24, Math.PI), this.headphoneBandMat);
      yoke.rotation.y = Math.PI / 2;
      yoke.position.x = s * 0.006;
      g.add(yoke);
    });
  }

  // --------------------------------------------------------------------------
  // Hair (strands with physics)
  // --------------------------------------------------------------------------

  private refreshCollisionMatrices() {
    this.headContent.updateWorldMatrix(true, false);
    this.hcM.copy(this.headContent.matrixWorld);
    this.hcInv.copy(this.hcM).invert();
    this.chestM.copy(this.joints.chest.matrixWorld);
    this.chestInv.copy(this.chestM).invert();
    this.hipsM.copy(this.joints.hips.matrixWorld);
    this.hipsInv.copy(this.hipsM).invert();
  }

  private pushOutEllipsoid(p: THREE.Vector3, c: THREE.Vector3, rx: number, ry: number, rz: number) {
    const dx = (p.x - c.x) / rx;
    const dy = (p.y - c.y) / ry;
    const dz = (p.z - c.z) / rz;
    const e = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (e < 1 && e > 1e-6) {
      p.set(c.x + (p.x - c.x) / e, c.y + (p.y - c.y) / e, c.z + (p.z - c.z) / e);
      return true;
    }
    return false;
  }

  private hairCollide(p: THREE.Vector3, k: number) {
    const a = this._a.copy(p).applyMatrix4(this.hcInv);
    let changed = false;
    const hc = new THREE.Vector3(0, -0.004, -0.006);
    changed = this.pushOutEllipsoid(a, hc, 0.128 * k, 0.131 * k, (a.z > -0.006 ? 0.117 : 0.14) * k) || changed;
    for (const s of [-1, 1]) {
      changed = this.pushOutEllipsoid(a, new THREE.Vector3(s * 0.142, -0.016, -0.004), 0.044 * k, 0.05 * k, 0.05 * k) || changed;
    }
    if (changed) p.copy(a).applyMatrix4(this.hcM);

    const b = this._b.copy(p).applyMatrix4(this.chestInv);
    const yh = b.y + CHEST_Y;
    changed = false;
    if (yh > -0.25 && yh < 0.52) {
      const { a: A, b: B } = torsoAB(Math.min(yh, 0.47));
      const ra = A * 1.07 * k + 0.012;
      const rb = B * 1.07 * k + 0.012;
      const e = Math.sqrt((b.x / ra) ** 2 + (b.z / rb) ** 2);
      if (e < 1) {
        b.x /= e;
        b.z /= e;
        changed = true;
      }
      for (const s of [-1, 1]) {
        changed = this.pushOutEllipsoid(b, new THREE.Vector3(s * 0.056, BUST_Y - CHEST_Y, 0.068), 0.062 * k, 0.062 * k, 0.062 * k) || changed;
        changed = this.pushOutEllipsoid(b, new THREE.Vector3(s * 0.152, 0.19, -0.005), 0.06 * k, 0.06 * k, 0.06 * k) || changed;
      }
      if (yh > 0.44) {
        const r = Math.hypot(b.x, b.z + 0.005);
        const rn = 0.048 * k;
        if (r < rn && r > 1e-6) {
          b.x *= rn / r;
          b.z = (b.z + 0.005) * (rn / r) - 0.005;
          changed = true;
        }
      }
    }
    if (changed) p.copy(b).applyMatrix4(this.chestM);
  }

  private drape(
    rootLocal: THREE.Vector3,
    step: number,
    opts: { length?: number; tipY?: number; drift?: number; driftBelow?: number }
  ): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const p = rootLocal.clone().applyMatrix4(this.hcM);
    pts.push(p.clone());
    const center = new THREE.Vector3(0, 0, -0.006).applyMatrix4(this.hcM);
    let total = 0;
    const loc = new THREE.Vector3();
    for (let i = 0; i < 80; i++) {
      const q = p.clone();
      q.y -= step;
      loc.copy(q).applyMatrix4(this.hcInv);
      if (opts.drift && loc.y < (opts.driftBelow ?? -0.12)) {
        const hx = center.x - q.x;
        const hz = center.z - 0.02 - q.z;
        const hl = Math.hypot(hx, hz) || 1;
        q.x += (hx / hl) * step * opts.drift;
        q.z += (hz / hl) * step * opts.drift;
      }
      this.hairCollide(q, 1.03);
      q.sub(p).normalize().multiplyScalar(step).add(p);
      this.hairCollide(q, 1.03);
      total += step;
      pts.push(q.clone());
      p.copy(q);
      loc.copy(q).applyMatrix4(this.hcInv);
      if (opts.tipY !== undefined && loc.y < opts.tipY) break;
      if (opts.length !== undefined && total >= opts.length) break;
    }
    return pts.map((w) => w.applyMatrix4(this.hcInv));
  }

  private scalpPoint(phi: number, elev: number, r = 0.123) {
    return new THREE.Vector3(
      r * Math.cos(elev) * Math.sin(phi),
      r * Math.sin(elev) - 0.002,
      r * Math.cos(elev) * Math.cos(phi) - 0.005
    );
  }

  private buildHair() {
    this.refreshCollisionMatrices();
    const defs: StrandDef[] = [];
    const S = HEAD_SCALE;
    const style = this.hairStyle;
    // length multipliers per hairstyle
    const L = {
      long: { side: 1, under: 1, back: 1 },
      short: { side: 0.5, under: 0.42, back: 0.46 },
      curly: { side: 0.9, under: 0.8, back: 0.82 },
      ponytail: { side: 0.42, under: 0, back: 1 },
    }[style];
    const curl = style === 'curly';
    const vol = curl ? 1.18 : 1;

    /** Spiral the strand (curly hair): offset grows from the root, keeps the overall drape. */
    const curlify = (pts: THREE.Vector3[], phase: number, amp = 0.016) => {
      if (!curl) return pts;
      const n = pts.length;
      return pts.map((p, i) => {
        if (i === 0) return p;
        const t = i / (n - 1);
        const a = phase + i * 1.35;
        const k = amp * smooth(0, 0.3, t) * (0.8 + 0.4 * t);
        return new THREE.Vector3(p.x + Math.cos(a) * k, p.y + Math.sin(a * 0.5) * k * 0.25, p.z + Math.sin(a) * k);
      });
    };

    // Blunt anime bangs (two interleaved layers), tips stop above the eyebrows
    for (let layer = 0; layer < 2; layer++) {
      const n = layer ? 12 : 13;
      for (let i = 0; i < n; i++) {
        const u = layer ? (i + 0.5) / 13 : i / 12;
        const phi = -0.92 + u * 1.84;
        const side = Math.abs(phi) / 0.92;
        const tipY = 0.044 + 0.006 * Math.sin(i * 2.1 + layer) - 0.02 * side * side + layer * 0.004;
        const rest = this.drape(this.scalpPoint(phi, 1.0 - side * 0.12), 0.011, { tipY: Math.max(tipY, 0.028) });
        defs.push({
          rest,
          width0: 0.03 * S * (curl ? 1.1 : 1),
          width1: 0.006 * S,
          thick0: 0.011 * S,
          thick1: 0.004 * S,
          stiff0: 0.65,
          stiff1: 0.28,
          shade: layer ? 0.92 : 1,
        });
      }
    }

    // Face-framing side locks (outside the eye area)
    [-1, 1].forEach((s) => {
      [0.98, 1.1, 1.22, 1.34].forEach((ph, k) => {
        const rest = this.drape(this.scalpPoint(s * ph, 0.5 - k * 0.06), 0.03, {
          length: (0.5 - k * 0.03) * L.side,
          drift: 0.35,
          driftBelow: -0.2,
        });
        defs.push({
          rest: curlify(rest, k * 1.7 + s),
          width0: 0.05 * S * vol,
          width1: 0.012 * S * vol,
          thick0: 0.009 * S,
          thick1: 0.004 * S,
          stiff0: 0.5,
          stiff1: curl ? 0.07 : 0.03,
          shade: k ? 0.9 : 1.02,
        });
      });
    });

    // Under-cup locks (fill the sides below the headphones)
    if (L.under > 0) {
      [-1, 1].forEach((s) => {
        [1.46, 1.6, 1.74].forEach((ph, k) => {
          const rest = this.drape(this.scalpPoint(s * ph, -0.55, 0.11), 0.035, {
            length: 0.5 * L.under,
            drift: 0.3,
            driftBelow: -0.18,
          });
          defs.push({
            rest: curlify(rest, k * 2.1 + s * 0.5),
            width0: 0.065 * S * vol,
            width1: 0.016 * S * vol,
            thick0: 0.01 * S,
            thick1: 0.004 * S,
            stiff0: 0.45,
            stiff1: curl ? 0.06 : 0.025,
            shade: 0.88,
          });
        });
      });
    }

    if (this.napeMesh) this.napeMesh.visible = style !== 'ponytail'; // the nape is visible with a ponytail
    if (style === 'ponytail') {
      // Back hair gathered over the scalp to a tie, then a swinging tail
      const tie = new THREE.Vector3(0, 0.03, -0.158);
      const onScalp = (p: THREE.Vector3) => {
        const c = new THREE.Vector3(0, -0.004, -0.006);
        const rz = p.z > -0.006 ? 0.12 : 0.145;
        const e = Math.hypot(p.x / 0.13, (p.y - c.y) / 0.133, (p.z - c.z) / rz);
        if (e < 1) p.set(p.x / e, c.y + (p.y - c.y) / e, c.z + (p.z - c.z) / e);
        return p;
      };
      const n = 26;
      for (let i = 0; i < n; i++) {
        const phi = 1.5 + (i / (n - 1)) * (Math.PI * 2 - 3.0);
        const root = this.scalpPoint(phi, i % 2 ? 0.25 : 0.62);
        const gather: THREE.Vector3[] = [];
        for (let k = 0; k <= 4; k++) gather.push(onScalp(root.clone().lerp(tie, k / 4)));
        const ang = (i / n) * Math.PI * 2;
        const start = tie.clone().add(new THREE.Vector3(Math.cos(ang) * 0.012, -0.004, Math.sin(ang) * 0.01 - 0.004));
        const tail = this.drape(start, 0.035, { length: 0.5 + 0.06 * Math.sin(i * 1.3), drift: 0.15, driftBelow: -0.12 });
        defs.push({
          rest: [...gather, ...tail.slice(1)],
          width0: 0.06 * S,
          width1: 0.014 * S,
          thick0: 0.01 * S,
          thick1: 0.005 * S,
          stiff0: 0.9,
          stiff1: 0.02,
          shade: i % 2 ? 0.82 : 1,
        });
      }
      if (!this.hairTie) {
        this.hairTie = new THREE.Mesh(new THREE.TorusGeometry(0.017, 0.0055, 10, 24), this.goldMat);
        this.hairTie.rotation.x = Math.PI / 2 - 0.5;
        this.headContent.add(this.hairTie);
      }
      this.hairTie.position.copy(tie).add(new THREE.Vector3(0, -0.006, -0.004));
      this.hairTie.visible = true;
    } else {
      if (this.hairTie) this.hairTie.visible = false;
      // Straight back hair: outer + inner layer
      const backLayers = [
        { n: 30, from: 1.84, elev: 0.72, len: 0.66, w: 0.075, shade: 1, step: 0.04 },
        { n: 22, from: 1.95, elev: 0.5, len: 0.6, w: 0.08, shade: 0.78, step: 0.04 },
      ];
      backLayers.forEach((B, li) => {
        for (let i = 0; i < B.n; i++) {
          const phi = B.from + (i / (B.n - 1)) * (Math.PI * 2 - 2 * B.from);
          const lenJitter = 1 + 0.06 * Math.sin(i * 1.7) - 0.05 * Math.abs(Math.cos(phi));
          const step = style === 'short' ? 0.028 : B.step;
          const rest = this.drape(this.scalpPoint(phi, B.elev), step, {
            length: B.len * lenJitter * L.back,
            drift: style === 'short' ? 0.6 : 0.45,
            driftBelow: -0.1,
          });
          defs.push({
            rest: curlify(rest, i * 0.9 + li * 2, 0.02),
            width0: B.w * S * vol,
            width1: (style === 'short' ? 0.035 : 0.02) * S * vol,
            thick0: 0.011 * S,
            thick1: 0.005 * S,
            stiff0: 0.42,
            stiff1: curl ? 0.06 : style === 'short' ? 0.05 : 0.018,
            shade: B.shade * (1 + 0.05 * Math.sin(i * 2.3)),
          });
        }
      });
    }

    this.hair = new StrandSystem(
      this.headContent,
      this.hairMat,
      defs,
      7,
      new THREE.Vector3(0, 0, -0.006),
      (t) => 0.72 + 0.34 * smooth(0, 0.45, t) + 0.08 * smooth(0.6, 1, t)
    );
  }

  private skirtCollide(p: THREE.Vector3) {
    const b = this._b.copy(p).applyMatrix4(this.hipsInv);
    if (b.y < 0.13 && b.y > -0.5) {
      const r = this.outerSkirt.radiusAt(b.y);
      const ra = r.a + 0.008;
      const rb = r.b + 0.008;
      const e = Math.sqrt((b.x / ra) ** 2 + (b.z / rb) ** 2);
      if (e < 1) {
        b.x /= e;
        b.z /= e;
        p.copy(b).applyMatrix4(this.hipsM);
      }
    }
  }

  private buildSash() {
    this.refreshCollisionMatrices();
    const spine = this.joints.spine;
    spine.updateWorldMatrix(true, false);
    const sM = spine.matrixWorld.clone();
    const sInv = sM.clone().invert();
    const defs: StrandDef[] = [];
    [-1, 1].forEach((s, k) => {
      const rootLocal = new THREE.Vector3(s * 0.022, 0.012, -(torsoAB(0.11).b * 1.075 + 0.014));
      const pts: THREE.Vector3[] = [];
      const p = rootLocal.clone().applyMatrix4(sM);
      pts.push(p.clone());
      for (let i = 0; i < 14; i++) {
        const q = p.clone();
        q.y -= 0.04;
        q.x += s * 0.004;
        this.skirtCollide(q);
        q.sub(p).normalize().multiplyScalar(0.04).add(p);
        this.skirtCollide(q);
        pts.push(q.clone());
        p.copy(q);
      }
      defs.push({
        rest: pts.map((w) => w.applyMatrix4(sInv)),
        width0: 0.042,
        width1: 0.05,
        thick0: 0.003,
        thick1: 0.003,
        stiff0: 0.4,
        stiff1: 0.03,
        phase: k * 2.1,
      });
    });
    this.sash = new StrandSystem(spine, this.sashMat, defs, 6, new THREE.Vector3(0, 0, 0));
    this.sash.mesh.renderOrder = 3;
  }

  // --------------------------------------------------------------------------
  // Limbs
  // --------------------------------------------------------------------------

  private buildArm(side: Side, chest: THREE.Group) {
    const s = side === 'left' ? 1 : -1;
    const P = side;
    const clav = this.joint(`${P}Clavicle` as JointName, chest, s * 0.02, 0.19, 0);
    const shoulder = this.joint(`${P}Shoulder` as JointName, clav, s * 0.13, 0, -0.005, 'XZY');

    const delt = new THREE.Mesh(new THREE.SphereGeometry(0.043, 20, 16), this.skinMat);
    delt.scale.set(1, 1.05, 0.95);
    delt.position.set(s * 0.004, -0.01, 0);
    shoulder.add(delt);
    shoulder.add(new THREE.Mesh(skinLimb(UPPER_ARM), this.skinMat));

    const elbow = this.joint(`${P}Elbow` as JointName, shoulder, 0, -0.27, 0, 'XYZ');
    elbow.add(new THREE.Mesh(skinLimb(FOREARM), this.skinMat));

    // Sheer opera glove (lower upper arm + elbow + forearm) with gold cuffs (Casual)
    const G = { scale: 1.07, add: 0.0025 };
    shoulder.add(this.addOutfitPart('casual', new THREE.Mesh(sleeveGeometry(UPPER_ARM, -0.14, -0.27, G.scale, G.add, 18), this.sheerMat)));
    const cuffTop = this.addOutfitPart(
      'casual',
      new THREE.Mesh(new THREE.TorusGeometry(sleeveRadius(UPPER_ARM, -0.14, G.scale, G.add) + 0.0022, 0.0028, 8, 28), this.goldMat)
    );
    cuffTop.rotation.x = Math.PI / 2;
    cuffTop.position.y = -0.14;
    shoulder.add(cuffTop);
    const gloveElbow = this.addOutfitPart(
      'casual',
      new THREE.Mesh(new THREE.SphereGeometry(Math.max(UPPER_ARM.rBot, FOREARM.rTop) * G.scale + G.add + 0.001, 16, 12), this.sheerMat)
    );
    elbow.add(gloveElbow);
    elbow.add(this.addOutfitPart('casual', new THREE.Mesh(sleeveGeometry(FOREARM, 0, -0.232, G.scale, G.add, 18), this.sheerMat)));
    const cuffWrist = this.addOutfitPart(
      'casual',
      new THREE.Mesh(new THREE.TorusGeometry(sleeveRadius(FOREARM, -0.225, G.scale, G.add) + 0.002, 0.0026, 8, 24), this.goldMat)
    );
    cuffWrist.rotation.x = Math.PI / 2;
    cuffWrist.position.y = -0.225;
    elbow.add(cuffWrist);

    // Tailored blazer sleeves + white shirt cuffs (Formal)
    const B = { scale: 1.12, add: 0.005 };
    const bShoulder = this.addOutfitPart('formal', new THREE.Mesh(new THREE.SphereGeometry(0.043 * B.scale + B.add, 20, 16), this.satinMat));
    bShoulder.scale.set(1, 1.05, 0.95);
    bShoulder.position.copy(delt.position);
    shoulder.add(bShoulder);
    shoulder.add(this.addOutfitPart('formal', new THREE.Mesh(sleeveGeometry(UPPER_ARM, 0, -0.27, B.scale, B.add, 18), this.satinMat)));
    elbow.add(
      this.addOutfitPart(
        'formal',
        new THREE.Mesh(new THREE.SphereGeometry(Math.max(UPPER_ARM.rBot, FOREARM.rTop) * B.scale + B.add, 16, 12), this.satinMat)
      )
    );
    elbow.add(this.addOutfitPart('formal', new THREE.Mesh(sleeveGeometry(FOREARM, 0, -0.205, B.scale, B.add, 18), this.satinMat)));
    const shirtCuff = this.addOutfitPart('formal', new THREE.Mesh(sleeveGeometry(FOREARM, -0.195, -0.232, 1.09, 0.003, 16), this.shirtWhiteMat));
    elbow.add(shirtCuff);

    const wrist = this.joint(`${P}Wrist` as JointName, elbow, 0, -0.24, 0);
    this.buildHand(side, wrist);
  }

  private buildHand(side: Side, wrist: THREE.Group) {
    const ts = side === 'left' ? 1 : -1; // thumb side (hand-local x)
    const hand = new THREE.Group();
    hand.rotation.y = side === 'left' ? -Math.PI / 2 : Math.PI / 2;
    wrist.add(hand);

    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), this.skinMat);
    palm.scale.set(0.033, 0.046, 0.0135);
    palm.position.set(0, -0.042, 0);
    hand.add(palm);
    const wristBall = new THREE.Mesh(new THREE.SphereGeometry(0.019, 12, 10), this.skinMat);
    wristBall.scale.set(1.2, 1, 0.75);
    hand.add(wristBall);

    const fingers: { f: FingerName; x: number; y: number; lens: number[]; r: number; tilt: number }[] = [
      { f: 'Index', x: 0.021, y: -0.083, lens: [0.027, 0.02, 0.016], r: 0.0076, tilt: 0.06 },
      { f: 'Middle', x: 0.007, y: -0.086, lens: [0.03, 0.022, 0.017], r: 0.0079, tilt: 0.0 },
      { f: 'Ring', x: -0.0075, y: -0.084, lens: [0.028, 0.02, 0.016], r: 0.0074, tilt: -0.05 },
      { f: 'Pinky', x: -0.021, y: -0.078, lens: [0.022, 0.016, 0.013], r: 0.0064, tilt: -0.11 },
    ];

    fingers.forEach((fd) => {
      const mount = new THREE.Group();
      mount.position.set(ts * fd.x, fd.y, 0);
      mount.rotation.z = ts * fd.tilt;
      hand.add(mount);
      let parent: THREE.Object3D = mount;
      fd.lens.forEach((len, k) => {
        const name = `${side}${fd.f}${k + 1}` as JointName;
        const j = this.joint(name, parent, 0, k === 0 ? 0 : -fd.lens[k - 1], 0);
        this.meta[name] = { mirror: 1, spreadSign: fd.f === 'Index' || fd.f === 'Middle' ? ts : -ts, finger: true };
        const r = fd.r * (1 - k * 0.1);
        const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - r), 4, 10), this.skinMat);
        seg.position.y = -len / 2;
        j.add(seg);
        if (k === 2) {
          const nail = new THREE.Mesh(new THREE.SphereGeometry(r * 0.8, 10, 8), this.goldMat);
          nail.scale.set(0.9, 1.3, 0.35);
          nail.position.set(0, -len + r * 0.9, -r * 0.7); // nail on the back of the finger
          j.add(nail);
        }
        parent = j;
      });
    });

    // Thumb with its own oriented mount
    const thumbMount = new THREE.Group();
    thumbMount.position.set(ts * 0.025, -0.022, 0.006);
    const d = new THREE.Vector3(ts * 0.55, -0.72, 0.42).normalize();
    const w = new THREE.Vector3(-ts, 0, 0.7);
    w.addScaledVector(d, -w.dot(d)).normalize();
    const yAxis = d.clone().negate();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, w).normalize();
    thumbMount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, w));
    hand.add(thumbMount);
    const lens = [0.03, 0.023, 0.019];
    let parent: THREE.Object3D = thumbMount;
    lens.forEach((len, k) => {
      const name = `${side}Thumb${k + 1}` as JointName;
      const j = this.joint(name, parent, 0, k === 0 ? 0 : -lens[k - 1], 0);
      this.meta[name] = { mirror: 1, spreadSign: 1, finger: true };
      const r = 0.0092 * (1 - k * 0.1);
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len - r), 4, 10), this.skinMat);
      seg.position.y = -len / 2;
      j.add(seg);
      parent = j;
    });
  }

  private buildLeg(side: Side, hips: THREE.Group) {
    const s = side === 'left' ? 1 : -1;
    const P = side;
    const hip = this.joint(`${P}Hip` as JointName, hips, s * 0.085, -0.06, 0, 'XZY');
    hip.add(new THREE.Mesh(skinLimb(THIGH), this.skinMat));

    const knee = this.joint(`${P}Knee` as JointName, hip, 0, -0.42, 0);
    knee.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), this.skinMat));
    knee.add(new THREE.Mesh(skinLimb(SHIN), this.skinMat));

    // Sheer thigh-high stockings with gold bands (Casual)
    const S = { scale: 1.035, add: 0.002 };
    hip.add(this.addOutfitPart('casual', new THREE.Mesh(sleeveGeometry(THIGH, -0.125, -0.42, S.scale, S.add, 20), this.sheerLegMat)));
    const band = this.addOutfitPart(
      'casual',
      new THREE.Mesh(new THREE.TorusGeometry(sleeveRadius(THIGH, -0.125, S.scale, S.add) + 0.003, 0.004, 8, 32), this.goldMat)
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.125;
    hip.add(band);
    const kneeR = Math.max(THIGH.rBot, SHIN.rTop, 0.045);
    knee.add(this.addOutfitPart('casual', new THREE.Mesh(new THREE.SphereGeometry(kneeR * S.scale + S.add + 0.0015, 16, 12), this.sheerLegMat)));
    knee.add(this.addOutfitPart('casual', new THREE.Mesh(sleeveGeometry(SHIN, 0, -0.395, S.scale, S.add, 20), this.sheerLegMat)));

    // Tailored fitted trousers (Formal)
    const T = { scale: 1.1, add: 0.005 };
    hip.add(this.addOutfitPart('formal', new THREE.Mesh(sleeveGeometry(THIGH, 0.02, -0.42, T.scale, T.add, 20), this.satinMat)));
    knee.add(this.addOutfitPart('formal', new THREE.Mesh(new THREE.SphereGeometry(kneeR * T.scale + T.add, 16, 12), this.satinMat)));
    knee.add(this.addOutfitPart('formal', new THREE.Mesh(sleeveGeometry(SHIN, 0, -0.37, T.scale, T.add, 20), this.satinMat)));

    // Sporty short cuffs + white athletic socks (Sporty)
    hip.add(this.addOutfitPart('sporty', new THREE.Mesh(sleeveGeometry(THIGH, 0.02, -0.11, 1.1, 0.005, 20), this.satinMat)));
    knee.add(this.addOutfitPart('sporty', new THREE.Mesh(sleeveGeometry(SHIN, -0.26, -0.4, 1.08, 0.003, 18), this.shirtWhiteMat)));

    const ankle = this.joint(`${P}Ankle` as JointName, knee, 0, -0.4, 0);
    ankle.add(new THREE.Mesh(new THREE.SphereGeometry(0.027, 12, 10), this.skinMat));

    // Pointed pump with gold heel
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.shoeMat);
    shoe.scale.set(0.034, 0.026, 0.085);
    shoe.position.set(0, -0.032, 0.05);
    shoe.rotation.x = 0.36;
    ankle.add(shoe);
    const toe = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 14), this.shoeMat);
    toe.rotation.x = Math.PI / 2 + 0.36;
    toe.position.set(0, -0.058, 0.122);
    toe.scale.set(1, 1, 0.6);
    ankle.add(toe);
    const heel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.004, 0.065, 10), this.goldMat);
    heel.position.set(0, -0.06, -0.022);
    ankle.add(heel);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0025, 6, 24), this.goldMat);
    strap.rotation.x = Math.PI / 2;
    strap.position.y = -0.002;
    ankle.add(strap);
  }

  // ==========================================================================
  // Joint control
  // ==========================================================================

  private toInternal(name: string, v: { x: number; y: number; z: number }, out: THREE.Euler) {
    const m = this.meta[name];
    if (!m) return out.set(v.x, v.y, v.z);
    if (m.finger) return out.set(-v.x, 0, v.z * m.spreadSign);
    return out.set(v.x, v.y * m.mirror, v.z * m.mirror);
  }

  public setJointAngles(angles: Partial<Record<JointName, JointEuler>>) {
    if (!angles) return;
    (Object.keys(angles) as JointName[]).forEach((name) => {
      const e = angles[name];
      const t = this.target[name];
      if (!e || !t) return;
      const L = limitsFor(name);
      if (e.x !== undefined) t.x = clamp(e.x, L.x[0], L.x[1]);
      if (e.y !== undefined) t.y = clamp(e.y, L.y[0], L.y[1]);
      if (e.z !== undefined) t.z = clamp(e.z, L.z[0], L.z[1]);
    });
  }

  public setHandGesture(side: Side | 'both', gesture: HandGesture) {
    const sides: Side[] = side === 'both' ? ['left', 'right'] : [side];
    sides.forEach((sd) => {
      this.hands[sd === 'left' ? 0 : 1] = gesture;
      const shape = HAND_SHAPES[gesture] ?? HAND_SHAPES.relaxed;
      const angles: Partial<Record<JointName, JointEuler>> = {};
      FINGERS.forEach((f) => {
        const [c1, c2, c3, spread] = shape[f];
        angles[`${sd}${f}1` as JointName] = { x: c1, z: spread };
        angles[`${sd}${f}2` as JointName] = { x: c2 };
        angles[`${sd}${f}3` as JointName] = { x: c3 };
      });
      this.setJointAngles(angles);
    });
  }

  /**
   * Sets the default pose. 'auto' rotates the default pose randomly over time.
   * With idle cycling on she also occasionally varies it and comes back.
   */
  public setPose(pose: PoseName | 'auto') {
    if (pose === 'auto' && this.autoPose) return; // already rotating: keep the current pose
    this.holdUntil = 0;
    if (pose === 'auto') {
      this.autoPose = true;
      this.basePose = this.pickAutoPose();
      this.autoTimer = 14 + Math.random() * 14;
    } else {
      this.autoPose = false;
      this.basePose = pose in POSES ? pose : 'idle';
    }
    this.cycleUntil = 0;
    this.cycleTimer = 8 + Math.random() * 6;
    this.applyPose(this.basePose);
  }

  /** Temporary pose (e.g. asked by Hermes): shown for `seconds`, then back to the default behaviour. */
  public holdPose(pose: PoseName, seconds = 10) {
    if (!(pose in POSES)) return;
    this.cycleUntil = 0;
    this.applyPose(pose);
    this.holdUntil = seconds > 0 ? this.time + seconds : Infinity;
  }

  public getDefaultPose(): PoseName | 'auto' {
    return this.autoPose ? 'auto' : this.basePose;
  }

  private pickAutoPose(): PoseName {
    const pool: PoseName[] = ['idle', 'idle', 'idle', 'listening', 'thinking', 'focused', 'happy', 'explaining', 'dancing', 'greeting'];
    const opts = pool.filter((p) => p !== this.basePose);
    return opts[Math.floor(Math.random() * opts.length)];
  }

  private applyPose(pose: PoseName) {
    const def = POSES[pose] ?? POSES.idle;
    this.currentPose = pose in POSES ? pose : 'idle';
    BODY_JOINTS.forEach((n) => this.target[n] && (this.target[n].x = this.target[n].y = this.target[n].z = 0));
    this.setJointAngles(def.joints);
    this.setHandGesture('left', def.hands[0]);
    this.setHandGesture('right', def.hands[1]);
  }

  public getPose(): PoseName {
    return this.basePose;
  }

  // ==========================================================================
  // Face control
  // ==========================================================================

  public setEmotion(emotion: EmotionName, intensity = 1) {
    const k = clamp(intensity, 0, 1);
    const f = this.targetFace;
    f.emotion = emotion;
    f.smile = 0.66;
    f.eyebrowTilt = 0;
    f.eyebrowRaise = 0;
    f.browAsym = 0;
    f.leftEyeOpen = 1;
    f.rightEyeOpen = 1;
    f.blush = 0.15;
    f.happyEyes = 0;
    f.squint = 0.1;
    f.mouthOpen = 0;
    this.emotionGaze = { x: 0, y: 0 };
    const mix = (base: number, v: number) => base + (v - base) * k;

    switch (emotion) {
      case 'happy':
        f.smile = mix(0.66, 0.95);
        f.eyebrowRaise = 0.3 * k;
        f.squint = mix(0.1, 0.45);
        f.blush = mix(0.15, 0.45);
        break;
      case 'excited':
        f.smile = 1;
        f.mouthOpen = 0.3 * k;
        f.happyEyes = 1 * k;
        f.eyebrowRaise = 0.6 * k;
        f.blush = mix(0.15, 0.6);
        break;
      case 'thinking':
        f.smile = mix(0.66, 0.15);
        f.browAsym = 0.7 * k;
        f.eyebrowTilt = 0.15 * k;
        f.squint = 0.25;
        this.emotionGaze = { x: 0.35 * k, y: 0.4 * k };
        break;
      case 'curious':
        f.smile = mix(0.66, 0.35);
        f.eyebrowRaise = 0.5 * k;
        f.browAsym = 0.35 * k;
        f.squint = -0.15;
        break;
      case 'surprised':
        f.smile = 0.05;
        f.mouthOpen = 0.45 * k;
        f.eyebrowRaise = 1 * k;
        f.squint = -0.3 * k;
        break;
      case 'sad':
        f.smile = mix(0.66, -0.55);
        f.eyebrowTilt = 0.9 * k;
        f.leftEyeOpen = f.rightEyeOpen = mix(1, 0.72);
        f.blush = 0.08;
        this.emotionGaze = { x: 0, y: -0.35 * k };
        break;
      case 'concerned':
        f.smile = mix(0.66, -0.15);
        f.eyebrowTilt = 0.6 * k;
        f.leftEyeOpen = f.rightEyeOpen = 0.92;
        break;
      case 'confident':
        f.smile = mix(0.66, 0.7);
        f.eyebrowTilt = -0.3 * k;
        f.squint = 0.3;
        f.leftEyeOpen = f.rightEyeOpen = 0.9;
        break;
      case 'playful':
      case 'wink':
        f.smile = mix(0.66, 0.85);
        f.rightEyeOpen = 0.04;
        f.browAsym = 0.3 * k;
        f.blush = mix(0.15, 0.4);
        f.squint = 0.3;
        break;
      case 'neutral':
      default:
        break;
    }
  }

  public setFacialState(partial: Partial<FacialState>) {
    if (!partial) return;
    if (partial.emotion) this.setEmotion(partial.emotion);
    const f = this.targetFace;
    if (partial.mouthOpen !== undefined) f.mouthOpen = clamp(partial.mouthOpen, 0, 1);
    if (partial.smile !== undefined) f.smile = clamp(partial.smile, -1, 1);
    if (partial.eyebrowTilt !== undefined) f.eyebrowTilt = clamp(partial.eyebrowTilt, -1, 1);
    if (partial.eyebrowRaise !== undefined) f.eyebrowRaise = clamp(partial.eyebrowRaise, -1, 1);
    if (partial.leftEyeOpen !== undefined) f.leftEyeOpen = clamp(partial.leftEyeOpen, 0, 1);
    if (partial.rightEyeOpen !== undefined) f.rightEyeOpen = clamp(partial.rightEyeOpen, 0, 1);
    if (partial.blush !== undefined) f.blush = clamp(partial.blush, 0, 1);
    if (partial.happyEyes !== undefined) f.happyEyes = clamp(partial.happyEyes, 0, 1);
    if (partial.squint !== undefined) f.squint = clamp(partial.squint, -1, 1);
    if (partial.browAsym !== undefined) f.browAsym = clamp(partial.browAsym, -1, 1);
    if (partial.lookAt) {
      f.lookAt = { x: clamp(partial.lookAt.x, -1, 1), y: clamp(partial.lookAt.y, -1, 1) };
    }
  }

  // ==========================================================================
  // Speech / lip-sync
  // ==========================================================================

  public setSpeaking(speaking: boolean, intensity = 0.75) {
    this.speaking = speaking;
    this.speakIntensity = clamp(intensity, 0.1, 1);
    if (!speaking) {
      this.lipSeq = null;
      this.targetFace.mouthOpen = 0;
    }
  }

  /** Text-driven lip-sync: maps characters to visemes spread over durationMs. */
  public speakText(text: string, durationMs?: number) {
    const clean = (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (!clean.trim()) {
      this.setSpeaking(true);
      return;
    }
    const units = Array.from(clean).map(charToViseme);
    const totalW = units.reduce((s, u) => s + u.w, 0);
    const dur = (durationMs ?? clamp(clean.length * 65, 1200, 12000)) / 1000;
    const per = clamp(dur / totalW, 0.045, 0.14);
    let t = 0;
    const seq: { v: Viseme; t0: number; t1: number }[] = [];
    units.forEach((u) => {
      const d = u.w * per;
      seq.push({ v: u.v, t0: t, t1: t + d });
      t += d;
    });
    this.lipSeq = seq;
    this.lipStart = this.time;
    this.speaking = true;
  }

  /** Real-time viseme input (e.g. from a TTS engine). */
  public setViseme(v: Viseme, weight = 1, holdMs = 150) {
    this.externalViseme = { v: VISEMES[v] ? v : 'rest', w: clamp(weight, 0, 1), until: this.time + holdMs / 1000 };
  }

  /** Real-time mouth amplitude (0..1), e.g. from audio level. */
  public setMouthLevel(level: number) {
    this.externalViseme = { v: 'A', w: clamp(level, 0, 1), until: this.time + 0.15 };
  }

  // ==========================================================================
  // Misc API
  // ==========================================================================

  /** Enable screen-companion locomotion (root yaw becomes driven by movement). */
  public enableLocomotion(on: boolean) {
    this.loco.active = on;
  }

  /**
   * Locomotion state from the companion engine.
   * speedBH / vyBH are in body heights per second (vy > 0 = moving down).
   */
  public setLocomotion(state: LocoAnim, facing: number, speedBH = 0, vyBH = 0, lookX = 0) {
    if (state !== this.loco.state) {
      this.loco.t = 0;
      if (state === 'run' || state === 'grabbed' || state === 'climb' || state === 'climb_down') {
        this.setHandGesture('both', 'fist');
      } else if (this.loco.state === 'run' || this.loco.state === 'grabbed' || this.loco.state.startsWith('climb')) {
        this.setHandGesture('left', POSES[this.currentPose].hands[0]);
        this.setHandGesture('right', POSES[this.currentPose].hands[1]);
      }
    }
    this.loco.state = state;
    this.loco.facing = facing >= 0 ? 1 : -1;
    this.loco.speed = speedBH;
    this.loco.vy = vyBH;
    this.loco.lookX = lookX;
  }

  /** Inertial force for hair (scene units / s²), e.g. from window acceleration. */
  public setExternalAcceleration(ax: number, ay: number) {
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return this.hairExt.set(0, 0, 0) && undefined;
    this.hairExt.set(-ax, -ay, 0).clampLength(0, 40);
  }

  public pointAtNormalized(nx: number, ny: number) {
    this.holdPose('pointing', 4);
    this.setJointAngles({
      chest: { y: nx * 0.3 },
      head: { y: nx * 0.45, x: -ny * 0.25 },
      rightShoulder: { x: -1.45 - ny * 0.7, y: 0.1, z: clamp(0.15 - nx * 0.9, -0.35, 1.3) },
      rightElbow: { x: -0.05 },
    });
    this.setFacialState({ lookAt: { x: nx, y: ny } });
  }

  public updateAppearance(partial: Partial<AppearanceConfig>) {
    this.appearance = { ...this.appearance, ...partial };
    if (['bodyType', 'bodyHeight', 'bodyWidth', 'shoulderWidth', 'waistSize'].some((k) => (partial as any)[k] !== undefined)) {
      this.bodyChanged = this.applyBody(this.appearance) || this.bodyChanged;
    }
    if (
      ['faceShape', 'faceRoundness', 'eyeStyle', 'eyeSize', 'noseSize', 'mouthSize', 'hairStyle'].some(
        (k) => (partial as any)[k] !== undefined
      )
    ) {
      this.applyFaceSettings(this.appearance);
    }
    if (partial.skinTone) {
      this.skinMat.color.set(partial.skinTone);
      this.faceSkinMat.color.set(partial.skinTone);
    }
    if (partial.hairColor) {
      this.hairMat.color.set(partial.hairColor);
      this.hairCapMat.color.set(partial.hairColor).multiplyScalar(0.92);
      this.hairShineMat.color.set(partial.hairColor).lerp(new THREE.Color('#FFF6DA'), 0.55);
    }
    if (partial.headphoneColor || partial.accessoryColor) {
      const hc = partial.accessoryColor || partial.headphoneColor || '#E6C26E';
      this.headphoneBandMat.color.set(hc);
      this.headphoneBandMat.emissive.set(hc).multiplyScalar(0.15);
    }
    if (partial.shoeColor) {
      this.shoeMat.color.set(partial.shoeColor);
    }
    if (partial.outfit) {
      this.applyOutfitStyle(partial.outfit);
    }
    if (partial.outfit || partial.clothingColor || partial.accessoryColor) {
      const p = this.getOutfitPrimaryColor();
      const a = this.getOutfitAccentColor();
      this.satinMat.color.copy(p);
      this.sheerMat.color.copy(p).lerp(new THREE.Color('#2a2430'), 0.4);
      this.goldMat.color.copy(a);
      this.goldMat.emissive.copy(a).multiplyScalar(0.18);
      this.sashMat.color.copy(a);
      this.skirts.forEach((sk, i) => {
        const col = sk.mesh.geometry.attributes.color as THREE.BufferAttribute;
        const body = i ? p.clone().lerp(new THREE.Color('#2a2430'), 0.4) : p;
        // colours: band rows are the last two rings
        const per = col.count / 12;
        for (let v = 0; v < col.count; v++) {
          const c = v >= per * 10 ? a : body;
          col.setXYZ(v, c.r, c.g, c.b);
        }
        col.needsUpdate = true;
      });
    }
  }

  public async loadCustomModel(url: string): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    if (this.customModel) this.root.remove(this.customModel);
    this.customModel = gltf.scene;
    this.joints.hips.visible = false;
    this.root.add(this.customModel);
  }

  // ==========================================================================
  // Per-frame update
  // ==========================================================================

  private computeLocomotion(dt: number) {
    const L = this.loco;
    L.t += dt;
    const T: Partial<Record<JointName, { x: number; y: number; z: number }>> = {};
    const set = (n: JointName, x = 0, y = 0, z = 0) => (T[n] = { x, y, z });
    let hipsDy = 0;
    let yaw = this.behavior.idleTurn ? clamp(L.lookX * 0.35, -0.35, 0.35) + 0.05 : 0.05;
    const st = L.state;
    const moving = st !== 'idle';

    if (st === 'walk' || st === 'run') {
      const run = st === 'run';
      const f = run ? clamp(L.speed / 1.5, 1.1, 3.2) : clamp(L.speed / 0.9, 0.5, 2.2);
      L.phase += dt * Math.PI * 2 * f;
      const sN = Math.sin(L.phase);
      const cN = Math.cos(L.phase);
      const A = run ? 0.72 : 0.4;
      const K = run ? 1.5 : 0.75;
      set('leftHip', -A * sN, 0, 0.03);
      set('rightHip', A * sN, 0, 0.03);
      set('leftKnee', 0.08 + K * Math.pow(Math.max(0, cN), 1.3));
      set('rightKnee', 0.08 + K * Math.pow(Math.max(0, -cN), 1.3));
      set('leftAnkle', 0.12 * sN + (run ? 0.15 : 0));
      set('rightAnkle', -0.12 * sN + (run ? 0.15 : 0));
      set('leftShoulder', A * 0.85 * sN, 0.15, 0.14);
      set('rightShoulder', -A * 0.85 * sN, 0.15, 0.14);
      set('leftElbow', run ? -1.35 : -0.3 - 0.2 * Math.max(0, -sN));
      set('rightElbow', run ? -1.35 : -0.3 - 0.2 * Math.max(0, sN));
      set('spine', run ? 0.12 : 0.02, 0.07 * sN, 0);
      set('hips', 0, -0.09 * sN, 0);
      set('head', run ? -0.08 : 0, -0.04 * sN, 0);
      hipsDy = -(run ? 0.035 : 0.014) * Math.abs(cN);
      yaw = L.facing * 1.15;
    } else if (st === 'prejump' || st === 'land') {
      const k = st === 'land' ? Math.max(0, 1 - L.t / 0.22) : Math.min(1, L.t / 0.1);
      set('leftHip', -0.6 * k, 0, 0.05);
      set('rightHip', -0.6 * k, 0, 0.05);
      set('leftKnee', 1.15 * k);
      set('rightKnee', 1.15 * k);
      set('leftAnkle', -0.5 * k);
      set('rightAnkle', -0.5 * k);
      set('spine', 0.3 * k);
      set('leftShoulder', 0.5 * k, 0, 0.2);
      set('rightShoulder', 0.5 * k, 0, 0.2);
      set('leftElbow', -0.4);
      set('rightElbow', -0.4);
      hipsDy = -0.1 * k;
      yaw = L.facing * 0.7;
    } else if (st === 'jump' && L.vy <= 0.2) {
      set('leftHip', -1.0, 0, 0.08);
      set('rightHip', -0.7, 0, 0.08);
      set('leftKnee', 1.6);
      set('rightKnee', 1.2);
      set('leftAnkle', 0.5);
      set('rightAnkle', 0.5);
      set('leftShoulder', -0.4, 0, 2.3);
      set('rightShoulder', -0.4, 0, 2.3);
      set('leftElbow', -0.35);
      set('rightElbow', -0.35);
      set('spine', -0.1);
      set('head', -0.15);
      yaw = L.facing * 0.8;
    } else if (st === 'fall' || st === 'jump') {
      const fl = Math.sin(L.t * 14);
      set('leftHip', -0.45, 0, 0.12);
      set('rightHip', -0.2, 0, 0.12);
      set('leftKnee', 0.7);
      set('rightKnee', 0.35);
      set('leftAnkle', 0.3);
      set('rightAnkle', 0.3);
      set('leftShoulder', -0.2, 0, 1.55 + 0.25 * fl);
      set('rightShoulder', -0.2, 0, 1.55 - 0.25 * fl);
      set('leftElbow', -0.5);
      set('rightElbow', -0.5);
      set('head', 0.22);
      yaw = L.facing * 0.6;
    } else if (st === 'climb' || st === 'climb_down') {
      const dir = st === 'climb' ? 1 : -1;
      L.phase += dt * Math.PI * 2 * clamp(L.speed / 0.45, 0.6, 2.2) * dir;
      const sN = Math.sin(L.phase);
      set('leftShoulder', -2.75 + 0.35 * sN, 0, 0.3);
      set('rightShoulder', -2.75 - 0.35 * sN, 0, 0.3);
      set('leftElbow', -0.55 - 0.45 * Math.max(0, -sN));
      set('rightElbow', -0.55 - 0.45 * Math.max(0, sN));
      set('leftHip', -0.75 + 0.45 * sN, 0, 0.15);
      set('rightHip', -0.75 - 0.45 * sN, 0, 0.15);
      set('leftKnee', 1.05 - 0.5 * sN);
      set('rightKnee', 1.05 + 0.5 * sN);
      set('head', -0.3);
      set('spine', 0.05);
      yaw = Math.PI;
    } else if (st === 'grabbed') {
      const k = Math.sin(L.t * 9);
      set('leftShoulder', 0.2 * k, 0, 0.45 + 0.1 * k);
      set('rightShoulder', -0.2 * k, 0, 0.45 - 0.1 * k);
      set('leftElbow', -0.6);
      set('rightElbow', -0.6);
      set('leftHip', -0.25 + 0.45 * k, 0, 0.08);
      set('rightHip', -0.25 - 0.45 * k, 0, 0.08);
      set('leftKnee', 0.6 + 0.3 * k);
      set('rightKnee', 0.6 - 0.3 * k);
      set('head', 0.1, 0, 0.1 * k);
      yaw = 0;
    }

    this.locoTargets = T;
    L.w = damp(L.w, moving ? 1 : 0, 12, dt);
    // shortest-angle damping of yaw
    let d = yaw - L.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    L.yaw += d * (1 - Math.exp(-(st === 'climb' || st === 'climb_down' ? 10 : 8) * dt));
    this.root.rotation.y = L.yaw;
    return hipsDy;
  }

  private _q = new THREE.Quaternion();
  /** Thigh and shin capsules in hips space (for cloth collision). */
  private legCapsules(): Capsule[] {
    const out: Capsule[] = [];
    (['left', 'right'] as Side[]).forEach((sd) => {
      const hip = this.joints[`${sd}Hip` as JointName];
      const knee = this.joints[`${sd}Knee` as JointName];
      const a = hip.position.clone();
      const kneeP = new THREE.Vector3(0, -THIGH.len * this.legK, 0).applyQuaternion(hip.quaternion).add(a);
      this._q.copy(hip.quaternion).multiply(knee.quaternion);
      const ankleP = new THREE.Vector3(0, -SHIN.len * this.legK, 0).applyQuaternion(this._q).add(kneeP);
      out.push({ a, b: kneeP, r: (THIGH.rTop + THIGH.bulgeAmt + 0.004) * this.limbK });
      out.push({ a: kneeP, b: ankleP, r: (SHIN.rTop + SHIN.bulgeAmt * 0.5 + 0.004) * this.limbK });
    });
    return out;
  }

  private _e = new THREE.Euler();
  private applyJoints(extra: Record<string, { x?: number; y?: number; z?: number }>, dt = 1) {
    ALL_JOINTS.forEach((n) => {
      const j = this.joints[n];
      if (!j) return;
      const t = this.target[n];
      const c = this.current[n];
      const ex = extra[n];
      const lam = this.meta[n]?.finger ? 14 : 8;
      let tx = t.x + (ex?.x ?? 0);
      let ty = t.y + (ex?.y ?? 0);
      let tz = t.z + (ex?.z ?? 0);
      const lt = this.locoTargets[n];
      const w = this.loco.w;
      if (lt && w > 0.001) {
        tx += (lt.x - tx) * w;
        ty += (lt.y - ty) * w;
        tz += (lt.z - tz) * w;
      }
      const fast = this.loco.active && this.loco.state !== 'idle';
      c.x = damp(c.x, tx, fast ? 18 : lam, dt);
      c.y = damp(c.y, ty, fast ? 18 : lam, dt);
      c.z = damp(c.z, tz, fast ? 18 : lam, dt);
      const L = limitsFor(n);
      const v = {
        x: clamp(c.x, L.x[0] - 0.2, L.x[1] + 0.2),
        y: clamp(c.y, L.y[0] - 0.2, L.y[1] + 0.2),
        z: clamp(c.z, L.z[0] - 0.2, L.z[1] + 0.2),
      };
      this.toInternal(n, v, this._e);
      j.rotation.set(this._e.x, this._e.y, this._e.z);
    });
  }

  public update(dt: number, elapsed: number) {
    this.time = elapsed;
    const T = elapsed;
    const extra: Record<string, { x?: number; y?: number; z?: number }> = {};
    const add = (n: string, x = 0, y = 0, z = 0) => {
      const e = (extra[n] ??= { x: 0, y: 0, z: 0 });
      e.x! += x;
      e.y! += y;
      e.z! += z;
    };

    // --- breathing ---
    const breath = Math.sin((T * Math.PI * 2) / 4.2);
    const b01 = 0.5 + 0.5 * breath;
    this.chestVolume.scale.set(1 + 0.012 * b01, 1 + 0.006 * b01, 1 + 0.02 * b01);
    add('chest', -0.012 * breath);
    add('leftClavicle', 0, 0, 0.025 * b01);
    add('rightClavicle', 0, 0, 0.025 * b01);
    add('head', 0.008 * breath);

    // --- idle weight shift ---
    if (this.behavior.idleMotion) {
      add('hips', 0, Math.sin(T * 0.31) * 0.025, Math.sin(T * 0.47) * 0.018);
      add('spine', 0, 0, -Math.sin(T * 0.47) * 0.014);
    }

    // --- gaze: eyes + head follow ---
    this.saccade.timer -= dt;
    if (this.saccade.timer <= 0) {
      this.saccade.timer = 0.8 + Math.random() * 2.6;
      this.saccade.x = (Math.random() - 0.5) * 0.18;
      this.saccade.y = (Math.random() - 0.5) * 0.12;
    }
    const lookTX = clamp(this.targetFace.lookAt.x + this.emotionGaze.x + this.saccade.x, -1, 1);
    const lookTY = clamp(this.targetFace.lookAt.y + this.emotionGaze.y + this.saccade.y, -1, 1);
    const cf = this.currentFace;
    cf.lookAt.x = damp(cf.lookAt.x, lookTX, 14, dt);
    cf.lookAt.y = damp(cf.lookAt.y, lookTY, 14, dt);
    add('head', -cf.lookAt.y * 0.16, cf.lookAt.x * 0.3, 0);
    add('neck', -cf.lookAt.y * 0.06, cf.lookAt.x * 0.1, 0);

    // --- pose-specific procedural motion ---
    switch (this.currentPose) {
      case 'waving':
      case 'greeting':
        add('rightShoulder', 0, Math.sin(T * 7) * 0.35, 0);
        add('rightWrist', 0, 0, Math.sin(T * 7 + 0.6) * 0.15);
        break;
      case 'nodding':
        add('head', Math.sin(T * 6.5) * 0.16);
        break;
      case 'shaking_head':
        add('head', 0, Math.sin(T * 7.5) * 0.24);
        break;
      case 'explaining':
        add('leftElbow', Math.sin(T * 4.2) * 0.14);
        add('rightElbow', Math.cos(T * 4.2) * 0.14);
        add('head', 0, Math.sin(T * 2.1) * 0.06);
        break;
      case 'celebrating':
      case 'happy':
        add('leftShoulder', 0, 0, Math.sin(T * 6) * 0.08);
        add('rightShoulder', 0, 0, Math.sin(T * 6 + Math.PI) * 0.08);
        add('head', 0, 0, Math.sin(T * 3) * 0.05);
        break;
      case 'dancing': {
        const b = T * Math.PI * 2 * 1.05; // ~126 bpm
        add('hips', 0, Math.sin(b * 0.5) * 0.25, Math.sin(b) * 0.09);
        add('spine', 0, -Math.sin(b * 0.5) * 0.12, -Math.sin(b) * 0.07);
        add('chest', 0, Math.sin(b * 0.5) * 0.1, 0);
        add('head', Math.sin(b) * 0.08, 0, Math.sin(b * 0.5) * 0.12);
        add('leftShoulder', Math.sin(b) * 0.35, 0, Math.sin(b * 0.5) * 0.45);
        add('rightShoulder', -Math.sin(b) * 0.35, 0, -Math.sin(b * 0.5) * 0.45);
        add('leftElbow', Math.sin(b + 1) * 0.35);
        add('rightElbow', Math.sin(b + 2) * 0.35);
        add('leftKnee', Math.max(0, Math.sin(b)) * 0.35);
        add('rightKnee', Math.max(0, -Math.sin(b)) * 0.35);
        add('leftHip', -Math.max(0, Math.sin(b)) * 0.2);
        add('rightHip', -Math.max(0, -Math.sin(b)) * 0.2);
        break;
      }
      case 'idle':
      case 'listening':
        if (this.behavior.idleMotion) add('head', 0, Math.sin(T * 0.7) * 0.05, Math.cos(T * 0.5) * 0.025);
        break;
    }
    const bounce =
      this.currentPose === 'celebrating' || this.currentPose === 'happy'
        ? Math.abs(Math.sin(T * 6)) * 0.018
        : this.currentPose === 'dancing'
          ? -Math.abs(Math.sin(T * Math.PI * 2 * 1.05)) * 0.03
          : 0;
    const locoDy = this.loco.active ? this.computeLocomotion(dt) : 0;
    this.updateIdleCycle(dt);
    this.joints.hips.position.y = this.hipsBaseY + bounce + locoDy;

    // talking adds small head motion
    if (this.speaking) add('head', Math.sin(T * 5.3) * 0.02, Math.sin(T * 2.7) * 0.03, Math.sin(T * 3.1) * 0.015);

    this.applyJoints(extra, dt);

    // --- blinking ---
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkT < 0) {
      this.blinkT = 0;
      this.doubleBlink = Math.random() < 0.18;
      this.blinkTimer = 2.2 + Math.random() * 3.6;
    }
    let blink = 1;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const d = 0.16;
      const p = this.blinkT / d;
      if (p >= 1) {
        this.blinkT = -1;
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.blinkTimer = 0.12;
        }
      } else blink = 1 - Math.sin(p * Math.PI);
    }

    // --- mouth: lip-sync ---
    let vis = VISEMES.rest;
    let vw = 0;
    if (this.externalViseme && this.time < this.externalViseme.until) {
      vis = VISEMES[this.externalViseme.v];
      vw = this.externalViseme.w;
    } else if (this.lipSeq) {
      const t = this.time - this.lipStart;
      const last = this.lipSeq[this.lipSeq.length - 1];
      if (t > last.t1) this.lipSeq = null;
      else {
        const seg = this.lipSeq.find((s) => t >= s.t0 && t < s.t1) ?? last;
        vis = VISEMES[seg.v];
        vw = this.speakIntensity + 0.25;
      }
    } else if (this.speaking) {
      const syl = (Math.sin(T * 17) * 0.5 + 0.5) * 0.65 + (Math.sin(T * 29) * 0.5 + 0.5) * 0.35;
      vis = { open: syl, width: 1 - syl * 0.1, round: Math.max(0, Math.sin(T * 5)) * 0.4 };
      vw = this.speakIntensity;
    }
    const ms = this.mouthShape;
    const tf = this.targetFace;
    ms.open = damp(ms.open, Math.max(tf.mouthOpen, clamp(vis.open * vw, 0, 1)), 22, dt);
    ms.width = damp(ms.width, vw > 0 ? vis.width : 1, 18, dt);
    ms.round = damp(ms.round, vw > 0 ? vis.round : tf.emotion === 'surprised' ? 0.8 : 0, 18, dt);

    cf.smile = damp(cf.smile, tf.smile, 10, dt);
    cf.eyebrowTilt = damp(cf.eyebrowTilt, tf.eyebrowTilt, 10, dt);
    cf.eyebrowRaise = damp(cf.eyebrowRaise, tf.eyebrowRaise, 10, dt);
    cf.browAsym = damp(cf.browAsym, tf.browAsym, 10, dt);
    cf.leftEyeOpen = damp(cf.leftEyeOpen, tf.leftEyeOpen, 14, dt);
    cf.rightEyeOpen = damp(cf.rightEyeOpen, tf.rightEyeOpen, 14, dt);
    cf.blush = damp(cf.blush, tf.blush, 6, dt);
    cf.happyEyes = damp(cf.happyEyes, tf.happyEyes, 10, dt);
    cf.squint = damp(cf.squint, tf.squint, 10, dt);

    const hair = new THREE.Color(this.appearance.hairColor);
    const state: FaceDrawState = {
      leftOpen: cf.leftEyeOpen * blink,
      rightOpen: cf.rightEyeOpen * blink,
      lookX: cf.lookAt.x,
      lookY: cf.lookAt.y,
      smile: cf.smile * (1 - ms.round * 0.6),
      mouthOpen: ms.open,
      mouthWidth: ms.width,
      mouthRound: ms.round,
      browRaise: cf.eyebrowRaise,
      browTilt: cf.eyebrowTilt,
      browAsym: cf.browAsym,
      blush: cf.blush,
      happyEyes: cf.happyEyes,
      squint: cf.squint,
      irisColor: this.appearance.eyeColor,
      browColor: '#' + hair.multiplyScalar(0.5).getHexString(),
      ...this.faceStyle,
    };
    this.face.draw(state);

    // headphone glow pulse
    const glow = this.speaking ? 0.75 + 0.25 * Math.sin(T * 12) : 0.55 + 0.1 * Math.sin(T * 1.5);
    this.headphoneGlowMat.color.setRGB(1 * glow + 0.2, 0.85 * glow + 0.12, 0.47 * glow);

    // --- cloth & hair physics ---
    const legs = this.legCapsules();
    this.skirts.forEach((sk, i) => {
      if (sk.mesh.visible) sk.update(T * (1 + i * 0.15), Math.sin(T * 0.6) * 0.01, Math.sin(T * 0.45) * 0.008, legs);
    });
    this.root.updateMatrixWorld(true);
    this.refreshCollisionMatrices();
    const colliders: Collider[] = [(p) => this.hairCollide(p, 0.97)];
    this.hair.update(dt, T, colliders, 0.6, 1, this.hairExt);
    if (this.sash.mesh.visible) this.sash.update(dt, T, [(p) => this.skirtCollide(p)], 0.7, 1.4, this.hairExt);
    else this.sash.reset();
  }
}
