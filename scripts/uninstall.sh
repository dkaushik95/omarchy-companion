#!/usr/bin/env bash
set -euo pipefail

systemctl --user disable --now omarchy-companion.service || true
rm -f "$HOME/.config/systemd/user/omarchy-companion.service"
omarchy plugin disable custom.omarchy-companion || true
rm -rf "$HOME/.config/omarchy/plugins/custom.omarchy-companion"
systemctl --user daemon-reload
echo "The app data remains in ~/.local/share/omarchy-companion so paired phones can be revoked or preserved. Remove it manually if you want a full erase."
