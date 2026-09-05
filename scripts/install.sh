#!/usr/bin/env bash
set -euo pipefail

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
data_dir="$HOME/.local/share/omarchy-companion"
plugin_dir="$HOME/.config/omarchy/plugins/custom.omarchy-companion"
service_dir="$HOME/.config/systemd/user"
node_bin=$(command -v node)

if [[ -z "$node_bin" ]]; then
  echo "Node.js 20 or newer is required." >&2
  exit 1
fi

# Stop service if running so binaries aren't busy during copy
systemctl --user stop omarchy-companion.service 2>/dev/null || true
pkill -f "uinput-helper" 2>/dev/null || true

mkdir -p "$data_dir" "$plugin_dir" "$service_dir"
cp -R "$source_dir/server" "$source_dir/web" "$data_dir/"
cp "$source_dir/panel/manifest.json" "$source_dir/panel/Panel.qml" "$plugin_dir/"

# Compile virtual mouse uinput helper
if command -v gcc >/dev/null 2>&1; then
  gcc -O2 "$data_dir/server/uinput-helper.c" -o "$data_dir/server/uinput-helper" 2>/dev/null || true
  chmod 755 "$data_dir/server/uinput-helper" 2>/dev/null || true
fi

# Install and configure systemd user service
sed "s|@NODE@|$node_bin|" "$source_dir/systemd/omarchy-companion.service.in" > "$service_dir/omarchy-companion.service"
printf '#!/usr/bin/env bash\nexec %q %q "$@"\n' "$node_bin" "$data_dir/server/companion.mjs" > "$data_dir/companion"
chmod 755 "$data_dir/companion" "$data_dir/server/companion.mjs"

systemctl --user daemon-reload
systemctl --user enable omarchy-companion.service
systemctl --user restart omarchy-companion.service

# Validate and reload Omarchy plugin
omarchy plugin validate "$plugin_dir"
omarchy plugin enable custom.omarchy-companion 2>/dev/null || true
OMARCHY_PATH=/usr/share/omarchy omarchy-shell shell rescanPlugins 2>/dev/null || true
/usr/share/omarchy/bin/omarchy-restart-shell 2>/dev/null || true

tailscale_ip=$(tailscale ip -4 2>/dev/null || echo "")
local_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo "=== Omarchy Companion Installed & Running ==="
if [[ -n "$tailscale_ip" ]]; then
  echo "Tailscale Phone URL: http://${tailscale_ip}:8787"
fi
echo "Local LAN URL:       http://${local_ip}:8787"
echo "Click the Companion phone icon in the Omarchy bar to view URLs and server controls."
