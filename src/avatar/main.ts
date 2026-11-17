import * as THREE from 'three';
import {
  RiggedAvatar,
  PoseName,
  EmotionName,
  JointName,
  JointEuler,
  AppearanceConfig,
  FacialState,
  HandGesture,
  Viseme,
  LocoAnim,
} from './rigged-avatar';

/**
 * Renderer entry point. Three run modes (query string `?mode=`):
 *  - companion : desktop (Electron) transparent always-on-top window; the main
 *                process moves the window and runs the locomotion engine.
 *  - web       : inside the browser-extension overlay iframe; the content script
 *                runs the locomotion engine over the page's DOM.
 *  - viewer    : plain page (http://<host>:3000) — drag to rotate, no locomotion.
 */

type Mode = 'companion' | 'web' | 'viewer';

export interface CompanionState {
  state: LocoAnim;
  facing: number;
  speedBH: number;
  vx: number; // px/s
  vy: number; // px/s
  lookX: number;
  lookY: number;
  x: number;
  y: number;
  mode: string;
  enabled: boolean;
  hover: boolean;
  surfaceKind: string | null;
  [k: string]: any;
}

export interface Metrics {
  footX: number;
  footY: number;
  bodyW: number;
  bodyH: number;
  width: number;
  height: number;
}

interface Host {
  kind: 'desktop' | 'web' | 'none';
  grab(x?: number, y?: number): void;
  pointer?(x: number, y: number): void;
  report?(payload: any): void;
  release(): void;
  menu(): void;
  command(cmd: any): void;
  metrics(m: Metrics): void;
  onState(cb: (s: CompanionState) => void): void;
  onHostMessage?(cb: (m: any) => void): void;
}

function makeHost(mode: Mode): Host {
  const api = (window as any).api;
  if (mode === 'companion' && api?.companion) {
    return {
      kind: 'desktop',
      grab: () => api.companion.grab(),
      release: () => api.companion.release(),
      menu: () => api.companion.menu(),
      command: (c) => api.companion.command(c),
      metrics: (m) => api.companion.metrics(m),
      onState: (cb) => api.companion.onState(cb),
      onHostMessage: (cb) => api.companion.onHostMessage?.(cb),
    };
  }
  if (mode === 'web' && window.parent !== window) {
    const post = (type: string, data?: any) => window.parent.postMessage({ __plai: true, type, data }, '*');
    const stateCbs: ((s: CompanionState) => void)[] = [];
    const msgCbs: ((m: any) => void)[] = [];
    window.addEventListener('message', (e) => {
      if (e.source !== window.parent || !e.data || !e.data.__plai) return;
      if (e.data.type === 'state') stateCbs.forEach((cb) => cb(e.data.data));
      else msgCbs.forEach((cb) => cb(e.data));
    });
    return {
      kind: 'web',
      grab: (x?: number, y?: number) => post('grab', { x, y }),
      pointer: (x: number, y: number) => post('pointer', { x, y }),
      report: (payload: any) => post('report', payload),
      release: () => post('release'),
      menu: () => post('menu'),
      command: (c) => post('command', c),
      metrics: (m) => post('metrics', m),
      onState: (cb) => stateCbs.push(cb),
      onHostMessage: (cb) => msgCbs.push(cb),
    };
  }
  const noop = () => {};
  return { kind: 'none', grab: noop, release: noop, menu: noop, command: noop, metrics: noop, onState: noop };
}

interface AvatarState {
  position: { x: number; y: number };
  /** configured default pose ('auto' = rotate randomly) */
  pose: PoseName | 'auto';
  emotion: EmotionName;
  appearance: AppearanceConfig;
}

class AvatarRenderer {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private avatar!: RiggedAvatar;
  private clock = new THREE.Clock();
  private animTime = 0;
  private state: AvatarState;
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private speechTimer: number | null = null;
  private typeTimer: number | null = null;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private avatarBox: THREE.Box3 | null = null;

