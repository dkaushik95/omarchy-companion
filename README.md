# Omarchy Companion

Omarchy Companion is a phone companion Progressive Web App (PWA) built specifically for your Omarchy Hyprland desktop. It lets you monitor and control your desktop from your phone over your private Tailscale network or local Wi-Fi.

## Key Features

1. **Auto-Starting Server & Tailscale Integration**
   - Starts automatically on desktop login via systemd user service (`omarchy-companion.service`).
   - Binds to `0.0.0.0:8787` so it is immediately accessible from your Tailscale devices (e.g. `http://100.108.19.14:8787`).
   - Desktop bar widget displays the Tailscale URL, local LAN URL, server status (Running / Stopped), connected phone status, and options to Restart, Stop, or Start the server.

2. **Workspaces & Visual Desktop Canvas**
   - **Workspace Tabs**: Switch between workspaces (Workspace 1, 2, 3...) with a tap.
   - **Visual Canvas**: Renders proportional window rectangles with authentic app icons, titles, and focused window indicators matching your exact Hyprland monitor layout.
   - **Drag to Rearrange**: Touch-and-drag windows directly on the canvas to swap their positions or move them left, right, up, or down.
   - **Window Actions**: Tap any window rectangle to view its action sheet:
     - Focus Window
     - Full Screen / Exit Full Screen
     - Close App

3. **Center Tab: Omarchy Primary Action Button (`Super + Space`)**
   - Prominent center action button featuring the official Omarchy logo.
   - Tap to open a full launcher modal replicating the desktop's `Super + Space` experience.
   - Instant search across all desktop apps, package installers (Arch, AUR, Web Apps, Themes), package uninstall, and system power commands (Shutdown, Reboot, Suspend, Lock, Logout).
   - Launching an app immediately updates Hyprland and displays the new window on your phone canvas.

4. **Interactions Tab (Mouse & Keyboard)**
   - **Trackpad Surface**: Smooth cursor movement with acceleration. Single tap = left click; double tap = open/double click; right edge = vertical scrolling.
   - **Mouse Buttons**: Dedicated Left Click, Middle Click, and Right Click buttons.
   - **iOS Missing Keys**: Quick buttons for keys not found on mobile keyboards: `Esc`, `Tab`, `Super` (Windows key), `Alt+Tab`, `Ctrl+C`, `Ctrl+V`, `Ctrl+Z`, `Enter`, `Backspace`, and Arrow keys.
   - **Send Text to PC**: Type text on your phone and send it directly to the active cursor on the PC using `wtype`.

5. **Controls Tab (PC Audio, Quick Tools & Power)**
   - Unified single-view controls without clutter or section headings.
   - **Audio & Master Volume**: Interactive volume slider with percentage badge, mute toggle (`󰕾`/`󰝟`), and quick step buttons (`-10%`, `-5%`, `25%`, `50%`, `75%`, `+5%`, `+10%`).
   - **Quick Tools**: Stay Awake toggle (`󰅶`), Night Light toggle (`󰔎`), and Do Not Disturb / Silence Notifications (`󰂛`).
   - **System & Power**: Lock PC, Sleep/Suspend, Reboot (with confirmation), and Shut Down (with confirmation).

## Installation & Setup

```bash
./scripts/install.sh
```

The install script:
- Copies server and web assets to `~/.local/share/omarchy-companion`.
- Compiles the low-latency virtual mouse helper (`uinput-helper`).
- Installs and enables the systemd user service `omarchy-companion.service`.
- Installs and enables the Omarchy Quickshell bar widget `custom.omarchy-companion`.

The repo root is itself a valid Omarchy plugin, so the bar widget can also be
installed directly with the standard plugin tooling:

```bash
omarchy plugin add <this-repo-git-url> --enable
```

## Connecting from your Phone

1. Click the phone icon in the right side of the Omarchy top bar.
2. Point your phone camera at the on-screen **QR Code** to open the companion immediately, or copy the Tailscale URL.
3. Open this address in Safari on iOS or Chrome on Android while connected to Tailscale.
4. Choose **Add to Home Screen** from your browser menu to install the PWA for full-screen use.

## Desktop Top Bar Panel Features

Clicking the phone icon on the Omarchy desktop bar reveals a 3-tab management center:
- **Connect Tab**:
  - **Live QR Code**: High-contrast QR code generated via `qrencode` for instant camera pairing.
  - **One-Click URL Copy**: Dedicated copy buttons for Tailscale and Local LAN URLs with visual feedback (`Copied!`).
- **Service Tab**:
  - **Auto-Start on Boot**: Live status badge (`Enabled` / `Disabled`) and click-to-toggle systemd user service enablement.
  - **Server Controls**: `Restart Server`, `Stop Server` / `Start Server`, and `Open Companion in Browser`.
  - **Client Diagnostics**: Active connected phone count and real-time status.
- **Logs Tab**:
  - Embedded service log viewer displaying recent journalctl events and status refresh.

## Uninstall

```bash
./scripts/uninstall.sh
```
