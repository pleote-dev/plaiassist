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
  pose: PoseName;
  emotion: EmotionName;
  appearance: AppearanceConfig;
}

class AvatarRenderer {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private avatar!: RiggedAvatar;
  private clock = new THREE.Clock();
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
  private idleActionUntil = 0;
  private pageInfo: any = null;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    const api = (window as any).api;
    this.mode = (params.get('mode') as Mode) || (api?.companion ? 'companion' : 'viewer');
    document.body.classList.add(`mode-${this.mode}`);
    this.host = makeHost(this.mode);

    const hostName =
      window.location.protocol.startsWith('http') && window.location.hostname ? window.location.hostname : 'localhost';
    this.wsUrl = params.get('ws') || (window as any).AVATAR_WS_URL || `ws://${hostName}:8080`;

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
        this.sendReport();
      };
      this.ws.onmessage = (event) => {
        try {
          this.handleMCPMessage(JSON.parse(event.data));
        } catch (err) {
          console.warn('Invalid WS message:', err);
        }
      };
      this.ws.onclose = () => {
        this.updateStatusBadge('Standby', false);
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
          pose: this.state.pose,
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
        if (data.pose) {
          this.state.pose = data.pose;
          this.avatar.setPose(data.pose as PoseName);
        }
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
        if (data.pose) {
          this.state.pose = data.pose;
          this.avatar.setPose(data.pose as PoseName);
        }
        if (data.gazeTarget) this.avatar.setFacialState({ lookAt: data.gazeTarget });
        if (data.speechText) this.showSpeech(data.speechText, data.durationMs);
        break;

      case 'speak_start':
        this.showSpeech(data.text || '', data.durationMs);
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
      if (m.type === 'pose') this.avatar.setPose(m.data?.pose);
      if (m.type === 'point') {
        this.avatar.pointAtNormalized(Number(m.data?.nx ?? 0), Number(m.data?.ny ?? 0));
        this.idleActionUntil = this.clock.elapsedTime + 3.5;
      }
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
    this.avatar.setLocomotion(s.state, s.facing, s.speedBH, s.vy / bodyH, s.lookX);
    this.avatar.setFacialState({ lookAt: { x: s.lookX, y: s.lookY } });

    // inertial force on hair & ribbons from window movement
    const now = performance.now() / 1000;
    const dt = Math.max(1 / 120, now - this.prevVel.t);
    if (this.prevVel.t > 0 && dt < 0.3) {
      const ax = (s.vx - this.prevVel.x) / dt / this.pxPerMeter;
      const ay = -(s.vy - this.prevVel.y) / dt / this.pxPerMeter;
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
      this.avatar.setPose('waving');
      this.idleActionUntil = this.clock.elapsedTime + 1.8;
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
    if (this.idleActionUntil > 0 && t > this.idleActionUntil) {
      this.idleActionUntil = 0;
      this.avatar.setPose(this.state.pose === 'idle' ? 'idle' : this.state.pose);
    }
    if (s && s.state === 'idle' && !speaking && this.state.pose === 'idle') {
      this.idleTime += dt;
      if (this.idleTime > 22 + Math.random() * 20 && this.idleActionUntil === 0) {
        this.idleTime = 0;
        const acts: [PoseName, number][] = [
          ['celebrating', 1.3],
          ['thinking', 3],
          ['listening', 3],
          ['nodding', 1.6],
        ];
        const [p, d] = acts[Math.floor(Math.random() * acts.length)];
        this.avatar.setPose(p);
        this.idleActionUntil = t + d;
      }
    } else this.idleTime = 0;
  }

  // ================================================================== speech
  private showSpeech(text: string, durationMs?: number) {
    const autoDuration = durationMs ?? Math.max(1800, Math.min(12000, text.length * 65));
    if (text) this.avatar.speakText(text, Math.min(autoDuration, text.length * 75));
    else this.avatar.setSpeaking(true, 0.75);

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
        this.avatar.setPose('waving');
        this.setTempEmotion('happy', 2);
        this.idleActionUntil = this.clock.elapsedTime + 2;
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
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    if (this.isCompanion) this.companionTick(dt);
    else this.avatar.root.position.y = Math.sin(elapsed * 1.4) * 0.012;
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
