# Avatar Assistant MCP

A desktop assistant with a customizable 3D avatar girl that can interface with the desktop and user through voice and visual interactions.

o avater deve interagir com outras aplicações. A avatar tem de correr em background como um serviço e tendo interface com o utilizador apenas com a avatar onde o utilizador interage e terá acesso a um menu que abre as configurações.

## Features

- **3D Avatar**: Small, customizable 3D girl avatar using Three.js
- **Always on Top**: Stays above other windows
- **Screen Pointing**: Can point to any location on the screen
- **Voice Interaction**: Voice input/output capabilities
- **Customizable Appearance**: Modify hair color, eye color, skin tone, and outfits
- **MCP Integration**: Full Model Context Protocol server integration
- **Desktop Control**: Mouse simulation and screen interaction

## Installation

Guia completo (VM do Hermes, app no Mac, extensões dos browsers, Home Assistant): **[INSTALL.md](INSTALL.md)**.

```bash
npm install && npm run build && npm start      # app no Mac a partir do código
bash hermes/deploy-to-hermes.sh hermes@<IP_VM> # copiar, compilar e instalar na VM do Hermes
```

## Development

```bash
# Start development servers (MCP server + Avatar window)
npm run dev

# Build for production
npm run build

# Start production build
npm start
```

## Architecture

### Components

1. **MCP Server** (`src/mcp-server.ts`)
   - Handles MCP protocol communication
   - Provides tools for avatar control and desktop interaction
   - Manages voice input/output and screen operations

2. **3D Avatar** (`src/avatar/main.ts`)
   - Three.js-based 3D rendering
   - Real-time pose and appearance updates
   - Smooth animations and interactions

3. **Desktop Window** (`src/desktop-window.ts`)
   - Electron-based transparent window
   - Always-on-top behavior
   - Click-through functionality

4. **Preload Script** (`src/preload.ts`)
   - Secure bridge between main and renderer processes
   - Exposes safe APIs for avatar control

## MCP Tools

The server provides the following tools:

- `move_avatar` - Move avatar to specific screen position
- `set_avatar_pose` - Change avatar pose (temporary by default via `holdSeconds`; `default: true` or `auto` changes the default pose)
- `customize_avatar` - Customize appearance (hair color, eye color, skin tone, outfit)
- `point_at_screen` - Make avatar point at screen coordinates
- `get_screen_info` - Get screen dimensions and display info
- `voice_input` - Capture voice input from user
- `voice_output` - Speak text using voice synthesis
- `simulate_click` - Simulate mouse clicks at positions

## Avatar Customization

### Appearance Options
- **Hair Color**: Hex color code
- **Eye Color**: Hex color code  
- **Skin Tone**: Hex color code
- **Outfit**: casual, formal, sporty

### Poses
- **idle**: Default standing pose with gentle rotation
- **pointing**: Arm extended to point at target
- **waving**: Arm raised in greeting
- **thinking**: Hand to chin pose
- **happy**: Arms raised in cheerful pose

### Default pose "Auto" and temporary poses
- **Auto** (first card in *Default Pose*) makes her rotate between poses randomly every ~15–30 s.
- Poses asked by Hermes (`express`, `say`, `set_avatar_pose`) are temporary (`holdSeconds`); afterwards she returns to the configured default (Auto or a fixed pose).

### Stroll when idle
*Behavior → Passear pelo ecrã quando estou inativo* (also in the tray/right-click menu and in the extension popup):
after N seconds without keyboard/mouse activity she switches to `roam`, wandering around the screen and changing poses more often;
as soon as you touch the mouse or keyboard she goes back to the configured mode (follow / stay / roam). Desktop uses the system
idle time; the extension uses activity on the page.

## Ligação ao Hermes (VM)

O servidor do avatar (`mcp-server.js`) corre **na VM do Hermes**: o Hermes arranca-o por stdio (ver
`hermes/install-hermes.sh` e `~/.hermes/config.yaml`). Enquanto o Hermes está ativo, esse servidor abre:

| Porta | O quê |
|---|---|
| `8080` | WebSocket para a app desktop e a extensão |
| `3000` | Viewer web (`http://<VM>:3000`), API (`/api/state`, `/api/express`), `/health`, e o mesmo WebSocket em `/ws` |

**App no Mac:** *Settings → Advanced → Ligação ao Hermes* → escreve o IP da VM (ex. `192.168.1.50`, fica
`ws://192.168.1.50:8080`), **Testar ligação**, depois **Save**. O "servidor local" do Mac só é preciso sem o Hermes; pode ficar desligado.
O estado mostra se o avatar está ligado e, se o servidor local falhar, o motivo (ex. porta ocupada).