  readonly mode: Mode;
  private host: Host;
  private wsUrl: string;
  private clientId = Math.random().toString(36).slice(2, 10);
  private seenIds: string[] = [];
  private lastCompanion: CompanionState | null = null;
  private pxPerMeter = 150;
  private prevVel = { x: 0, y: 0, t: 0 };
  private acc = { x: 0, y: 0 };
  private baseEmotion: EmotionName = 'neutral';
  private tempEmotionUntil = 0;
  private lastMcpEmotionAt = -100;
  private lastHover = false;
  private waveCooldown = 0;
  private idleTime = 0;
  private pageInfo: any = null;
  private behavior = { animSpeed: 1, floatingAnim: true, idleRotation: true };
  private voice = { engine: 'system', rate: 1, volume: 100, enabled: true, inputEnabled: false };
  private recognition: any = null;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    const api = (window as any).api;
    this.mode = (params.get('mode') as Mode) || (api?.companion ? 'companion' : 'viewer');
    document.body.classList.add(`mode-${this.mode}`);
    this.host = makeHost(this.mode);

    // Served over http(s) (viewer at http://<VM>:3000, or behind a reverse proxy such as Home Assistant's):
    // talk to the same origin at /ws → works with HTTPS (wss) and needs only one port.
    const served = window.location.protocol.startsWith('http') && !!window.location.host;
    const sameOrigin = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
    let ws = params.get('ws') || (window as any).AVATAR_WS_URL || (served ? sameOrigin : 'ws://localhost:8080');
    const token = params.get('token');
    if (token && ws !== 'none') ws += (ws.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    this.wsUrl = ws;

    // Embedding in dashboards (Home Assistant webpage/iframe card): ?embed=1 hides the HUD;
    // ?bg=<css colour> sets a background (default transparent); ?voice=1/0 turns speech audio on/off
    // (off by default when embedded, so only one device talks).
    const embed = params.get('embed') === '1' || params.get('embed') === 'true';
    if (embed) document.body.classList.add('embed');
    const bg = params.get('bg');
    if (bg) document.documentElement.style.setProperty('background', bg, 'important');
    const voiceParam = params.get('voice');
    if (voiceParam !== null) this.voice.enabled = !['0', 'false', 'off'].includes(voiceParam);
    else if (embed) this.voice.enabled = false;

    this.state = {
      position: { x: 100, y: 100 },
      pose: 'idle',
      emotion: 'neutral',
      appearance: {
        hairColor: '#C9A15A',
        eyeColor: '#7A4A1C',
        skinTone: '#F7DCC0',
        outfit: 'noir-gold',
        headphoneColor: '#E6C26E',
      },
    };

    this.initScene();
    this.setupWebSocket();
    this.setupIPC();
    this.setupHost();
    this.setupEventListeners();
    window.setInterval(() => this.sendReport(), 2000);
    this.animate();
  }

  private get isCompanion() {
    return this.mode === 'companion' || this.mode === 'web';
  }

  // ===================================================================== scene
  private initScene() {
    const container = document.getElementById('canvas-container');
    const width = container?.clientWidth || window.innerWidth || 320;
    const height = container?.clientHeight || window.innerHeight || 440;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.camera = new THREE.PerspectiveCamera(this.isCompanion ? 30 : 36, width / height, 0.1, 100);

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (container) {
      container.innerHTML = '';
      container.appendChild(this.renderer.domElement);
    }

    this.scene.add(new THREE.HemisphereLight('#FFF4E0', '#2A2230', 0.55));
    this.scene.add(new THREE.AmbientLight('#FFF6E5', 0.35));
    const keyLight = new THREE.DirectionalLight('#FFF1D2', 1.35);
    keyLight.position.set(1.6, 3.0, 3.2);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight('#D8E2FF', 0.35);
    fillLight.position.set(-2.5, 1.2, 2.0);
    this.scene.add(fillLight);
    const rimL = new THREE.DirectionalLight('#F5C451', 1.3);
    rimL.position.set(-2.0, 2.4, -2.2);
    this.scene.add(rimL);
    const rimR = new THREE.DirectionalLight('#FFD98A', 0.9);
    rimR.position.set(2.2, 1.6, -2.0);
    this.scene.add(rimR);

    this.avatar = new RiggedAvatar(this.state.appearance);
    this.avatar.root.rotation.y = 0.12;
    this.scene.add(this.avatar.root);
    this.avatarBox = new THREE.Box3().setFromObject(this.avatar.root);
    if (this.isCompanion) this.avatar.enableLocomotion(true);
    this.fitCameraToAvatar(width, height);
  }

