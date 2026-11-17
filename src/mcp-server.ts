import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';

const execFileAsync = promisify(execFile);

let robotModule: any = null;
async function getRobot() {
  if (robotModule !== null) return robotModule;
  try {
    const mod = await import('robotjs');
    robotModule = mod.default || mod;
  } catch {
    robotModule = false;
  }
  return robotModule;
}

const POSES = [
  'idle',
  'pointing',
  'waving',
  'thinking',
  'happy',
  'explaining',
  'listening',
  'shrugging',
  'nodding',
  'shaking_head',
  'greeting',
  'celebrating',
  'focused',
] as const;

const EMOTIONS = [
  'neutral',
  'happy',
  'excited',
  'thinking',
  'curious',
  'surprised',
  'sad',
  'concerned',
  'confident',
  'playful',
  'wink',
] as const;

interface AvatarConfig {
  position: { x: number; y: number };
  size: number;
  pose: string;
  emotion: string;
  appearance: {
    hairColor: string;
    eyeColor: string;
    skinTone: string;
    outfit: string;
    headphoneColor?: string;
  };
}

class AvatarAssistantServer {
  private server: Server;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private httpPort = Number(process.env.AVATAR_HTTP_PORT || 3000);
  private wsPort = Number(process.env.AVATAR_WS_PORT || 8080);
  private avatarConfig: AvatarConfig;
  private instanceId = Math.random().toString(36).slice(2, 8);
  private seq = 0;
  private reports = new Map<string, { client: string; data: any; at: number; address?: string }>();
  private desktopPresent = false;

