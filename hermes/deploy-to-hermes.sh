#!/usr/bin/env bash
# Copies the PLAssist source code from this computer (Mac) to the Hermes VM and builds/installs it there.
#
#   bash hermes/deploy-to-hermes.sh hermes@192.168.50.X            # user@host of the Hermes VM (SSH)
#   AVATAR_TOKEN=um-segredo bash hermes/deploy-to-hermes.sh hermes@192.168.50.X
#
# Needs SSH access to the VM (ideally with a key: ssh-copy-id hermes@192.168.50.X) and rsync.
set -euo pipefail

DEST="${1:-${HERMES_SSH:-}}"
[ -n "$DEST" ] || { echo "uso: bash hermes/deploy-to-hermes.sh utilizador@ip-da-vm"; exit 1; }
REMOTE_SRC="${REMOTE_SRC:-plaiassist-src}"          # relative to the remote home folder
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

EXCLUDES=(node_modules dist build '.backup-*' .git .DS_Store '*.log' package-lock.json)

echo "==> A copiar o código para $DEST:~/$REMOTE_SRC"
if command -v rsync >/dev/null 2>&1 && ssh "$DEST" 'command -v rsync >/dev/null 2>&1'; then
  rsync -az --delete "${EXCLUDES[@]/#/--exclude=}" "$SRC_DIR/" "$DEST:$REMOTE_SRC/"
else
  # no rsync on the VM: stream a tar archive over SSH (keeps the remote node_modules as a cache)
  echo "   (rsync não disponível na VM — a usar tar por SSH)"
  COPYFILE_DISABLE=1 tar -C "$SRC_DIR" "${EXCLUDES[@]/#/--exclude=}" -czf - . |
    ssh "$DEST" "mkdir -p ~/$REMOTE_SRC && cd ~/$REMOTE_SRC && \
      find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + && \
      tar --warning=no-unknown-keyword -xzf -"
fi

echo "==> A compilar e instalar na VM"
ssh -t "$DEST" "cd ~/$REMOTE_SRC && AVATAR_TOKEN='${AVATAR_TOKEN:-}' bash hermes/install-hermes.sh"

echo
echo "Feito. Se foi a primeira instalação, junta o bloco mcp_servers mostrado acima ao ~/.hermes/config.yaml;"
echo "em atualizações basta reiniciar o Hermes para carregar a nova versão."