  private fitCameraToAvatar(width: number, height: number) {
    const aspect = Math.max(width / Math.max(height, 1), 0.35);
    const box = this.avatarBox;
    const avatarHeight = box ? box.max.y - box.min.y : 1.8;
    const avatarWidth = box ? Math.max(box.max.x - box.min.x, 0.7) : 0.8;
    const bottom = box ? box.min.y : 0;
    const headroom = (this.isCompanion ? 0.2 : 0.16) * avatarHeight;
    const footroom = (this.isCompanion ? 0.015 : 0.04) * avatarHeight;
    const viewH = avatarHeight + headroom + footroom;
    const centerY = bottom - footroom + viewH / 2;

    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const distH = viewH / (2 * Math.tan(vFov / 2));
    const hFovHalf = Math.atan(Math.tan(vFov / 2) * aspect);
    const distW = (avatarWidth * 1.25) / (2 * Math.tan(hFovHalf));
    const z = Math.max(distH, distW);

    this.camera.aspect = aspect;
    this.camera.position.set(0, centerY, z);
    this.camera.lookAt(0, centerY, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    if (box) {
      const proj = (y: number) => {
        const v = new THREE.Vector3(0, y, 0).project(this.camera);
        return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height };
      };
      const foot = proj(box.min.y + 0.02);
      const top = proj(box.max.y);
      const bodyH = foot.y - top.y;
      if (!Number.isFinite(bodyH) || bodyH < 20) return; // window not laid out yet / invalid box
      this.pxPerMeter = bodyH / Math.max(avatarHeight - 0.02, 0.1);
      this.host.metrics({
        footX: foot.x,
        footY: foot.y,
        bodyW: this.pxPerMeter * 0.42,
        bodyH,
        width,
        height,
      });
    }
  }

