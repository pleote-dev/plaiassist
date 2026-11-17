import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

const execFileAsync = promisify(execFile);

// Log level (Advanced tab → AVATAR_LOG_LEVEL). stdout is reserved for MCP, logs go to stderr.
const LEVELS = ["error", "warn", "info", "debug"] as const;
const LOG_LEVEL = Math.max(
  0,
  LEVELS.indexOf((process.env.AVATAR_LOG_LEVEL || "info") as any),
);
function log(level: (typeof LEVELS)[number], ...args: any[]) {
  if (LEVELS.indexOf(level) <= LOG_LEVEL) console.error(`[${level}]`, ...args);
}

let robotModule: any = null;
async function getRobot() {
  if (robotModule !== null) return robotModule;
  try {
    const mod = await import("robotjs");
    robotModule = mod.default || mod;
  } catch {
    robotModule = false;
  }
  return robotModule;
}

const POSES = [
  "idle",
  "pointing",
  "waving",
  "thinking",
  "happy",
  "explaining",
  "listening",
  "shrugging",
  "nodding",
  "shaking_head",
  "greeting",
  "celebrating",
  "focused",
  "dancing",
] as const;

const EMOTIONS = [
  "neutral",
  "happy",
  "excited",
  "thinking",
  "curious",
  "surprised",
  "sad",
  "concerned",
  "confident",
  "playful",
  "wink",
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
  /** Optional shared secret (AVATAR_TOKEN): required by the WebSocket and the HTTP API when set. */
  private token = process.env.AVATAR_TOKEN || "";
  private wssPath: WebSocketServer | null = null;
  private avatarConfig: AvatarConfig;
  private instanceId = Math.random().toString(36).slice(2, 8);
  private seq = 0;
  private reports = new Map<
    string,
    { client: string; data: any; at: number; address?: string }
  >();
  private desktopPresent = false;
  private poseSet = false;
  private emotionSet = false;
  private appearanceSet = new Set<string>();
  private voiceWaiters: ((r: { text?: string; error?: string }) => void)[] = [];

  constructor() {
    this.server = new Server({
      name: "avatar-assistant",
      version: "1.2.0",
    });

    this.avatarConfig = {
      position: { x: 100, y: 100 },
      size: 150,
      pose: "idle",
      emotion: "neutral",
      appearance: {
        hairColor: "#C9A15A",
        eyeColor: "#7A4A1C",
        skinTone: "#F7DCC0",
        outfit: "noir-gold",
        headphoneColor: "#E6C26E",
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
    app.use("/api", (req, res, next) => {
      if (!this.token) return next();
      const t = String(req.headers["x-avatar-token"] || req.query.token || "");
      if (t === this.token) return next();
      res.status(401).json({ error: "invalid token" });
    });
    app.get("/health", (_req, res) =>
      res.json({
        ok: true,
        name: "avatar-assistant",
        clients: this.clients.size,
      }),
    );

    const avatarDistDir = path.resolve(__dirname, "avatar");
    app.use(express.static(avatarDistDir));

    app.get("/api/state", (_req, res) => {
      res.json({
        ...this.avatarConfig,
        connectedViewers: this.clients.size,
        wsPort: this.wsPort,
        wsPath: "/ws",
        clients: this.reportList(),
      });
    });

    app.post("/api/express", async (req, res) => {
      const body = req.body || {};
      if (body.emotion)
        ((this.avatarConfig.emotion = body.emotion), (this.emotionSet = true));
      this.notePose(body);
      await this.notifyAvatar("express", body);
      res.json({ ok: true, state: this.avatarConfig });
    });

    const httpServer = app.listen(this.httpPort, "0.0.0.0", () => {
      log(
        "info",
        `Avatar HTTP viewer available at http://0.0.0.0:${this.httpPort} (WebSocket also at /ws)`,
      );
    });
    // Same WebSocket protocol on the HTTP port (path /ws): one host/port for reverse proxies (HTTPS → wss://host/ws),
    // e.g. to embed the viewer in Home Assistant dashboards.
    this.wssPath = new WebSocketServer({ server: httpServer, path: "/ws" });
    this.wssPath.on("connection", (ws, req) => this.onConnection(ws, req));
    this.wssPath.on("error", (err) =>
      console.error("WebSocket /ws error:", err),
    );
    httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`HTTP port ${this.httpPort} already in use.`);
      } else {
        console.error("HTTP server error:", err);
      }
    });
  }

  private setupWebSocketServer() {
    const port = this.wsPort;
    try {
      this.wss = new WebSocketServer({ port });
      this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
      this.wss.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.error(
            `WebSocket port ${port} already in use; the HTTP port (${this.httpPort}/ws) still works.`,
          );
        } else {
          console.error("WebSocketServer error:", err);
        }
      });
    } catch (err) {
      console.error("Failed to start WebSocketServer:", err);
    }
  }

  private onConnection(ws: WebSocket, req: any) {
    if (this.token) {
      const url = new URL(req?.url || "/", "http://x");
      const t =
        url.searchParams.get("token") ||
        String(req?.headers?.["x-avatar-token"] || "");
      if (t !== this.token) {
        ws.close(4401, "invalid token");
        return;
      }
    }
    this.clients.add(ws);
    ws.send(
      JSON.stringify({
        action: "presence",
        data: { desktop: this.desktopPresent },
      }),
    );
    // Sync only what Hermes changed through the tools; never push this server's defaults over
    // the user's own settings (configuration window) when an avatar (re)connects.
    if (this.appearanceSet.size) {
      const changed: Record<string, any> = {};
      this.appearanceSet.forEach(
        (k) => (changed[k] = (this.avatarConfig.appearance as any)[k]),
      );
      ws.send(JSON.stringify({ action: "customize", data: changed }));
    }
    if (this.poseSet || this.emotionSet) {
      ws.send(
        JSON.stringify({
          action: "express",
          data: {
            ...(this.poseSet ? { pose: this.avatarConfig.pose } : {}),
            ...(this.emotionSet ? { emotion: this.avatarConfig.emotion } : {}),
          },
        }),
      );
    }

    let clientId = "";
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg && msg.type === "voice_input") {
          log("debug", "voice_input from client", msg);
          const w = this.voiceWaiters.splice(0);
          w.forEach((fn) => fn({ text: msg.text, error: msg.error }));
          return;
        }
        if (msg && msg.type === "report" && msg.clientId) {
          clientId = String(msg.clientId);
          this.reports.set(clientId, {
            client: String(msg.client || "unknown"),
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

    ws.on("close", () => {
      this.clients.delete(ws);
      if (clientId) this.reports.delete(clientId);
      this.updatePresence();
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "express",
            description:
              "Express emotion, body pose, gaze, and optional speech/lip-sync on the 3D avatar during conversation.",
            inputSchema: {
              type: "object",
              properties: {
                emotion: {
                  type: "string",
                  enum: [...EMOTIONS],
                  description: "Facial emotion to display",
                },
                pose: {
                  type: "string",
                  enum: [...POSES],
                  description:
                    "Anatomical body pose / gesture (temporary: see holdSeconds)",
                },
                holdSeconds: {
                  type: "number",
                  description:
                    "How long the pose is kept before she goes back to her default pose (default ~12 s). 0 = make it the new default pose.",
                },
                speechText: {
                  type: "string",
                  description:
                    "Optional text shown in speech bubble with lip-sync animation",
                },
                speakAloud: {
                  type: "boolean",
                  description:
                    "If true and speechText is provided, also synthesize speech audio",
                },
                gazeTarget: {
                  type: "object",
                  properties: {
                    x: {
                      type: "number",
                      description: "Normalized horizontal gaze (-1..1)",
                    },
                    y: {
                      type: "number",
                      description: "Normalized vertical gaze (-1..1)",
                    },
                  },
                },
                intensity: {
                  type: "number",
                  description: "Expression intensity from 0 to 1",
                },
              },
            },
          },
          {
            name: "set_facial_expression",
            description:
              "Fine-grained control over facial features (eyes, eyebrows, mouth, gaze).",
            inputSchema: {
              type: "object",
              properties: {
                emotion: { type: "string", enum: [...EMOTIONS] },
                mouthOpen: { type: "number", description: "0..1" },
                smile: { type: "number", description: "-1..1" },
                eyebrowTilt: { type: "number", description: "-1..1" },
                eyebrowRaise: { type: "number", description: "-1..1" },
                leftEyeOpen: { type: "number", description: "0..1" },
                rightEyeOpen: { type: "number", description: "0..1" },
                lookAt: {
                  type: "object",
                  properties: {
                    x: { type: "number" },
                    y: { type: "number" },
                  },
                },
              },
            },
          },
          {
            name: "set_joint_angles",
            description:
              "Directly control anatomical joints in radians (automatically clamped to human anatomical limits).",
            inputSchema: {
              type: "object",
              properties: {
                angles: {
                  type: "object",
                  description:
                    "Map of joint name to {x, y, z} radians. Body: hips, spine, chest, neck, head, left/rightClavicle, left/rightShoulder, left/rightElbow, left/rightWrist, left/rightHip, left/rightKnee, left/rightAnkle. Fingers: left/right + Thumb|Index|Middle|Ring|Pinky + 1|2|3 (e.g. rightIndex1). left/right = the avatar's own side. Convention (same for both sides): x = flexion (shoulder/hip negative = raise forward; elbow negative = bend; knee positive = bend; fingers positive = curl), y = twist (shoulder positive = external rotation), z = abduction (positive = away from the body midline).",
                },
              },
              required: ["angles"],
            },
          },
          {
            name: "companion_mode",
            description:
              'Configure the on-screen companion behaviour (desktop app and browser overlay). In "follow" mode the avatar walks on screen surfaces (window edges, straight lines, text lines, bottom of the screen), stays close to the mouse / text cursor and looks at it without covering the text being edited. "roam" wanders around, "stay" keeps her in place.',
            inputSchema: {
              type: "object",
              properties: {
                enabled: {
                  type: "boolean",
                  description: "Enable autonomous movement",
                },
                mode: { type: "string", enum: ["follow", "roam", "stay"] },
                avoidText: {
                  type: "boolean",
                  description: "Avoid covering any text (default true)",
                },
                followDistance: {
                  type: "number",
                  description:
                    "Preferred distance to the cursor in body heights (default 0.9)",
                },
                walkSpeed: {
                  type: "number",
                  description: "Walking speed in px/s (default 130)",
                },
                runSpeed: {
                  type: "number",
                  description: "Running speed in px/s (default 300)",
                },
                size: {
                  type: "number",
                  description: "Avatar window height in px (desktop, 180-900)",
                },
                captureIntervalMs: {
                  type: "number",
                  description:
                    "How often the desktop screen is scanned for surfaces (ms)",
                },
                idleRoam: {
                  type: "boolean",
                  description:
                    "Stroll around the screen (changing poses) while the user is inactive, then return to the configured behaviour when they are back",
                },
                idleRoamDelay: {
                  type: "number",
                  description:
                    "Seconds without keyboard/mouse activity before strolling (default 60)",
                },
              },
            },
          },
          {
            name: "walk_to",
            description:
              "Make the avatar walk (jumping, climbing or dropping between surfaces as needed) to a screen position or a named target. Coordinates are screen pixels on desktop, viewport pixels in the browser.",
            inputSchema: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                target: {
                  type: "string",
                  enum: ["cursor", "left", "right", "center", "top", "bottom"],
                },
                holdSeconds: {
                  type: "number",
                  description:
                    "How long to stay there before resuming the companion mode (default 25)",
                },
              },
            },
          },
          {
            name: "jump",
            description:
              "Jump to the nearest reachable surface in a direction (or hop in place).",
            inputSchema: {
              type: "object",
              properties: {
                direction: {
                  type: "string",
                  enum: ["up", "down", "left", "right"],
                },
              },
            },
          },
          {
            name: "teleport",
            description:
              "Make the avatar drop in from above at a screen position (she falls onto the surface below).",
            inputSchema: {
              type: "object",
              properties: { x: { type: "number" }, y: { type: "number" } },
            },
          },
          {
            name: "look_at",
            description:
              "Direct the avatar gaze. Either normalized x/y (-1..1, relative to her face) or absolute screenX/screenY pixels (companion mode). By default she follows the mouse / text cursor.",
            inputSchema: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
                screenX: { type: "number" },
                screenY: { type: "number" },
                durationMs: {
                  type: "number",
                  description: "How long to hold the gaze (default 4000)",
                },
              },
            },
          },
          {
            name: "set_hand_gesture",
            description: "Set a hand shape (fingers are fully articulated).",
            inputSchema: {
              type: "object",
              properties: {
                side: { type: "string", enum: ["left", "right", "both"] },
                gesture: {
                  type: "string",
                  enum: [
                    "relaxed",
                    "open",
                    "fist",
                    "point",
                    "peace",
                    "thumbsUp",
                  ],
                },
              },
              required: ["gesture"],
            },
          },
          {
            name: "say",
            description:
              "Show a speech bubble near the avatar with lip-sync (and optional emotion/pose). Use for short messages to the user on screen. speakAloud uses the system TTS of the machine running this server.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
                emotion: { type: "string", enum: [...EMOTIONS] },
                pose: {
                  type: "string",
                  enum: [...POSES],
                  description: "Temporary pose while saying it",
                },
                holdSeconds: {
                  type: "number",
                  description:
                    "How long to keep the pose (default: while talking + 3 s)",
                },
                durationMs: { type: "number" },
                speakAloud: { type: "boolean" },
                voice: { type: "string" },
              },
              required: ["text"],
            },
          },
          {
            name: "lip_sync",
            description:
              "Drive the mouth: text (auto visemes over durationMs), a single viseme (A,E,I,O,U,M,F,C,rest), an audio level 0..1, or a timed sequence [{viseme, t (seconds), weight}] for external TTS audio.",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
                durationMs: { type: "number" },
                viseme: {
                  type: "string",
                  enum: ["rest", "A", "E", "I", "O", "U", "M", "F", "C"],
                },
                weight: { type: "number" },
                level: { type: "number" },
                sequence: { type: "array", items: { type: "object" } },
              },
            },
          },
          {
            name: "show_avatar",
            description: "Show or hide the avatar on screen.",
            inputSchema: {
              type: "object",
              properties: { visible: { type: "boolean" } },
              required: ["visible"],
            },
          },
          {
            name: "get_companion_state",
            description:
              "Live state reported by each connected avatar (desktop app / browser overlay / viewer): locomotion state, position, surface, screen size, cursor and screen-capture permission.",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "move_avatar",
            description: "Move the avatar to a specific position on screen",
            inputSchema: {
              type: "object",
              properties: {
                x: { type: "number", description: "X coordinate" },
                y: { type: "number", description: "Y coordinate" },
              },
              required: ["x", "y"],
            },
          },
          {
            name: "set_avatar_pose",
            description:
              'Set the avatar pose. By default the pose is temporary (holdSeconds, ~12 s) and then she returns to the default pose configured by the user. Use default=true (or holdSeconds=0) to change the default pose; pose "auto" makes her rotate between poses randomly by herself.',
            inputSchema: {
              type: "object",
              properties: {
                pose: {
                  type: "string",
                  enum: [...POSES, "auto"],
                  description: 'Avatar pose ("auto" = rotate poses randomly)',
                },
                holdSeconds: {
                  type: "number",
                  description:
                    "How long the pose is kept before she goes back to her default pose (default ~12 s). 0 = make it the new default pose.",
                },
                default: {
                  type: "boolean",
                  description:
                    "Make it the default pose instead of a temporary one",
                },
              },
              required: ["pose"],
            },
          },
          {
            name: "customize_avatar",
            description:
              "Customize avatar appearance (colours, outfit, headphones, face shape, eyes, nose, mouth and hairstyle)",
            inputSchema: {
              type: "object",
              properties: {
                hairColor: {
                  type: "string",
                  description: "Hair color hex code",
                },
                eyeColor: { type: "string", description: "Eye color hex code" },
                skinTone: { type: "string", description: "Skin tone hex code" },
                outfit: {
                  type: "string",
                  description:
                    "Outfit style (noir-gold, casual, formal, sporty)",
                },
                headphoneColor: {
                  type: "string",
                  description: "Headphone headband color hex code",
                },
                faceShape: {
                  type: "string",
                  enum: ["oval", "round", "square", "heart"],
                },
                faceRoundness: {
                  type: "number",
                  description: "0..100 (50 = default)",
                },
                eyeStyle: {
                  type: "string",
                  enum: ["normal", "large", "almond", "cat"],
                },
                eyeSize: {
                  type: "number",
                  description: "20..100 (50 = default)",
                },
                noseSize: {
                  type: "number",
                  description: "20..100 (50 = default)",
                },
                mouthSize: {
                  type: "number",
                  description: "20..100 (50 = default)",
                },
                hairStyle: {
                  type: "string",
                  enum: ["long", "short", "curly", "ponytail"],
                },
              },
            },
          },
          {
            name: "load_avatar_model",
            description:
              "Load a custom 3D GLB/GLTF avatar model URL or file path",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "URL or local path to .glb/.gltf model",
                },
              },
              required: ["url"],
            },
          },
          {
            name: "point_at_screen",
            description: "Make avatar point at specific screen coordinates",
            inputSchema: {
              type: "object",
              properties: {
                x: { type: "number", description: "Screen X coordinate" },
                y: { type: "number", description: "Screen Y coordinate" },
              },
              required: ["x", "y"],
            },
          },
          {
            name: "get_screen_info",
            description: "Get screen dimensions and display information",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "voice_input",
            description: "Capture voice input from user",
            inputSchema: {
              type: "object",
              properties: {
                duration: {
                  type: "number",
                  description: "Recording duration in seconds",
                },
              },
              required: ["duration"],
            },
          },
          {
            name: "voice_output",
            description:
              "Speak text using voice synthesis with avatar lip-sync",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string", description: "Text to speak" },
                voice: { type: "string", description: "Voice type" },
              },
              required: ["text"],
            },
          },
          {
            name: "get_avatar_status",
            description:
              "Get current avatar pose, emotion, appearance, connected 3D viewers, and live HTTP viewer URL.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "simulate_click",
            description: "Simulate mouse click at position",
            inputSchema: {
              type: "object",
              properties: {
                x: { type: "number", description: "X coordinate" },
                y: { type: "number", description: "Y coordinate" },
                button: {
                  type: "string",
                  enum: ["left", "right", "middle"],
                  description: "Mouse button",
                },
              },
              required: ["x", "y"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "express":
            return await this.express(args as any);

          case "set_facial_expression":
            return await this.setFacialExpression(args as any);

          case "set_joint_angles":
            return await this.setJointAngles(
              args?.angles as Record<string, any>,
            );

          case "companion_mode": {
            const { size, ...rest } = (args || {}) as Record<string, any>;
            await this.notifyAvatar("companion", {
              cmd: "settings",
              ...rest,
              ...(size ? { height: size } : {}),
            });
            return this.text(
              `Companion settings sent: ${JSON.stringify(args || {})}`,
            );
          }

          case "walk_to":
            await this.notifyAvatar("companion", {
              cmd: "walk_to",
              ...(args || {}),
            });
            return this.text(
              `Walking to ${args?.target ?? `(${args?.x}, ${args?.y})`}`,
            );

          case "jump":
            await this.notifyAvatar("companion", {
              cmd: "jump",
              direction: args?.direction || "up",
            });
            return this.text(`Jumping ${args?.direction || "up"}`);

          case "teleport":
            await this.notifyAvatar("companion", {
              cmd: "drop_in",
              x: args?.x,
              y: args?.y,
            });
            return this.text("Dropping in");

          case "look_at":
            await this.notifyAvatar("look_at", args || {});
            return this.text("Gaze updated");

          case "set_hand_gesture":
            await this.notifyAvatar("hand", {
              side: args?.side || "both",
              gesture: args?.gesture,
            });
            return this.text(`Hand gesture: ${args?.gesture}`);

          case "say": {
            const a = (args || {}) as Record<string, any>;
            if (a.emotion)
              ((this.avatarConfig.emotion = a.emotion),
                (this.emotionSet = true));
            this.notePose(a);
            await this.notifyAvatar("express", {
              emotion: a.emotion,
              pose: a.pose,
              holdSeconds: a.holdSeconds,
              speechText: a.text,
              durationMs: a.durationMs,
            });
            if (a.speakAloud) await this.speakText(a.text, a.voice);
            return this.text(`Said: "${a.text}"`);
          }

          case "lip_sync":
            await this.notifyAvatar("lip_sync", args || {});
            return this.text("Lip-sync sent");

          case "show_avatar":
            await this.notifyAvatar("companion", {
              cmd: args?.visible === false ? "hide" : "show",
            });
            return this.text(
              args?.visible === false ? "Avatar hidden" : "Avatar shown",
            );

          case "get_companion_state":
            await this.notifyAvatar("request_report", {});
            await new Promise((r) => setTimeout(r, 400));
            return this.text(JSON.stringify(this.reportList(), null, 2));

          case "move_avatar":
            return await this.moveAvatar(args?.x as number, args?.y as number);

          case "set_avatar_pose":
            return await this.setAvatarPose(
              args?.pose as string,
              args as Record<string, any>,
            );

          case "customize_avatar":
            return await this.customizeAvatar(
              args as Partial<AvatarConfig["appearance"]>,
            );

          case "load_avatar_model":
            return await this.loadAvatarModel(args?.url as string);

          case "point_at_screen":
            return await this.pointAtScreen(
              args?.x as number,
              args?.y as number,
            );

          case "get_screen_info":
            return await this.getScreenInfo();

          case "voice_input":
            return await this.captureVoiceInput(args?.duration as number);

          case "voice_output":
            return await this.speakText(
              args?.text as string,
              args?.voice as string,
            );

          case "get_avatar_status":
            return await this.getAvatarStatus();

          case "simulate_click":
            return await this.simulateClick(
              args?.x as number,
              args?.y as number,
              args?.button as string,
            );

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`,
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
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
    holdSeconds?: number;
    default?: boolean;
  }) {
    if (args.emotion)
      ((this.avatarConfig.emotion = args.emotion), (this.emotionSet = true));
    this.notePose(args);

    await this.notifyAvatar("express", args);

    if (args.speakAloud && args.speechText) {
      await this.speakText(args.speechText);
    }

    return {
      content: [
        {
          type: "text",
          text: `Avatar expressing emotion=${this.avatarConfig.emotion}, pose=${this.avatarConfig.pose}`,
        },
      ],
    };
  }

  private async setFacialExpression(args: Record<string, any>) {
    if (args.emotion)
      ((this.avatarConfig.emotion = args.emotion), (this.emotionSet = true));
    await this.notifyAvatar("face", args);
    return {
      content: [{ type: "text", text: "Facial expression updated" }],
    };
  }

  private async setJointAngles(angles: Record<string, any>) {
    await this.notifyAvatar("joints", { angles });
    return {
      content: [
        {
          type: "text",
          text: `Updated anatomical joints: ${Object.keys(angles || {}).join(", ")}`,
        },
      ],
    };
  }

  private async moveAvatar(x: number, y: number) {
    this.avatarConfig.position = { x, y };
    await this.notifyAvatar("move", { x, y });

    return {
      content: [
        { type: "text", text: `Avatar moved to position (${x}, ${y})` },
      ],
    };
  }

  /** Only a pose meant as the new default is remembered (and re-sent when a client connects). */
  private notePose(a: {
    pose?: string;
    holdSeconds?: number;
    default?: boolean;
  }) {
    if (!a?.pose) return;
    if (a.pose === "auto" || a.default === true || a.holdSeconds === 0) {
      this.avatarConfig.pose = a.pose;
      this.poseSet = true;
    }
  }

  private async setAvatarPose(pose: string, args: Record<string, any> = {}) {
    const data = { pose, holdSeconds: args.holdSeconds, default: args.default };
    this.notePose(data);
    await this.notifyAvatar("pose", data);
    const temp = !(
      pose === "auto" ||
      args.default === true ||
      args.holdSeconds === 0
    );
    return {
      content: [
        {
          type: "text",
          text: temp
            ? `Avatar pose ${pose} for ${args.holdSeconds ?? 12}s, then back to her default pose`
            : `Default pose set to: ${pose}`,
        },
      ],
    };
  }

  private async customizeAvatar(config: Partial<AvatarConfig["appearance"]>) {
    this.avatarConfig.appearance = {
      ...this.avatarConfig.appearance,
      ...config,
    };
    Object.keys(config || {}).forEach((k) => this.appearanceSet.add(k));
    await this.notifyAvatar("customize", config);

    return {
      content: [{ type: "text", text: `Avatar appearance updated` }],
    };
  }

  private async loadAvatarModel(url: string) {
    await this.notifyAvatar("load_model", { url });
    return {
      content: [
        { type: "text", text: `Requested custom 3D model load: ${url}` },
      ],
    };
  }

  private async pointAtScreen(x: number, y: number) {
    const dx = x - this.avatarConfig.position.x;
    const dy = y - this.avatarConfig.position.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    await this.notifyAvatar("point", { targetX: x, targetY: y, angle });

    return {
      content: [
        {
          type: "text",
          text: `Avatar pointing at screen position (${x}, ${y})`,
        },
      ],
    };
  }

  private async getAvatarStatus() {
    return {
      content: [
        {
          type: "text",
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
            2,
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
            type: "text",
            text: `Headless environment (robotjs unavailable), Platform: ${os.platform()}`,
          },
        ],
      };
    }
    const { width, height } = robot.getScreenSize();

    return {
      content: [
        {
          type: "text",
          text: `Screen size: ${width}x${height}, Platform: ${os.platform()}`,
        },
      ],
    };
  }

  /** Asks the avatar(s) to listen with the microphone and returns the first transcript. */
  private async captureVoiceInput(duration: number) {
    const secs = Math.max(1, Math.min(30, Number(duration) || 6));
    if (this.clients.size === 0 && typeof process.send !== "function") {
      return this.text(
        "No avatar client connected to listen (desktop app or browser overlay).",
      );
    }
    const result = await new Promise<{ text?: string; error?: string }>(
      (resolve) => {
        const timer = setTimeout(
          () => resolve({ error: "timeout (no speech recognised)" }),
          (secs + 4) * 1000,
        );
        this.voiceWaiters.push((r) => {
          clearTimeout(timer);
          resolve(r);
        });
        this.notifyAvatar("listen", { duration: secs });
      },
    );
    return this.text(
      result.text
        ? `User said: "${result.text}"`
        : `Voice input unavailable: ${result.error}`,
    );
  }

  private async speakText(text: string, voice?: string) {
    const now = Date.now();
    const avatarPresent = [...this.reports.values()].some(
      (r) => now - r.at < 8000,
    );
    if (avatarPresent) {
      // the desktop / browser avatar speaks with its own voice settings (Voice tab) and lip-syncs
      await this.notifyAvatar("speak_start", { text, forceVoice: true });
      return this.text(`Avatar is speaking: "${text}"`);
    }
    await this.notifyAvatar("speak_start", { text });
    try {
      if (process.platform === "win32") {
        const safeText = text.replace(/'/g, "''");
        await execFileAsync("powershell", [
          "-NoProfile",
          "-Command",
          `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${safeText}')`,
        ]);
      } else if (process.platform === "darwin") {
        await execFileAsync("say", ["-v", voice || "Samantha", text]);
      } else {
        await execFileAsync("espeak", [text]);
      }

      return {
        content: [{ type: "text", text: `Spoke: "${text}"` }],
      };
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `Displayed speech bubble with lip-sync (system TTS unavailable on ${os.platform()}): "${text}"`,
          },
        ],
      };
    } finally {
      await this.notifyAvatar("speak_end", {});
    }
  }

  private async simulateClick(x: number, y: number, button: string = "left") {
    const robot = await getRobot();
    if (!robot) {
      return {
        content: [
          {
            type: "text",
            text: `Click simulation skipped: robotjs unavailable in headless environment`,
          },
        ],
      };
    }
    robot.moveMouse(x, y);
    if (button === "left" || button === "right" || button === "middle") {
      robot.mouseClick(button);
    }

    return {
      content: [
        { type: "text", text: `Simulated ${button} click at (${x}, ${y})` },
      ],
    };
  }

  /** Tell browser overlays whether the desktop companion is on screen (to avoid two avatars). */
  private updatePresence() {
    const now = Date.now();
    const present = [...this.reports.values()].some(
      (r) => r.client === "companion" && now - r.at < 8000,
    );
    if (present !== this.desktopPresent) {
      this.desktopPresent = present;
      const payload = JSON.stringify({
        action: "presence",
        data: { desktop: present },
      });
      this.clients.forEach(
        (c) => c.readyState === WebSocket.OPEN && c.send(payload),
      );
    }
  }

  private text(t: string) {
    return { content: [{ type: "text", text: t }] };
  }

  private reportList() {
    const now = Date.now();
    return [...this.reports.entries()]
      .filter(([, r]) => now - r.at < 15000)
      .map(([id, r]) => ({
        id,
        client: r.client,
        address: r.address,
        ageMs: now - r.at,
        ...r.data,
      }));
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
    if (typeof process.send === "function") {
      process.send({ action, data, id });
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log("info", "Avatar Assistant MCP server running on stdio");
  }
}

const server = new AvatarAssistantServer();
server.run().catch(console.error);
