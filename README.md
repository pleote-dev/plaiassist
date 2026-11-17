# Hermes 3D Avatar Assistant (`plaiassist`)

An interactive, anatomically articulated 3D desktop & browser companion built with **Three.js**, **Electron**, **TypeScript**, and the **Model Context Protocol (MCP)** so AI agents like **Hermes** can express emotions, body language, gaze, and lip-synced speech in real time.

---

## Features

- **Anatomical 3D Rig (`src/avatar/rigged-avatar.ts`)**: Hierarchical skeletal rig (`hips`, `spine`, `chest`, `neck`, `head`, shoulders, elbows, wrists/hands, hips, knees) with human anatomical joint limits, natural breathing, blinking, gaze tracking, facial expressions, and lip-sync.
- **Desktop Companion Mode (`src/companion/`)**: Transparent, non-focusable, click-through Electron overlay that walks along window edges and text lines, avoids covering text you're reading, follows your cursor, and supports drag & drop.
- **Chrome / Edge / Brave Extension (`src/extension/`)**: Renders the companion directly inside web pages, using page elements and text lines as platforms, synced via WebSocket.
- **Hermes MCP Server (`src/mcp-server.ts`)**:
  - Runs over `stdio` for Hermes/MCP clients.
  - Exposes a **WebSocket server** (`:8080`) for real-time avatar control and an **Express HTTP viewer** (`:3000`) for headless/VM setups.
  - Safely degrades on headless Linux VMs (no X11/`robotjs` required).
- **Custom 3D Model Support**: Load external `.glb`/`.gltf` models via `load_avatar_model`.

---

## Project Structure

```text
plaiassist/
├── src/
│   ├── avatar/           # Three.js 3D rigged avatar, facial animation & renderer
│   ├── companion/        # Locomotion physics engine & desktop screen analysis
│   ├── extension/        # Manifest V3 Chrome extension (background, content, popup)
│   ├── config/           # Desktop settings UI
│   ├── desktop-window.ts # Electron main process & tray integration
│   └── mcp-server.ts     # MCP + WebSocket + HTTP server for Hermes
├── hermes/
│   ├── SKILL.md          # Hermes skill instructions for conversational avatar use
│   └── install-hermes.sh # Headless VM installer for Hermes
├── scripts/
│   └── build-extension.mjs
└── vite.config.mts       # Avatar & config Vite build configs
```

---

## Quick Start

### 1. Install & Build

```bash
npm install
npm run build
```

### 2. Run the Desktop Companion (macOS / Windows / Linux)

```bash
npm run start:companion
```

On first launch, `~/.plaiassist/config.json` is created:

```json
{
  "wsUrl": "ws://<HERMES_VM_IP>:8080",
  "startLocalServer": false,
  "companion": {
    "enabled": true,
    "mode": "follow",
    "avoidText": true,
    "followDistance": 0.75,
    "height": 340,
    "captureIntervalMs": 1500
  }
}
```

- Leave `"wsUrl": ""` and `"startLocalServer": true` to use the built-in local server (`ws://localhost:8080`).
- Set `"wsUrl": "ws://<HERMES_VM_IP>:8080"` and `"startLocalServer": false` to connect to a remote Hermes VM.
- **macOS Screen Recording**: Grant permission in **System Settings › Privacy & Security › Screen Recording** (for `Electron` / Terminal) so the companion can detect window edges and text lines. Without it, she stays at the bottom of the screen.

### 3. Browser Extension (Chrome / Edge / Brave)

```bash
npm run build:extension
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `dist/extension`.
3. Open the extension popup, set the WebSocket URL (e.g. `ws://<HERMES_VM_IP>:8080`), and click **Save**.

### 4. Deploy to a Hermes VM (Headless Linux)

Copy the compiled bundle to your Hermes VM and run the installer:

```bash
scp -r dist package.json hermes hermes@<VM_IP>:~/plaiassist-bundle
ssh hermes@<VM_IP> "cd ~/plaiassist-bundle && ./hermes/install-hermes.sh"
```

Add the printed `mcp_servers` entry to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  avatar-assistant:
    command: "node"
    args:
      - "/home/hermes/avatar-assistant/dist/mcp-server.js"
    env:
      AVATAR_HTTP_PORT: "3000"
      AVATAR_WS_PORT: "8080"
```

Open `http://<VM_IP>:3000/` in any browser to view the live 3D avatar.

---

## MCP Tools Reference

| Category | Tools |
| --- | --- |
| **Expression & Face** | `express`, `set_facial_expression`, `say`, `lip_sync`, `voice_output` |
| **Body & Anatomy** | `set_avatar_pose`, `set_joint_angles`, `set_hand_gesture`, `look_at`, `point_at_screen` |
| **Companion Locomotion** | `companion_mode`, `walk_to`, `jump`, `teleport`, `show_avatar`, `get_companion_state` |
| **Customization & Status** | `customize_avatar`, `load_avatar_model`, `get_avatar_status`, `move_avatar` |
| **Desktop Utilities** | `get_screen_info`, `simulate_click`, `voice_input` |

---

## Development

```bash
npm run dev          # Watch MCP server + Avatar + Config Vite dev servers
npm run build        # Build MCP, Electron main, Avatar, Config, and Extension
npx tsc --noEmit     # Typecheck all TypeScript sources
```

## License

MIT
