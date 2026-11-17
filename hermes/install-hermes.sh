#!/usr/bin/env bash
# Builds and installs the PLAssist avatar server + Hermes skill inside the Hermes VM.
#
# Run it from a copy of the source code on the VM (see hermes/deploy-to-hermes.sh, which copies the code from the
# Mac and runs this script over SSH):
#
#   bash hermes/install-hermes.sh [TARGET_DIR]          # default TARGET_DIR: ~/avatar-assistant
#
# Environment (optional):
#   AVATAR_TOKEN=...   also print the token line in the Hermes config snippet
#   SKIP_BUILD=1       reuse an existing dist/ (e.g. built on the Mac)
set -euo pipefail

TARGET_DIR="${1:-$HOME/avatar-assistant}"
HERMES_SKILL_DIR="$HOME/.hermes/skills/avatar-assistant"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

# --- 1. Node.js ≥ 18 ------------------------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js não encontrado. Instala o Node 20 LTS, p.ex.:
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node $(node -v) é antigo demais; é preciso o 18 ou superior (recomendado 20 LTS)."
say "Node $(node -v), npm $(npm -v)"

# --- 2. Build (only the server + web viewer; no Electron, no native modules) ----------------------
cd "$SRC_DIR"
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  say "A instalar dependências de build (sem descarregar o Electron nem compilar módulos nativos)"
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1
  npm install --no-audit --no-fund --ignore-scripts
  say "A compilar o servidor MCP e o viewer web"
  npm run build:vm
fi
[ -f "$SRC_DIR/dist/mcp-server.js" ] && [ -f "$SRC_DIR/dist/avatar/index.html" ] || die "dist/ incompleto — o build falhou?"

# --- 3. Runtime install -----------------------------------------------------------------------------
say "A instalar em $TARGET_DIR"
mkdir -p "$TARGET_DIR" "$HERMES_SKILL_DIR"
rm -rf "$TARGET_DIR/dist"
mkdir -p "$TARGET_DIR/dist"
cp "$SRC_DIR/dist/mcp-server.js" "$TARGET_DIR/dist/"
cp -r "$SRC_DIR/dist/avatar" "$TARGET_DIR/dist/"
cp "$SRC_DIR/package.json" "$TARGET_DIR/"
cp "$SRC_DIR/hermes/SKILL.md" "$HERMES_SKILL_DIR/SKILL.md"
(cd "$TARGET_DIR" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --omit=dev --ignore-scripts --no-audit --no-fund)

# --- 4. Smoke test: start it on spare ports for a moment --------------------------------------------
say "Teste rápido do servidor"
LOG="$(mktemp)"
AVATAR_HTTP_PORT=3999 AVATAR_WS_PORT=8999 node "$TARGET_DIR/dist/mcp-server.js" </dev/null >"$LOG" 2>&1 &
TEST_PID=$!
OK=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.5
  if curl -fsS --noproxy '*' http://127.0.0.1:3999/health >/dev/null 2>&1; then OK=1; break; fi
done
kill "$TEST_PID" 2>/dev/null || true
wait "$TEST_PID" 2>/dev/null || true
if [ "$OK" = 1 ]; then
  echo "   OK: o servidor arranca e responde (/health)."
else
  echo "   Aviso: o teste não respondeu. Log:"; sed 's/^/   /' "$LOG"
fi
rm -f "$LOG"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; IP="${IP:-<IP_DA_VM>}"

cat <<EOF

✅ Instalado
   Servidor: $TARGET_DIR/dist/mcp-server.js
   Skill:    $HERMES_SKILL_DIR/SKILL.md

1) Acrescenta ao ~/.hermes/config.yaml (secção mcp_servers) e reinicia o Hermes:
----------------------------------------
mcp_servers:
  avatar-assistant:
    command: "node"
    args:
      - "$TARGET_DIR/dist/mcp-server.js"
    env:
      AVATAR_HTTP_PORT: "3000"
      AVATAR_WS_PORT: "8080"
EOF
if [ -n "${AVATAR_TOKEN:-}" ]; then
  echo "      AVATAR_TOKEN: \"$AVATAR_TOKEN\""
else
  echo "      # AVATAR_TOKEN: \"um-segredo\"   # recomendado se publicares o avatar fora da rede local"
fi
cat <<EOF
----------------------------------------
2) Se a VM tiver firewall:  sudo ufw allow 3000/tcp && sudo ufw allow 8080/tcp
3) Verifica (com o Hermes a correr):  curl http://$IP:3000/health
4) Mac:  Settings → Advanced → Ligação ao Hermes → $IP  → Testar ligação → Save
   Extensão do browser: popup → servidor ws://$IP:8080
   Home Assistant: cartão Webpage com http://$IP:3000/?embed=1   (ver INSTALL.md)
EOF
