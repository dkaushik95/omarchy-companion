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

5. **Controls Tab (Desktop Panels)**
   - Displays all Omarchy desktop panels (Audio, Bluetooth, Network, Display, Power, Weather, Clock, System Update, Tailscale, AI Agents, HomeKit, etc.).
   - Tap any panel card to summon/toggle it directly on your desktop screen via Quickshell IPC.
   - Quick toggles for Night Light, Touchpad, and Silence Notifications.

## Installation & Setup

```bash
./scripts/install.sh
```

The install script:
- Copies server and web assets to `~/.local/share/omarchy-companion`.
- Compiles the low-latency virtual mouse helper (`uinput-helper`).
- Installs and enables the systemd user service `omarchy-companion.service`.
- Installs and enables the Omarchy Quickshell bar widget `custom.omarchy-companion`.

## Connecting from your Phone

1. Click the phone icon in the right side of the Omarchy top bar.
2. Note the displayed Tailscale URL (e.g. `http://100.108.19.14:8787`).
3. Open this address in Safari on iOS or Chrome on Android while connected to Tailscale.
4. Choose **Add to Home Screen** from your browser menu to install the PWA for full-screen use.

## Desktop Panel Features

Clicking the phone icon on the Omarchy panel reveals:
- **Server Status**: Green badge when running, red badge when stopped.
- **Client Status**: Shows whether a phone is currently connected.
- **Tailscale URL**: Clickable / quick reference for opening on phone.
- **Server Controls**:
  - `Restart Server`
  - `Close Server` / `Start Server`
  - `Open Companion in Browser`
  - `Refresh Status`

## Uninstall

```bash
./scripts/uninstall.sh
```
