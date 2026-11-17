import * as THREE from 'three';

/**
 * Strand system: hair locks / ribbons simulated as Verlet chains in world space,
 * pulled toward their rest shape (so the hairstyle keeps its form) while gravity,
 * inertia and wind add natural secondary motion. All strands of one system share
 * a single BufferGeometry (one draw call).
 */
export interface StrandDef {
  rest: THREE.Vector3[]; // points in anchor-local space (root first)
  width0: number;
  width1: number;
  thick0: number;
  thick1: number;
  stiff0: number; // pull-to-rest at root (0..1 per substep)
  stiff1: number; // pull-to-rest at tip
  shade?: number; // colour multiplier
  phase?: number;
}

export type Collider = (pWorld: THREE.Vector3) => void;

interface StrandState {
  def: StrandDef;
  n: number;
  world: THREE.Vector3[];
  prev: THREE.Vector3[];
  segLen: number[];
  vStart: number;
}

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _o = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _l = new THREE.Vector3();

export class StrandSystem {
  readonly mesh: THREE.Mesh;
  private strands: StrandState[] = [];
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private nrm: Float32Array;
  private initialized = false;
  private inv = new THREE.Matrix4();
  private acc = 0;
  private local: THREE.Vector3[] = [];

  constructor(
    private anchor: THREE.Object3D,
    material: THREE.Material,
    defs: StrandDef[],
    private radial = 7,
    private axis = new THREE.Vector3(),
    colorFn: (t: number, def: StrandDef) => number = () => 1
  ) {
    let verts = 0;
    defs.forEach((def) => {
      this.strands.push({
        def,
        n: def.rest.length,
        world: def.rest.map(() => new THREE.Vector3()),
        prev: def.rest.map(() => new THREE.Vector3()),
        segLen: def.rest.map(() => 0),
        vStart: verts,
      });
      verts += def.rest.length * radial;
    });

    this.pos = new Float32Array(verts * 3);
    this.nrm = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const index: number[] = [];

    this.strands.forEach((st) => {
      for (let i = 0; i < st.n; i++) {
        const t = i / (st.n - 1);
        const c = colorFn(t, st.def) * (st.def.shade ?? 1);
        for (let k = 0; k < radial; k++) {
          const vi = st.vStart + i * radial + k;
          col[vi * 3] = c;
          col[vi * 3 + 1] = c;
          col[vi * 3 + 2] = c;
        }
      }
      for (let i = 0; i < st.n - 1; i++) {
        for (let k = 0; k < radial; k++) {
          const a = st.vStart + i * radial + k;
          const b = st.vStart + i * radial + ((k + 1) % radial);
          const cIdx = a + radial;
          const d = b + radial;
          index.push(a, cIdx, b, b, cIdx, d);
        }
      }
    });

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setIndex(index);

    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    anchor.add(this.mesh);

    // Initial geometry from rest shape
    this.strands.forEach((st) => this.writeStrand(st, st.def.rest));
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }

  reset() {
    this.initialized = false;
  }

  update(dt: number, time: number, colliders: Collider[], gravity = 0.6, wind = 1, ext?: THREE.Vector3) {
    this.anchor.updateWorldMatrix(true, false);
    const M = this.anchor.matrixWorld;

    if (!this.initialized) {
      this.strands.forEach((st) => {
        for (let i = 0; i < st.n; i++) {
          st.world[i].copy(st.def.rest[i]).applyMatrix4(M);
          st.prev[i].copy(st.world[i]);
          st.segLen[i] = i ? st.world[i].distanceTo(st.world[i - 1]) : 0;
        }
      });
      this.initialized = true;
    }

    const h = 1 / 60;
    this.acc = Math.min(this.acc + dt, h * 4);
    while (this.acc >= h) {
      this.acc -= h;
      this.substep(h, time, M, colliders, gravity, wind, ext);
    }

    this.inv.copy(M).invert();
    this.strands.forEach((st) => {
      if (this.local.length < st.n) {
        while (this.local.length < st.n) this.local.push(new THREE.Vector3());
      }
      for (let i = 0; i < st.n; i++) this.local[i].copy(st.world[i]).applyMatrix4(this.inv);
      this.writeStrand(st, this.local);
    });
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }

