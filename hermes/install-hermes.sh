#!/usr/bin/env bash
set -euo pipefail

# Deploy clean Avatar Assistant runtime & Hermes skill inside the Hermes VM (/home/hermes)
TARGET_DIR="${1:-$HOME/avatar-assistant}"
HERMES_SKILL_DIR="$HOME/.hermes/skills/avatar-assistant"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Installing Avatar Assistant into: $TARGET_DIR"
mkdir -p "$TARGET_DIR" "$HERMES_SKILL_DIR"

cp -r "$SCRIPT_DIR/dist" "$TARGET_DIR/"
cp "$SCRIPT_DIR/package.json" "$TARGET_DIR/"
cp "$SCRIPT_DIR/hermes/SKILL.md" "$HERMES_SKILL_DIR/SKILL.md"

cd "$TARGET_DIR"
# Install only JS runtime dependencies (skip native robotjs/electron builds on headless VM)
npm install --omit=dev --ignore-scripts

echo ""
echo "✅ Installed!"
echo "   Runtime: $TARGET_DIR/dist/mcp-server.js"
echo "   Skill:   $HERMES_SKILL_DIR/SKILL.md"
echo ""
echo "Add this to ~/.hermes/config.yaml under mcp_servers:"
echo "----------------------------------------"
cat <<YAML
mcp_servers:
  avatar-assistant:
    command: "node"
    args:
      - "$TARGET_DIR/dist/mcp-server.js"
    env:
      AVATAR_HTTP_PORT: "3000"
      AVATAR_WS_PORT: "8080"
YAML
echo "----------------------------------------"
echo "Then restart Hermes and open http://<VM_IP>:3000 in your browser!"
echo ""
echo "Desktop app (Mac/PC): set \"wsUrl\": \"ws://<VM_IP>:8080\" in ~/.plaiassist/config.json"
echo "Browser extension: open its popup and set the server to ws://<VM_IP>:8080"