  // ================================================================ messaging
  private setupWebSocket() {
    if (!this.wsUrl || this.wsUrl === 'none') return;
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        this.updateStatusBadge('Hermes Connected', true);
        (window as any).api?.wsState?.({ connected: true, url: this.wsUrl.replace(/token=[^&]+/, 'token=…') });
        this.sendReport();
      };
      this.ws.onmessage = (event) => {
        try {
          this.handleMCPMessage(JSON.parse(event.data));
        } catch (err) {
          console.warn('Invalid WS message:', err);
        }
      };
      this.ws.onclose = (ev: CloseEvent) => {
        this.updateStatusBadge(ev.code === 4401 ? 'Token inválido' : 'Standby', false);
        (window as any).api?.wsState?.({
          connected: false,
          url: this.wsUrl.replace(/token=[^&]+/, 'token=…'),
          error: ev.code === 4401 ? 'token inválido' : 'sem ligação',
        });
        this.scheduleReconnect();
      };
      this.ws.onerror = () => this.ws?.close();
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.setupWebSocket();
    }, 3000);
  }

  private setupIPC() {
    const api = (window as any).api;
    if (api && typeof api.onMCPMessage === 'function') {
      api.onMCPMessage((message: { action: string; data: any }) => this.handleMCPMessage(message));
    }
  }

  private sendReport() {
    const viaHost = this.host.kind === 'web' && this.host.report;
    if (!viaHost && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) return;
    const c = this.lastCompanion;
    const payload = JSON.stringify({
        type: 'report',
        clientId: this.clientId,
        client: this.mode,
        data: {
          pose: this.avatar.getPose(),
          defaultPose: this.state.pose,
          emotion: this.state.emotion,
          companion: c
            ? {
                state: c.state,
                mode: c.mode,
                enabled: c.enabled,
                x: Math.round(c.x),
                y: Math.round(c.y),
                surfaceKind: c.surfaceKind,
                screen: c.screen,
                surfaces: c.surfaces,
                screenCapture: c.screenCapture,
                cursor: c.cursor,
              }
            : null,
          page: this.pageInfo,
        },
      });
    if (viaHost) this.host.report!(JSON.parse(payload));
    else this.ws!.send(payload);
  }

  public handleMCPMessage(message: { action: string; data: any; id?: string }) {
    if (!message || !message.action) return;
    if (message.id) {
      if (this.seenIds.includes(message.id)) return; // same command via IPC + WebSocket
      this.seenIds.push(message.id);
      if (this.seenIds.length > 300) this.seenIds.shift();
    }
    const data = message.data || {};

    switch (message.action) {
      case 'move':
        if (this.isCompanion) this.host.command({ cmd: 'walk_to', x: data.x, y: data.y });
        else this.moveWindow(data.x, data.y);
        break;

      case 'pose':
        if (data.pose) this.applyPoseRequest(data.pose, data, !!message.id);
        break;

      case 'emotion':
      case 'face':
        if (data.emotion) this.noteMcpEmotion(data.emotion);
        this.avatar.setFacialState(data as Partial<FacialState>);
        break;

      case 'joints':
        this.avatar.setJointAngles(data.angles as Partial<Record<JointName, JointEuler>>);
        break;

      case 'express':
        if (data.emotion) {
          this.noteMcpEmotion(data.emotion);
          this.avatar.setEmotion(data.emotion as EmotionName, data.intensity ?? 1);
        }
        if (data.pose) this.applyPoseRequest(data.pose, data, true);
        if (data.gazeTarget) this.avatar.setFacialState({ lookAt: data.gazeTarget });
        if (data.speechText) this.showSpeech(data.speechText, data.durationMs);
        break;

      case 'speak_start':
        this.showSpeech(data.text || '', data.durationMs, data.forceVoice === true);
        break;

      case 'speak_end':
        this.hideSpeech();
        break;

      case 'viseme':
        if (data.viseme) this.avatar.setViseme(data.viseme as Viseme, data.weight ?? 1, data.holdMs ?? 150);
        break;

      case 'lip_sync':
      case 'lipsync':
      case 'audio_level':
        if (Array.isArray(data.sequence)) this.playVisemeSequence(data.sequence);
        else if (data.text) this.avatar.speakText(data.text, data.durationMs);
        else this.avatar.setMouthLevel(Number(data.level ?? data.value ?? 0));
        break;

      case 'hand':
      case 'gesture':
        if (data.gesture) this.avatar.setHandGesture(data.side || 'both', data.gesture as HandGesture);
        break;

      case 'look_at':
      case 'gaze':
        if (data.screenX !== undefined && this.isCompanion) this.host.command({ cmd: 'look_at', ...data });
        else this.avatar.setFacialState({ lookAt: { x: Number(data.x ?? 0), y: Number(data.y ?? 0) } });
        break;

      case 'companion':
        this.host.command(data);
        break;

      case 'customize':
        this.state.appearance = { ...this.state.appearance, ...data };
        this.avatar.updateAppearance(this.state.appearance);
        if (data.pose) this.applyPoseRequest(data.pose, { default: true }, false);
        if (this.avatar.bodyChanged) this.refit();
        break;

      case 'behavior':
        this.applyBehavior(data);
        break;

      case 'voice':
        this.voice = { ...this.voice, ...data };
        break;

      case 'listen':
        this.listen(Number(data.duration ?? 6));
        break;

      case 'stop_speaking':
        this.hideSpeech();
        break;

      case 'point':
        if (this.isCompanion) this.host.command({ cmd: 'point', x: data.targetX, y: data.targetY });
        else this.pointAt(data.targetX, data.targetY);
        break;

      case 'load_model':
        if (data.url) this.avatar.loadCustomModel(data.url).catch((err) => console.error('GLB load failed:', err));
        break;

      case 'request_report':
        this.sendReport();
        break;
    }
  }

  /**
   * Pose requests.
   *  - from the configuration window (no message id, or `default: true`): becomes the default pose
   *    ('auto' rotates poses randomly);
   *  - from Hermes (MCP): shown temporarily (`holdSeconds`, default 12 s, longer while talking),
   *    then the configured default behaviour resumes. `holdSeconds: 0` / `default: true` keeps it.
   */
  private applyPoseRequest(pose: string, data: any, fromMcp: boolean) {
    const asDefault = !fromMcp || data?.default === true || pose === 'auto' || data?.holdSeconds === 0;
    if (asDefault) {
      this.state.pose = pose as PoseName | 'auto';
      this.avatar.setPose(pose as PoseName | 'auto');
      return;
    }
    const talk = data?.speechText ? Math.min(12, String(data.speechText).length * 0.07) : 0;
    const hold = Number.isFinite(Number(data?.holdSeconds)) ? Number(data.holdSeconds) : Math.max(12, talk + 3);
    this.avatar.holdPose(pose as PoseName, hold);
  }

  private noteMcpEmotion(e: EmotionName) {
    this.baseEmotion = e;
    this.state.emotion = e;
    this.lastMcpEmotionAt = this.clock.elapsedTime;
    this.tempEmotionUntil = 0;
  }

  private playVisemeSequence(seq: { viseme: Viseme; t: number; weight?: number }[]) {
    const start = performance.now();
    seq.forEach((s, i) => {
      const next = seq[i + 1];
      const hold = next ? Math.max(40, (next.t - s.t) * 1000) : 160;
      window.setTimeout(() => this.avatar.setViseme(s.viseme, s.weight ?? 1, hold + 30), Math.max(0, s.t * 1000 - (performance.now() - start)));
    });
  }

  // ============================================================= companion host
  private setupHost() {
    this.host.onState((s) => this.onCompanionState(s));
    this.host.onHostMessage?.((m) => {
      if (m.type === 'page') this.pageInfo = m.data;
      if (m.type === 'mcp') this.handleMCPMessage(m.data);
      if (m.type === 'say') this.showSpeech(m.data?.text || '', m.data?.durationMs);
      if (m.type === 'emotion') this.setTempEmotion(m.data?.emotion, m.data?.seconds ?? 2.5);
      if (m.type === 'pose') this.avatar.holdPose(m.data?.pose, m.data?.seconds ?? 4);
      if (m.type === 'point') this.avatar.pointAtNormalized(Number(m.data?.nx ?? 0), Number(m.data?.ny ?? 0));
    });
  }

  private setTempEmotion(e: EmotionName, seconds: number) {
    // do not override an emotion Hermes set in the last few seconds
    if (this.clock.elapsedTime - this.lastMcpEmotionAt < 6) return;
    this.avatar.setEmotion(e);
    this.tempEmotionUntil = this.clock.elapsedTime + seconds;
  }

  private onCompanionState(s: CompanionState) {
    const prev = this.lastCompanion;
    this.lastCompanion = s;
    const bodyH = s.bodyH || this.pxPerMeter * 1.75;
    this.avatar.roamingIdle = !!s.idleRoaming;
    this.avatar.setLocomotion(s.state, s.facing, s.speedBH, s.vy / bodyH, s.lookX);
    this.avatar.setFacialState({ lookAt: { x: s.lookX, y: s.lookY } });

    // inertial force on hair & ribbons from window movement
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 120, now - this.prevVel.t);
    if (this.prevVel.t > 0 && dt < 0.3) {
      const ppm = Math.max(this.pxPerMeter, 20);
      const ax = Number.isFinite(s.vx - this.prevVel.x) ? (s.vx - this.prevVel.x) / dt / ppm : 0;
      const ay = Number.isFinite(s.vy - this.prevVel.y) ? -(s.vy - this.prevVel.y) / dt / ppm : 0;
      this.acc.x += (ax - this.acc.x) * 0.35;
      this.acc.y += (ay - this.acc.y) * 0.35;
      this.avatar.setExternalAcceleration(this.acc.x, this.acc.y);
    }
    this.prevVel = { x: s.vx, y: s.vy, t: now };

    // reactive emotions
    if (!prev || prev.state !== s.state) {
      if (s.state === 'grabbed') this.setTempEmotion('surprised', 3);
      else if (s.state === 'land' && prev && (prev.state === 'fall' || prev.state === 'grabbed')) this.setTempEmotion('happy', 2);
      else if (s.state === 'jump') this.setTempEmotion('excited', 1.2);
    }
    if (s.hover && !this.lastHover && s.state === 'idle' && this.waveCooldown <= 0) {
      this.setTempEmotion('happy', 2.5);
      this.avatar.holdPose('waving', 1.8);
      this.waveCooldown = 25;
    }
    this.lastHover = s.hover;
  }

  private companionTick(dt: number) {
    const t = this.clock.elapsedTime;
    this.waveCooldown -= dt;
    if (this.tempEmotionUntil > 0 && t > this.tempEmotionUntil) {
      this.tempEmotionUntil = 0;
      this.avatar.setEmotion(this.baseEmotion);
    }
    const s = this.lastCompanion;
    const speaking = this.speechTimer !== null;

    // idle pose variations are handled by the avatar itself (Behaviour → idle rotation)
    void s;
    void speaking;
  }

  /** Proportions changed: recompute the bounding box, camera and (companion) metrics. */
  private refit() {
    this.avatar.bodyChanged = false;
    const r = this.avatar.root.rotation.y;
    this.avatar.root.rotation.y = 0.12;
    this.avatar.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.avatar.root);
    const ok = [box.min.x, box.min.y, box.max.x, box.max.y].every(Number.isFinite) && box.max.y - box.min.y > 0.5;
    if (ok) this.avatarBox = box; // never replace a good box with an invalid one
    this.avatar.root.rotation.y = r;
    const c = document.getElementById('canvas-container');
    this.fitCameraToAvatar(c?.clientWidth || window.innerWidth, c?.clientHeight || window.innerHeight);
  }

  private applyBehavior(b: any) {
    if (!b) return;
    if (b.animSpeed !== undefined) this.behavior.animSpeed = Math.max(0.1, Math.min(3, Number(b.animSpeed) || 1));
    if (b.floatingAnim !== undefined) this.behavior.floatingAnim = !!b.floatingAnim;
    if (b.idleRotation !== undefined) {
      // "Enable idle rotation": while idle she alternates poses and returns to the default pose
      this.behavior.idleRotation = !!b.idleRotation;
      this.avatar.behavior.idleCycle = this.behavior.idleRotation;
    }
  }

  // ================================================================== voice
  private pickVoice(text: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (!voices.length) return null;
    const eng = (this.voice.engine || 'system').toLowerCase();
    if (eng !== 'system') {
      const v =
        voices.find((x) => x.name.toLowerCase() === eng || x.voiceURI.toLowerCase() === eng) ||
        voices.find((x) => x.name.toLowerCase().startsWith(eng)) ||
        voices.find((x) => x.name.toLowerCase().includes(eng));
      if (v) return v;
    }
    // system: match the text language (Portuguese texts get a Portuguese voice)
    const pt = /[ãõçáéíóúâêô]|\b(o|a|os|as|de|que|não|está|olá|já)\b/i.test(text);
    const lang = pt ? 'pt' : (navigator.language || 'en').slice(0, 2);
    return (
      voices.find((x) => x.lang.toLowerCase() === (pt ? 'pt-pt' : navigator.language.toLowerCase())) ||
      voices.find((x) => x.lang.toLowerCase().startsWith(lang)) ||
      voices.find((x) => x.default) ||
      null
    );
  }

  /** Speaks aloud with the system voices; returns the expected duration (ms) or null. */
  private speakAloud(text: string, force = false): number | null {
    const synth = window.speechSynthesis;
    if (!text || !synth || (!this.voice.enabled && !force)) return null;
    if (!synth.getVoices().length) {
      // the voice list loads asynchronously: speak as soon as it is available
      const go = () => this.speakNow(text);
      synth.addEventListener('voiceschanged', go, { once: true });
      window.setTimeout(() => {
        synth.removeEventListener('voiceschanged', go);
        if (!synth.speaking) go();
      }, 800);
      return Math.max(1200, (text.length * 70) / (Number(this.voice.rate) || 1)) + 1400;
    }
    return this.speakNow(text);
  }

  private speakNow(text: string): number {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice(text);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = Math.max(0.5, Math.min(2, Number(this.voice.rate) || 1));
    u.volume = Math.max(0, Math.min(1, (Number(this.voice.volume) || 0) / 100));
    const est = Math.max(1200, (text.length * 70) / u.rate);
    // keep the mouth moving exactly while the voice is audible
    u.onstart = () => this.avatar.speakText(text, est);
    u.onboundary = () => this.avatar.setMouthLevel(0.8);
    u.onend = () => {
      this.avatar.setSpeaking(false);
      if (this.speechTimer !== null) {
        window.clearTimeout(this.speechTimer);
        this.speechTimer = window.setTimeout(() => this.hideSpeech(), 900);
      }
    };
    synth.speak(u);
    return est + 600;
  }

  /** Voice input (Web Speech recognition where available) → sent to the MCP server for `voice_input`. */
  private listen(seconds: number) {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const send = (payload: any) => {
      const msg = { type: 'voice_input', clientId: this.clientId, client: this.mode, ...payload };
      if (this.host.kind === 'web' && this.host.report) this.host.report(msg);
      else if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    };
    if (!this.voice.inputEnabled) {
      send({ error: 'voice input disabled in settings' });
      return;
    }
    if (!SR) {
      this.showSpeech('Ainda não consigo ouvir neste ambiente (reconhecimento de voz indisponível).', 4000);
      send({ error: 'speech recognition unavailable in this environment' });
      return;
    }
    try {
      this.recognition?.abort?.();
      const rec = new SR();
      this.recognition = rec;
      rec.lang = navigator.language || 'pt-PT';
      rec.interimResults = true;
      rec.continuous = false;
      let finalText = '';
      this.avatar.holdPose('listening', seconds + 1);
      this.avatar.setEmotion('curious');
      this.showSpeech('🎙️ A ouvir…', seconds * 1000, false);
      rec.onresult = (e: any) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        if (e.results[e.results.length - 1].isFinal) finalText = t;
        const span = document.getElementById('speech-text');
        if (span) span.textContent = '🎙️ ' + t;
      };
      rec.onerror = (e: any) => send({ error: String(e?.error || 'recognition error') });
      rec.onend = () => {
        this.avatar.holdPose('listening', 0.01);
        this.avatar.setEmotion(this.baseEmotion);
        if (finalText) send({ text: finalText });
        this.hideSpeech();
      };
      rec.start();
      window.setTimeout(() => rec.stop?.(), Math.max(1, seconds) * 1000);
    } catch (err) {
      send({ error: String(err) });
    }
  }

  // ================================================================== speech
  private showSpeech(text: string, durationMs?: number, forceVoice = false) {
    const spoken = this.speakAloud(text, forceVoice);
    const autoDuration = Math.max(durationMs ?? Math.max(1800, Math.min(12000, text.length * 65)), spoken ?? 0);
    if (spoken === null) {
      if (text) this.avatar.speakText(text, Math.min(autoDuration, text.length * 75));
      else this.avatar.setSpeaking(true, 0.75);
    }

    const bubble = document.getElementById('speech-bubble');
    const span = document.getElementById('speech-text');
    if (bubble && span && text) {
      bubble.classList.add('visible');
      span.textContent = '';
      if (this.typeTimer !== null) window.clearInterval(this.typeTimer);
      let i = 0;
      const chars = Array.from(text);
      const step = Math.max(12, Math.min(45, (autoDuration * 0.6) / Math.max(chars.length, 1)));
      this.typeTimer = window.setInterval(() => {
        i += 1;
        span.textContent = chars.slice(0, i).join('');
        if (i >= chars.length && this.typeTimer !== null) {
          window.clearInterval(this.typeTimer);
          this.typeTimer = null;
        }
      }, step);
    }
    if (this.speechTimer !== null) window.clearTimeout(this.speechTimer);
    this.speechTimer = window.setTimeout(() => this.hideSpeech(), autoDuration + 600);
  }

  private hideSpeech() {
    this.avatar.setSpeaking(false);
    window.speechSynthesis?.cancel?.();
    document.getElementById('speech-bubble')?.classList.remove('visible');
    if (this.typeTimer !== null) {
      window.clearInterval(this.typeTimer);
      this.typeTimer = null;
    }
    if (this.speechTimer !== null) {
      window.clearTimeout(this.speechTimer);
      this.speechTimer = null;
    }
  }

  private _headPos = new THREE.Vector3();
  private positionBubble() {
    const bubble = document.getElementById('speech-bubble');
    if (!bubble || !bubble.classList.contains('visible')) return;
    this.avatar.joints.head.getWorldPosition(this._headPos);
    this._headPos.y += 0.3;
    this._headPos.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = (this._headPos.x * 0.5 + 0.5) * rect.width;
    const y = (-this._headPos.y * 0.5 + 0.5) * rect.height;
    const w = bubble.offsetWidth;
    const h = bubble.offsetHeight;
    const left = Math.max(4, Math.min(rect.width - w - 4, x - w / 2));
    const top = Math.max(this.isCompanion ? 4 : 34, y - h - 6);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.setProperty('--tail-x', `${Math.max(14, Math.min(w - 14, x - left))}px`);
  }

  private updateStatusBadge(text: string, connected: boolean) {
    const el = document.getElementById('status-text');
    const dot = document.getElementById('status-dot');
    if (el) el.textContent = text;
    if (dot) dot.classList.toggle('connected', connected);
  }

  private moveWindow(x: number, y: number) {
    this.state.position = { x, y };
    const api = (window as any).api;
    if (api && typeof api.moveWindow === 'function') api.moveWindow(x, y);
  }

  private pointAt(targetX: number, targetY: number) {
    const nx = THREE.MathUtils.clamp((targetX - this.state.position.x) / 500, -1, 1);
    const ny = THREE.MathUtils.clamp(-(targetY - this.state.position.y) / 500, -1, 1);
    this.avatar.pointAtNormalized(nx, ny);
  }

  // ================================================================== input
  private setupEventListeners() {
    const dom = this.renderer.domElement;

    if (this.isCompanion) {
      dom.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this.isDragging = true;
        this.host.grab(e.clientX, e.clientY);
      });
      window.addEventListener('mousemove', (e) => this.host.pointer?.(e.clientX, e.clientY));
      window.addEventListener('mouseup', () => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.host.release();
      });
      dom.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.host.menu();
      });
      dom.addEventListener('dblclick', () => {
        this.avatar.holdPose('waving', 2);
        this.setTempEmotion('happy', 2);
      });
    } else {
      dom.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        this.isDragging = true;
        const isElectron = typeof (window as any).api?.moveWindow === 'function';
        this.dragOffset.x = isElectron ? e.screenX - this.state.position.x : e.clientX;
        this.dragOffset.y = isElectron ? e.screenY - this.state.position.y : e.clientY;
      });
      window.addEventListener('mousemove', (e) => {
        if (this.isDragging) {
          if (typeof (window as any).api?.moveWindow === 'function') {
            this.moveWindow(e.screenX - this.dragOffset.x, e.screenY - this.dragOffset.y);
          } else {
            const dx = e.clientX - this.dragOffset.x;
            this.dragOffset.x = e.clientX;
            this.avatar.root.rotation.y += dx * 0.01;
          }
        } else {
          const rect = dom.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
            this.avatar.setFacialState({
              lookAt: { x: THREE.MathUtils.clamp(nx, -0.8, 0.8), y: THREE.MathUtils.clamp(ny, -0.6, 0.6) },
            });
          }
        }
      });
      window.addEventListener('mouseup', () => (this.isDragging = false));
    }

    window.addEventListener('resize', () => {
      const container = document.getElementById('canvas-container');
      const w = container?.clientWidth || window.innerWidth;
      const h = container?.clientHeight || window.innerHeight;
      this.renderer.setSize(w, h);
      this.fitCameraToAvatar(w, h);
    });

    document.getElementById('btn-config')?.addEventListener('click', (e) => {
      e.stopPropagation();
      (window as any).api?.openConfig?.();
    });
    document.getElementById('btn-hide')?.addEventListener('click', (e) => {
      e.stopPropagation();
      (window as any).api?.hideAvatar?.();
    });

    document.querySelectorAll<HTMLElement>('[data-pose]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pose = btn.dataset.pose as PoseName;
        if (pose) this.avatar.setPose(pose);
      });
    });
    document.querySelectorAll<HTMLElement>('[data-emotion]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const emotion = btn.dataset.emotion as EmotionName;
        if (emotion) this.avatar.setEmotion(emotion);
      });
    });
  }

  private animate() {
    requestAnimationFrame(() => this.animate());
    const raw = Math.min(this.clock.getDelta(), 0.05);
    const dt = raw * this.behavior.animSpeed;
    this.animTime += dt;
    const elapsed = this.animTime;
    if (this.isCompanion) this.companionTick(dt);

    const idle = !this.lastCompanion || this.lastCompanion.state === 'idle';
    this.avatar.root.position.y = this.behavior.floatingAnim && idle ? (Math.sin(elapsed * 1.4) * 0.5 + 0.5) * 0.015 : 0;
    this.avatar.update(dt, elapsed);
    this.positionBubble();
    this.renderer.render(this.scene, this.camera);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const renderer = new AvatarRenderer();
  (window as any).__avatarRenderer = renderer;
});

export default AvatarRenderer;