**Extensão:** popup → servidor `ws://<VM>:8080`.

**Token (opcional):** `AVATAR_TOKEN` no `env` do Hermes. Os clientes passam a precisar de `?token=…`
(app: `ws://<VM>:8080/?token=…`; viewer: `...?token=…`). Recomendado se expuseres o avatar fora da rede local.

## Home Assistant (dashboards)

O viewer da VM pode ser embutido num cartão **Webpage** (iframe):

```yaml
type: iframe
url: http://192.168.1.50:3000/?embed=1
aspect_ratio: 120%
```

Parâmetros: `embed=1` (sem botões/estado, fundo transparente), `bg=%23111827` (cor de fundo), `voice=1` (este ecrã também fala;
por defeito fica em silêncio quando embutido, para não falarem vários dispositivos ao mesmo tempo; o browser só toca som depois de um toque no ecrã),
`token=…`.

Se o Home Assistant for aberto por **HTTPS** (ex. DuckDNS + Nginx Proxy Manager), um iframe `http://` é bloqueado (conteúdo misto).
Cria no NPM um proxy host próprio (ex. `avatar.<teu>.duckdns.org` → `<VM>:3000`), com **Websockets Support** ligado e certificado SSL,
e usa `https://avatar.<teu>.duckdns.org/?embed=1&token=…`. O viewer liga-se automaticamente a `wss://<mesmo host>/ws`.
Usa um subdomínio (não um sub-caminho), porque a página carrega os ficheiros a partir de `/`.

## Usage

1. Start the application with `npm run dev`
2. The avatar appears as a small floating window
3. Connect via MCP client to control the avatar
4. Use MCP tools to move, pose, and customize the avatar
5. Avatar can point at screen elements and interact with desktop

## Voice Features

- **Voice Input**: Capture user voice commands
- **Voice Output**: Text-to-speech synthesis
- **Platform Support**: Uses system TTS (say on macOS, SAPI on Windows)

## Technical Details

- **Framework**: Electron + Three.js + TypeScript
- **Protocol**: Model Context Protocol (MCP)
- **Rendering**: WebGL with transparent background
- **Animation**: RequestAnimationFrame-based smooth motion
- **Communication**: IPC + WebSocket for real-time updates

## License

MIT


## Companion mode (desktop & browser) — v1.2

The avatar lives on top of whatever you are doing, with a transparent background:

- **Walks on the screen**: window edges, straight lines, text lines and the bottom of the screen are platforms.
  She walks/runs along them, jumps up, climbs, hops or climbs down to other surfaces and falls if a window moves away.
- **Stays close but out of the way**: follows the mouse (and the text caret in the browser), looks at it, and picks
  a spot that does not cover the text you are working on (configurable `avoidText`).
- **Never steals focus**: the desktop window is non-focusable and click-through except over her body.
  Drag her with the mouse (she dangles and falls when released). Right-click: menu (follow / roam / stay, size, …).

### Desktop app

```bash
npm install
npm run start:companion        # builds main + MCP server + avatar and launches Electron
```

Runtime config in `~/.plaiassist/config.json` (created on first run):

```json
{
  "wsUrl": "ws://192.168.1.50:8080",   // MCP server used by Hermes (empty = local server)
  "startLocalServer": true,
  "companion": { "enabled": true, "mode": "follow", "avoidText": true, "height": 340, "captureIntervalMs": 1500 }
}
```

macOS: to walk on windows and text she needs **System Settings › Privacy & Security › Screen Recording** permission
for the app (without it she stays on the bottom of the screen). Her own window is excluded from the capture.
`AVATAR_COMPANION=0` restores the old static window.

### Browser extension (Chrome / Edge / Brave)

```bash
npm run build:extension         # → dist/extension
```

Open `chrome://extensions`, enable *Developer mode*, *Load unpacked* → `dist/extension`.
In the extension popup set the Hermes server (`ws://<VM_IP>:8080`, or `wss://…` behind a reverse proxy).
The overlay uses the page's boxes, rules and text lines as platforms, rides along when you scroll, and hides
automatically while the desktop app is showing her (option).

### New MCP tools

`companion_mode`, `walk_to`, `jump`, `teleport`, `look_at`, `set_hand_gesture`, `say`, `lip_sync`, `show_avatar`,
`get_companion_state` — see `hermes/SKILL.md`.