  private substep(
    h: number,
    time: number,
    M: THREE.Matrix4,
    colliders: Collider[],
    gravity: number,
    wind: number,
    ext?: THREE.Vector3
  ) {
    const g = 9.8 * gravity * h * h;
    const ex = ext ? ext.x * h * h : 0;
    const ey = ext ? ext.y * h * h : 0;
    const ez = ext ? ext.z * h * h : 0;
    this.strands.forEach((st, si) => {
      const ph = st.def.phase ?? si * 0.73;
      const wx = (Math.sin(time * 0.9 + ph) * 0.6 + Math.sin(time * 2.3 + ph * 1.7) * 0.25) * wind * h * h * 3;
      const wz = (Math.sin(time * 0.7 + ph * 1.3) * 0.4 + 0.15) * wind * h * h * 3;
      for (let i = 0; i < st.n; i++) {
        _v.copy(st.def.rest[i]).applyMatrix4(M); // target
        if (i === 0) {
          st.world[0].copy(_v);
          st.prev[0].copy(_v);
          continue;
        }
        const t = i / (st.n - 1);
        const k = st.def.stiff0 + (st.def.stiff1 - st.def.stiff0) * Math.pow(t, 0.7);
        const p = st.world[i];
        _t.copy(p).sub(st.prev[i]).multiplyScalar(0.9);
        st.prev[i].copy(p);
        p.add(_t);
        p.y -= g - ey;
        p.x += wx * t + ex;
        p.z += wz * t + ez;
        p.lerp(_v, k);
      }
      for (let it = 0; it < 2; it++) {
        for (let i = 1; i < st.n; i++) {
          _t.copy(st.world[i]).sub(st.world[i - 1]);
          const len = _t.length() || 1e-6;
          st.world[i].copy(st.world[i - 1]).addScaledVector(_t, st.segLen[i] / len);
        }
        for (let i = 1; i < st.n; i++) colliders.forEach((c) => c(st.world[i]));
      }
    });
  }

  private writeStrand(st: StrandState, pts: THREE.Vector3[]) {
    const d = st.def;
    const R = this.radial;
    for (let i = 0; i < st.n; i++) {
      const t = i / (st.n - 1);
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(st.n - 1, i + 1)];
      _t.copy(b).sub(a).normalize();
      const p = pts[i];
      _o.set(p.x - this.axis.x, 0, p.z - this.axis.z);
      if (_o.lengthSq() < 1e-8) _o.set(0, 0, 1);
      _o.normalize();
      _s.crossVectors(_t, _o);
      if (_s.lengthSq() < 1e-8) _s.set(1, 0, 0);
      _s.normalize();
      _n.crossVectors(_s, _t).normalize();
      const w = (d.width0 + (d.width1 - d.width0) * Math.pow(t, 0.85)) * 0.5;
      const th = (d.thick0 + (d.thick1 - d.thick0) * t) * 0.5;
      for (let k = 0; k < R; k++) {
        const ang = (k / R) * Math.PI * 2;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        const vi = (st.vStart + i * R + k) * 3;
        _l.copy(p).addScaledVector(_s, cs * w).addScaledVector(_n, sn * th);
        this.pos[vi] = _l.x;
        this.pos[vi + 1] = _l.y;
        this.pos[vi + 2] = _l.z;
        _l.set(0, 0, 0)
          .addScaledVector(_s, cs / Math.max(w, 1e-4))
          .addScaledVector(_n, sn / Math.max(th, 1e-4))
          .normalize();
        this.nrm[vi] = _l.x;
        this.nrm[vi + 1] = _l.y;
        this.nrm[vi + 2] = _l.z;
      }
    }
  }
}
