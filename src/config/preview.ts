import * as THREE from 'three';
import { RiggedAvatar, AppearanceConfig, PoseName } from '../avatar/rigged-avatar';

type Focus = 'body' | 'head';

/**
 * Live 3D preview in the configuration window. Uses the same avatar and lighting
 * as the desktop companion. On the "Face" tab the camera glides to a close-up of
 * the head so face shape, eyes, nose, mouth and hairstyle changes are visible.
 */
class ConfigAvatarPreview {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private avatar: RiggedAvatar;
  private clock = new THREE.Clock();
  private t = 0;
  private dragging = false;
  private lastX = 0;
  private focus: Focus = 'body';
  private zoom = 1; // wheel zoom multiplier on the camera distance
  private yaw = 0.18;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private bodyView = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private _v = new THREE.Vector3();

  constructor(private container: HTMLElement) {
    const w = container.clientWidth || 270;
    const h = container.clientHeight || 360;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, w / h, 0.05, 50);

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    // same lighting as the desktop / browser avatar
    this.scene.add(new THREE.HemisphereLight('#FFF4E0', '#2A2230', 0.55));
    this.scene.add(new THREE.AmbientLight('#FFF6E5', 0.35));
    const key = new THREE.DirectionalLight('#FFF1D2', 1.35);
    key.position.set(1.6, 3.0, 3.2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#D8E2FF', 0.35);
    fill.position.set(-2.5, 1.2, 2.0);
    this.scene.add(fill);
    const rimL = new THREE.DirectionalLight('#F5C451', 1.3);
    rimL.position.set(-2.0, 2.4, -2.2);
    this.scene.add(rimL);
    const rimR = new THREE.DirectionalLight('#FFD98A', 0.9);
    rimR.position.set(2.2, 1.6, -2.0);
    this.scene.add(rimR);

    this.avatar = new RiggedAvatar();
    this.avatar.root.rotation.y = this.yaw;
    this.scene.add(this.avatar.root);

    this.computeBodyView(w, h);
    this.camPos.copy(this.bodyView.pos);
    this.camLook.copy(this.bodyView.look);
    this.setupInteraction(this.renderer.domElement);
    this.animate();
  }

  private computeBodyView(w: number, h: number) {
    this.avatar.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.avatar.root);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const aspect = Math.max(w / Math.max(h, 1), 0.35);
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const margin = 1.15;
    const distH = (size.y * margin) / (2 * Math.tan(vFov / 2));
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const distW = (Math.max(size.x, 0.6) * margin) / (2 * Math.tan(hFov / 2));
    const dist = Math.max(distH, distW);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.bodyView.look.copy(center);
    this.bodyView.pos.set(center.x, center.y + 0.03, center.z + dist);
  }

  /** Close-up target: the head (follows idle head motion). */
  private headView() {
    const head = this.avatar.joints.head;
    head.getWorldPosition(this._v);
    const look = this._v.clone().add(new THREE.Vector3(0, 0.085, 0));
    const pos = look.clone().add(new THREE.Vector3(0, 0.01, 0.98 * this.zoom));
    return { pos, look };
  }

  setFocus(f: Focus) {
    if (f === this.focus) return;
    this.focus = f;
    this.zoom = 1;
    if (f === 'head') this.yaw = 0.06; // turn her towards the camera for the close-up
  }

  private setupInteraction(dom: HTMLElement) {
    dom.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.yaw += dx * 0.012;
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.45, 2.2);
      },
      { passive: false }
    );
    dom.addEventListener('dblclick', () => this.setFocus(this.focus === 'head' ? 'body' : 'head'));
    const onResize = () => {
      const w = this.container.clientWidth || 270;
      const h = this.container.clientHeight || 360;
      this.renderer.setSize(w, h);
      this.computeBodyView(w, h);
    };
    window.addEventListener('resize', onResize);
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(this.container);
  }

  private speed = 1;
  private floating = true;

  update(appearance: Partial<AppearanceConfig> & { pose?: string }) {
    this.avatar.updateAppearance(appearance);
    if (appearance.pose && appearance.pose !== this.avatar.getDefaultPose()) this.avatar.setPose(appearance.pose as PoseName | 'auto');
    if (this.avatar.bodyChanged) {
      // proportions changed → re-frame the whole body
      this.avatar.bodyChanged = false;
      this.computeBodyView(this.container.clientWidth || 270, this.container.clientHeight || 360);
    }
  }

  setBehavior(b: { animSpeed?: number; floatingAnim?: boolean; idleRotation?: boolean }) {
    if (!b) return;
    if (b.animSpeed !== undefined) this.speed = Math.max(0.1, Math.min(3, Number(b.animSpeed) || 1));
    if (b.floatingAnim !== undefined) this.floating = !!b.floatingAnim;
    if (b.idleRotation !== undefined) this.avatar.behavior.idleCycle = !!b.idleRotation;
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.05) * this.speed;
    this.t += dt;
    this.avatar.root.rotation.y += (this.yaw - this.avatar.root.rotation.y) * (1 - Math.exp(-10 * dt));
    this.avatar.root.position.y = this.floating ? (Math.sin(this.t * 1.4) * 0.5 + 0.5) * 0.015 : 0;
    this.avatar.update(dt, this.t);

    let target: { pos: THREE.Vector3; look: THREE.Vector3 };
    if (this.focus === 'head') target = this.headView();
    else {
      const d = this.bodyView.pos.clone().sub(this.bodyView.look).multiplyScalar(this.zoom);
      target = { pos: this.bodyView.look.clone().add(d), look: this.bodyView.look };
    }
    const k = 1 - Math.exp(-6 * dt);
    this.camPos.lerp(target.pos, k);
    this.camLook.lerp(target.look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('avatar-preview-canvas');
  if (!container) return;
  const preview = new ConfigAvatarPreview(container);
  (window as any).__updatePreview = (appearance: Partial<AppearanceConfig> & { pose?: string }) => preview.update(appearance);
  (window as any).__previewFocus = (f: Focus) => preview.setFocus(f);
  (window as any).__previewBehavior = (b: any) => preview.setBehavior(b);
  // apply anything the settings script queued before the preview existed
  const pending = (window as any).__pendingPreview;
  if (pending) preview.update(pending);
});