  constructor() {
    this.server = new Server({
      name: 'avatar-assistant',
      version: '1.2.0',
    });

    this.avatarConfig = {
      position: { x: 100, y: 100 },
      size: 150,
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

    this.setupWebSocketServer();
    setInterval(() => this.updatePresence(), 5000).unref?.();
    this.setupHttpServer();
    this.setupToolHandlers();
  }

  private setupHttpServer() {
    const app = express();
    app.use(express.json());

    const avatarDistDir = path.resolve(__dirname, 'avatar');
    app.use(express.static(avatarDistDir));

    app.get('/api/state', (_req, res) => {
      res.json({
        ...this.avatarConfig,
        connectedViewers: this.clients.size,
        wsPort: this.wsPort,
        clients: this.reportList(),
      });
    });

    app.post('/api/express', async (req, res) => {
      const body = req.body || {};
      if (body.emotion) this.avatarConfig.emotion = body.emotion;
      if (body.pose) this.avatarConfig.pose = body.pose;
      await this.notifyAvatar('express', body);
      res.json({ ok: true, state: this.avatarConfig });
    });

    const httpServer = app.listen(this.httpPort, '0.0.0.0', () => {
      console.error(`Avatar HTTP viewer available at http://0.0.0.0:${this.httpPort}`);
    });
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`HTTP port ${this.httpPort} already in use.`);
      } else {
        console.error('HTTP server error:', err);
      }
    });
  }

  private setupWebSocketServer() {
    const port = this.wsPort;
    try {
      this.wss = new WebSocketServer({ port });

      this.wss.on('connection', (ws) => {
        this.clients.add(ws);
        ws.send(JSON.stringify({ action: 'presence', data: { desktop: this.desktopPresent } }));
        // Sync current avatar state on connect
        ws.send(JSON.stringify({ action: 'customize', data: this.avatarConfig.appearance }));
        ws.send(
          JSON.stringify({
            action: 'express',
            data: { pose: this.avatarConfig.pose, emotion: this.avatarConfig.emotion },
          })
        );

        let clientId = '';
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg && msg.type === 'report' && msg.clientId) {
              clientId = String(msg.clientId);
              this.reports.set(clientId, {
                client: String(msg.client || 'unknown'),
                data: msg.data,
                at: Date.now(),
                address: (ws as any)._socket?.remoteAddress,
              });
              this.updatePresence();
            }
          } catch {
            /* ignore malformed */
          }
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          if (clientId) this.reports.delete(clientId);
          this.updatePresence();
        });
      });

      this.wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`WebSocket port ${port} already in use; relying on IPC if available.`);
        } else {
          console.error('WebSocketServer error:', err);
        }
      });
    } catch (err) {
      console.error('Failed to start WebSocketServer:', err);
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'express',
            description:
              'Express emotion, body pose, gaze, and optional speech/lip-sync on the 3D avatar during conversation.',
            inputSchema: {
              type: 'object',
              properties: {
                emotion: {
                  type: 'string',
                  enum: [...EMOTIONS],
                  description: 'Facial emotion to display',
                },
                pose: {
                  type: 'string',
                  enum: [...POSES],
                  description: 'Anatomical body pose / gesture',
                },
                speechText: {
                  type: 'string',
                  description: 'Optional text shown in speech bubble with lip-sync animation',
                },
                speakAloud: {
                  type: 'boolean',
                  description: 'If true and speechText is provided, also synthesize speech audio',
                },
                gazeTarget: {
                  type: 'object',
                  properties: {
                    x: { type: 'number', description: 'Normalized horizontal gaze (-1..1)' },
                    y: { type: 'number', description: 'Normalized vertical gaze (-1..1)' },
                  },
                },
                intensity: {
                  type: 'number',
                  description: 'Expression intensity from 0 to 1',
                },
              },
            },
          },
          {
            name: 'set_facial_expression',
            description: 'Fine-grained control over facial features (eyes, eyebrows, mouth, gaze).',
            inputSchema: {
              type: 'object',
              properties: {
                emotion: { type: 'string', enum: [...EMOTIONS] },
                mouthOpen: { type: 'number', description: '0..1' },
                smile: { type: 'number', description: '-1..1' },
                eyebrowTilt: { type: 'number', description: '-1..1' },
                eyebrowRaise: { type: 'number', description: '-1..1' },
                leftEyeOpen: { type: 'number', description: '0..1' },
                rightEyeOpen: { type: 'number', description: '0..1' },
                lookAt: {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                  },
                },
              },
            },
          },
          {
            name: 'set_joint_angles',
            description:
              'Directly control anatomical joints in radians (automatically clamped to human anatomical limits).',
            inputSchema: {
              type: 'object',
              properties: {
                angles: {
                  type: 'object',
                  description:
                    'Map of joint name to {x, y, z} radians. Body: hips, spine, chest, neck, head, left/rightClavicle, left/rightShoulder, left/rightElbow, left/rightWrist, left/rightHip, left/rightKnee, left/rightAnkle. Fingers: left/right + Thumb|Index|Middle|Ring|Pinky + 1|2|3 (e.g. rightIndex1). left/right = the avatar\'s own side. Convention (same for both sides): x = flexion (shoulder/hip negative = raise forward; elbow negative = bend; knee positive = bend; fingers positive = curl), y = twist (shoulder positive = external rotation), z = abduction (positive = away from the body midline).',
                },
              },
              required: ['angles'],
            },
          },
          {
            name: 'companion_mode',
            description:
              'Configure the on-screen companion behaviour (desktop app and browser overlay). In "follow" mode the avatar walks on screen surfaces (window edges, straight lines, text lines, bottom of the screen), stays close to the mouse / text cursor and looks at it without covering the text being edited. "roam" wanders around, "stay" keeps her in place.',
            inputSchema: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean', description: 'Enable autonomous movement' },
                mode: { type: 'string', enum: ['follow', 'roam', 'stay'] },
                avoidText: { type: 'boolean', description: 'Avoid covering any text (default true)' },
                followDistance: { type: 'number', description: 'Preferred distance to the cursor in body heights (default 0.9)' },
                walkSpeed: { type: 'number', description: 'Walking speed in px/s (default 130)' },
                runSpeed: { type: 'number', description: 'Running speed in px/s (default 300)' },
                size: { type: 'number', description: 'Avatar window height in px (desktop, 180-900)' },
                captureIntervalMs: { type: 'number', description: 'How often the desktop screen is scanned for surfaces (ms)' },
              },
            },
          },
          {
            name: 'walk_to',
            description:
              'Make the avatar walk (jumping, climbing or dropping between surfaces as needed) to a screen position or a named target. Coordinates are screen pixels on desktop, viewport pixels in the browser.',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                target: { type: 'string', enum: ['cursor', 'left', 'right', 'center', 'top', 'bottom'] },
                holdSeconds: { type: 'number', description: 'How long to stay there before resuming the companion mode (default 25)' },
              },
            },
          },
          {
            name: 'jump',
            description: 'Jump to the nearest reachable surface in a direction (or hop in place).',
            inputSchema: {
              type: 'object',
              properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] } },
            },
          },
          {
            name: 'teleport',
            description: 'Make the avatar drop in from above at a screen position (she falls onto the surface below).',
            inputSchema: {
              type: 'object',
              properties: { x: { type: 'number' }, y: { type: 'number' } },
            },
          },
          {
            name: 'look_at',
            description:
              'Direct the avatar gaze. Either normalized x/y (-1..1, relative to her face) or absolute screenX/screenY pixels (companion mode). By default she follows the mouse / text cursor.',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                screenX: { type: 'number' },
                screenY: { type: 'number' },
                durationMs: { type: 'number', description: 'How long to hold the gaze (default 4000)' },
              },
            },
          },
          {
            name: 'set_hand_gesture',
            description: 'Set a hand shape (fingers are fully articulated).',
            inputSchema: {
              type: 'object',
              properties: {
                side: { type: 'string', enum: ['left', 'right', 'both'] },
                gesture: { type: 'string', enum: ['relaxed', 'open', 'fist', 'point', 'peace', 'thumbsUp'] },
              },
              required: ['gesture'],
            },
          },
          {
            name: 'say',
            description:
              'Show a speech bubble near the avatar with lip-sync (and optional emotion/pose). Use for short messages to the user on screen. speakAloud uses the system TTS of the machine running this server.',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                emotion: { type: 'string', enum: [...EMOTIONS] },
                pose: { type: 'string', enum: [...POSES] },
                durationMs: { type: 'number' },
                speakAloud: { type: 'boolean' },
                voice: { type: 'string' },
              },
              required: ['text'],
            },
          },
          {
            name: 'lip_sync',
            description:
              'Drive the mouth: text (auto visemes over durationMs), a single viseme (A,E,I,O,U,M,F,C,rest), an audio level 0..1, or a timed sequence [{viseme, t (seconds), weight}] for external TTS audio.',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                durationMs: { type: 'number' },
                viseme: { type: 'string', enum: ['rest', 'A', 'E', 'I', 'O', 'U', 'M', 'F', 'C'] },
                weight: { type: 'number' },
                level: { type: 'number' },
                sequence: { type: 'array', items: { type: 'object' } },
              },
            },
          },
          {
            name: 'show_avatar',
            description: 'Show or hide the avatar on screen.',
            inputSchema: {
              type: 'object',
              properties: { visible: { type: 'boolean' } },
              required: ['visible'],
            },
          },
          {
            name: 'get_companion_state',
            description:
              'Live state reported by each connected avatar (desktop app / browser overlay / viewer): locomotion state, position, surface, screen size, cursor and screen-capture permission.',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'move_avatar',
            description: 'Move the avatar to a specific position on screen',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' },
              },
              required: ['x', 'y'],
            },
          },
          {
            name: 'set_avatar_pose',
            description: 'Set the avatar pose',
            inputSchema: {
              type: 'object',
              properties: {
                pose: {
                  type: 'string',
                  enum: [...POSES],
                  description: 'Avatar pose',
                },
              },
              required: ['pose'],
            },
          },
          {
            name: 'customize_avatar',
            description: 'Customize avatar appearance (hair, eyes, skin, outfit, headphones)',
            inputSchema: {
              type: 'object',
              properties: {
                hairColor: { type: 'string', description: 'Hair color hex code' },
                eyeColor: { type: 'string', description: 'Eye color hex code' },
                skinTone: { type: 'string', description: 'Skin tone hex code' },
                outfit: { type: 'string', description: 'Outfit style (noir-gold, casual, formal, sporty)' },
                headphoneColor: { type: 'string', description: 'Headphone headband color hex code' },
              },
            },
          },
          {
            name: 'load_avatar_model',
            description: 'Load a custom 3D GLB/GLTF avatar model URL or file path',
            inputSchema: {
              type: 'object',
              properties: {
                url: { type: 'string', description: 'URL or local path to .glb/.gltf model' },
              },
              required: ['url'],
            },
          },
          {
            name: 'point_at_screen',
            description: 'Make avatar point at specific screen coordinates',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'Screen X coordinate' },
                y: { type: 'number', description: 'Screen Y coordinate' },
              },
              required: ['x', 'y'],
            },
          },
          {
            name: 'get_screen_info',
            description: 'Get screen dimensions and display information',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'voice_input',
            description: 'Capture voice input from user',
            inputSchema: {
              type: 'object',
              properties: {
                duration: { type: 'number', description: 'Recording duration in seconds' },
              },
              required: ['duration'],
            },
          },
          {
            name: 'voice_output',
            description: 'Speak text using voice synthesis with avatar lip-sync',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Text to speak' },
                voice: { type: 'string', description: 'Voice type' },
              },
              required: ['text'],
            },
          },
          {
            name: 'get_avatar_status',
            description:
              'Get current avatar pose, emotion, appearance, connected 3D viewers, and live HTTP viewer URL.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'simulate_click',
            description: 'Simulate mouse click at position',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' },
                button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
              },
              required: ['x', 'y'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'express':
            return await this.express(args as any);

          case 'set_facial_expression':
            return await this.setFacialExpression(args as any);

          case 'set_joint_angles':
            return await this.setJointAngles(args?.angles as Record<string, any>);

          case 'companion_mode': {
            const { size, ...rest } = (args || {}) as Record<string, any>;
            await this.notifyAvatar('companion', { cmd: 'settings', ...rest, ...(size ? { height: size } : {}) });
            return this.text(`Companion settings sent: ${JSON.stringify(args || {})}`);
          }

          case 'walk_to':
            await this.notifyAvatar('companion', { cmd: 'walk_to', ...(args || {}) });
            return this.text(`Walking to ${args?.target ?? `(${args?.x}, ${args?.y})`}`);

          case 'jump':
            await this.notifyAvatar('companion', { cmd: 'jump', direction: args?.direction || 'up' });
            return this.text(`Jumping ${args?.direction || 'up'}`);

          case 'teleport':
            await this.notifyAvatar('companion', { cmd: 'drop_in', x: args?.x, y: args?.y });
            return this.text('Dropping in');

          case 'look_at':
            await this.notifyAvatar('look_at', args || {});
            return this.text('Gaze updated');

          case 'set_hand_gesture':
            await this.notifyAvatar('hand', { side: args?.side || 'both', gesture: args?.gesture });
            return this.text(`Hand gesture: ${args?.gesture}`);

          case 'say': {
            const a = (args || {}) as Record<string, any>;
            if (a.emotion) this.avatarConfig.emotion = a.emotion;
            if (a.pose) this.avatarConfig.pose = a.pose;
            await this.notifyAvatar('express', {
              emotion: a.emotion,
              pose: a.pose,
              speechText: a.text,
              durationMs: a.durationMs,
            });
            if (a.speakAloud) await this.speakText(a.text, a.voice);
            return this.text(`Said: "${a.text}"`);
          }

          case 'lip_sync':
            await this.notifyAvatar('lip_sync', args || {});
            return this.text('Lip-sync sent');

          case 'show_avatar':
            await this.notifyAvatar('companion', { cmd: args?.visible === false ? 'hide' : 'show' });
            return this.text(args?.visible === false ? 'Avatar hidden' : 'Avatar shown');

          case 'get_companion_state':
            await this.notifyAvatar('request_report', {});
            await new Promise((r) => setTimeout(r, 400));
            return this.text(JSON.stringify(this.reportList(), null, 2));

          case 'move_avatar':
            return await this.moveAvatar(args?.x as number, args?.y as number);

          case 'set_avatar_pose':
            return await this.setAvatarPose(args?.pose as string);

          case 'customize_avatar':
            return await this.customizeAvatar(args as Partial<AvatarConfig['appearance']>);

          case 'load_avatar_model':
            return await this.loadAvatarModel(args?.url as string);

          case 'point_at_screen':
            return await this.pointAtScreen(args?.x as number, args?.y as number);

          case 'get_screen_info':
            return await this.getScreenInfo();

          case 'voice_input':
            return await this.captureVoiceInput(args?.duration as number);

          case 'voice_output':
            return await this.speakText(args?.text as string, args?.voice as string);

          case 'get_avatar_status':
            return await this.getAvatarStatus();

          case 'simulate_click':
            return await this.simulateClick(
              args?.x as number,
              args?.y as number,
              args?.button as string
            );

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async express(args: {
    emotion?: string;
    pose?: string;
    speechText?: string;
    speakAloud?: boolean;
    gazeTarget?: { x: number; y: number };
    intensity?: number;
  }) {
    if (args.emotion) this.avatarConfig.emotion = args.emotion;
    if (args.pose) this.avatarConfig.pose = args.pose;

    await this.notifyAvatar('express', args);

    if (args.speakAloud && args.speechText) {
      await this.speakText(args.speechText);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Avatar expressing emotion=${this.avatarConfig.emotion}, pose=${this.avatarConfig.pose}`,
        },
      ],
    };
  }

  private async setFacialExpression(args: Record<string, any>) {
    if (args.emotion) this.avatarConfig.emotion = args.emotion;
    await this.notifyAvatar('face', args);
    return {
      content: [{ type: 'text', text: 'Facial expression updated' }],
    };
  }

  private async setJointAngles(angles: Record<string, any>) {
    await this.notifyAvatar('joints', { angles });
    return {
      content: [
        {
          type: 'text',
          text: `Updated anatomical joints: ${Object.keys(angles || {}).join(', ')}`,
        },
      ],
    };
  }

  private async moveAvatar(x: number, y: number) {
    this.avatarConfig.position = { x, y };
    await this.notifyAvatar('move', { x, y });

    return {
      content: [{ type: 'text', text: `Avatar moved to position (${x}, ${y})` }],
    };
  }

  private async setAvatarPose(pose: string) {
    this.avatarConfig.pose = pose;
    await this.notifyAvatar('pose', { pose });

    return {
      content: [{ type: 'text', text: `Avatar pose set to: ${pose}` }],
    };
  }

  private async customizeAvatar(config: Partial<AvatarConfig['appearance']>) {
    this.avatarConfig.appearance = { ...this.avatarConfig.appearance, ...config };
    await this.notifyAvatar('customize', this.avatarConfig.appearance);

    return {
      content: [{ type: 'text', text: `Avatar appearance updated` }],
    };
  }

  private async loadAvatarModel(url: string) {
    await this.notifyAvatar('load_model', { url });
    return {
      content: [{ type: 'text', text: `Requested custom 3D model load: ${url}` }],
    };
  }

  private async pointAtScreen(x: number, y: number) {
    const dx = x - this.avatarConfig.position.x;
    const dy = y - this.avatarConfig.position.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    await this.notifyAvatar('point', { targetX: x, targetY: y, angle });

    return {
      content: [{ type: 'text', text: `Avatar pointing at screen position (${x}, ${y})` }],
    };
  }

  private async getAvatarStatus() {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              pose: this.avatarConfig.pose,
              emotion: this.avatarConfig.emotion,
              appearance: this.avatarConfig.appearance,
              connectedViewers: this.clients.size,
              clients: this.reportList(),
              viewerUrl: `http://localhost:${this.httpPort}`,
              wsPort: this.wsPort,
              platform: os.platform(),
            },
            null,
            2
          ),
        },
      ],
    };
  }

  private async getScreenInfo() {
    const robot = await getRobot();
    if (!robot) {
      return {
        content: [
          {
            type: 'text',
            text: `Headless environment (robotjs unavailable), Platform: ${os.platform()}`,
          },
        ],
      };
    }
    const { width, height } = robot.getScreenSize();

    return {
      content: [
        {
          type: 'text',
          text: `Screen size: ${width}x${height}, Platform: ${os.platform()}`,
        },
      ],
    };
  }

  private async captureVoiceInput(duration: number) {
    return {
      content: [
        {
          type: 'text',
          text: `Voice input captured for ${duration} seconds (placeholder implementation)`,
        },
      ],
    };
  }

  private async speakText(text: string, voice?: string) {
    await this.notifyAvatar('speak_start', { text });
    try {
      if (process.platform === 'win32') {
        const safeText = text.replace(/'/g, "''");
        await execFileAsync('powershell', [
          '-NoProfile',
          '-Command',
          `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${safeText}')`,
        ]);
      } else if (process.platform === 'darwin') {
        await execFileAsync('say', ['-v', voice || 'Samantha', text]);
      } else {
        await execFileAsync('espeak', [text]);
      }

      return {
        content: [{ type: 'text', text: `Spoke: "${text}"` }],
      };
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: `Displayed speech bubble with lip-sync (system TTS unavailable on ${os.platform()}): "${text}"`,
          },
        ],
      };
    } finally {
      await this.notifyAvatar('speak_end', {});
    }
  }

  private async simulateClick(x: number, y: number, button: string = 'left') {
    const robot = await getRobot();
    if (!robot) {
      return {
        content: [
          {
            type: 'text',
            text: `Click simulation skipped: robotjs unavailable in headless environment`,
          },
        ],
      };
    }
    robot.moveMouse(x, y);
    if (button === 'left' || button === 'right' || button === 'middle') {
      robot.mouseClick(button);
    }

    return {
      content: [{ type: 'text', text: `Simulated ${button} click at (${x}, ${y})` }],
    };
  }

  /** Tell browser overlays whether the desktop companion is on screen (to avoid two avatars). */
  private updatePresence() {
    const now = Date.now();
    const present = [...this.reports.values()].some((r) => r.client === 'companion' && now - r.at < 8000);
    if (present !== this.desktopPresent) {
      this.desktopPresent = present;
      const payload = JSON.stringify({ action: 'presence', data: { desktop: present } });
      this.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(payload));
    }
  }

  private text(t: string) {
    return { content: [{ type: 'text', text: t }] };
  }

  private reportList() {
    const now = Date.now();
    return [...this.reports.entries()]
      .filter(([, r]) => now - r.at < 15000)
      .map(([id, r]) => ({ id, client: r.client, address: r.address, ageMs: now - r.at, ...r.data }));
  }

  private async notifyAvatar(action: string, data: any) {
    const id = `${this.instanceId}:${++this.seq}`;
    const payload = JSON.stringify({ action, data, id });

    // Broadcast to WebSocket avatar clients
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });

    // Forward over IPC if spawned by Electron DesktopWindow
    if (typeof process.send === 'function') {
      process.send({ action, data, id });
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Avatar Assistant MCP server running on stdio');
  }
}

const server = new AvatarAssistantServer();
server.run().catch(console.error);
