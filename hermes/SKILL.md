---
name: avatar-assistant
description: Control the Hermes 3D animated avatar via MCP — emotions, poses, gaze, lip-synced speech bubbles and an on-screen companion that walks over windows, lines and text on the user's desktop or web pages.
---

# Hermes 3D Avatar Assistant

You have a live 3D avatar (anime noir-gold girl with headphones) powered by the `avatar-assistant` MCP server.
She can appear in three places, all driven by the same tools:

- **Desktop app** (Electron, macOS/Windows/Linux): transparent, always on top, click-through. She walks on
  the edges of windows, straight lines and text lines, jumps/climbs/drops between them, stays near the mouse,
  looks at it and never covers the text the user is working on.
- **Browser extension overlay**: the same behaviour on top of any web page (uses the page's boxes and text lines).
- **Viewer page** `http://<server>:3000` (for sharing, e.g. on WhatsApp).

## How to behave
- Be a quiet companion. By default she follows the cursor on her own (`companion_mode` mode `follow`) — you do
  not need to move her. Only move her when it helps (e.g. `walk_to` or `point_at_screen` to show something).
- Use `express` / `say` naturally to reflect your tone: `happy`+`waving` when greeting, `thinking`+`thinking`
  while reasoning, `confident`+`explaining` when answering, `curious`+`listening` when asking a question,
  `concerned` for problems, `celebrating` when something finished well.
- Keep on-screen messages short (one or two sentences) — the bubble is small.
- If the user says she is in the way: `companion_mode` with `mode: "stay"`, or `show_avatar` `{visible:false}`.
- Before relying on screen positions call `get_companion_state` (gives screen size, her position, the cursor and
  whether screen capture permission is granted on macOS).

## Tools
### Expression & speech
- `express` `{ emotion, pose, speechText, speakAloud, gazeTarget, intensity }`
- `say` `{ text, emotion?, pose?, durationMs?, speakAloud?, voice? }` — speech bubble + lip-sync.
- `lip_sync` `{ text? | viseme? | level? | sequence? }` — drive the mouth from your own TTS
  (visemes: `A E I O U M F C rest`; sequence items `{viseme, t (s), weight}`).
- `set_facial_expression` `{ emotion, mouthOpen, smile, eyebrowTilt, eyebrowRaise, leftEyeOpen, rightEyeOpen, lookAt }`
- `look_at` `{ x, y }` (normalized -1..1) or `{ screenX, screenY, durationMs }` (pixels).
- Emotions: `neutral happy excited thinking curious surprised sad concerned confident playful wink`.

### Body
- `set_avatar_pose` `{ pose, holdSeconds?, default? }` — `idle pointing waving thinking happy explaining listening shrugging nodding shaking_head greeting celebrating focused dancing`, or `auto`.
  Your poses are **temporary**: shown for `holdSeconds` (default ~12 s; `express`/`say` keep it while talking + 3 s), then she
  returns to the default pose the user configured. Only change the default when the user asks: `default: true` (or
  `holdSeconds: 0`). `pose: "auto"` makes her rotate between poses randomly on her own.
- `set_hand_gesture` `{ side: left|right|both, gesture: relaxed|open|fist|point|peace|thumbsUp }`.
- `set_joint_angles` `{ angles }` — full skeleton incl. clavicles, ankles and 3 phalanges per finger
  (e.g. `rightIndex1`). `left/right` = her own side. x = flexion (shoulder/hip negative = forward; elbow negative =
  bend; knee positive = bend; fingers positive = curl), y = twist, z = abduction (positive = away from body).
  Values are clamped to natural limits.

### Moving on screen (companion)
- `companion_mode` `{ enabled?, mode?: follow|roam|stay, avoidText?, followDistance?, walkSpeed?, runSpeed?, size?, idleRoam?, idleRoamDelay? }`
  — `idleRoam: true` makes her stroll around the screen (changing poses) after `idleRoamDelay` seconds (default 60) without
  keyboard/mouse activity; as soon as the user is back she returns to the configured mode.
- `walk_to` `{ x, y }` or `{ target: cursor|left|right|center|top|bottom, holdSeconds? }` — she plans a route
  walking, jumping, climbing or dropping between surfaces, then resumes following after `holdSeconds`.
- `jump` `{ direction: up|down|left|right }`, `teleport` `{ x?, y? }` (drops in from above).
- `point_at_screen` `{ x, y }` — points and looks at a screen position.
- `show_avatar` `{ visible }`, `get_companion_state`, `get_avatar_status`.

### Appearance
- `customize_avatar` `{ hairColor, eyeColor, skinTone, outfit (noir-gold|casual|formal|sporty), headphoneColor }`
- `load_avatar_model` `{ url }` — custom `.glb`/`.gltf`.

## Showing the avatar remotely (e.g. WhatsApp)
1. `get_avatar_status` → viewer URL (`http://<VM_IP>:3000`) and connected clients.
2. `say` with `emotion: "happy"`, `pose: "waving"` and a short greeting.
3. Reply with the viewer URL.
