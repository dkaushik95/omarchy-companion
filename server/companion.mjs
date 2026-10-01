#!/usr/bin/env node
import { createHash, randomBytes, randomInt } from "node:crypto";
import { createReadStream, existsSync, watch } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, networkInterfaces } from "node:os";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, "..");
const webDir = join(rootDir, "web");
const dataDir = process.env.OMARCHY_COMPANION_DATA_DIR || join(homedir(), ".local", "share", "omarchy-companion");
const stateFile = join(dataDir, "state.json");
const port = Number(process.env.OMARCHY_COMPANION_PORT || 8787);
const host = process.env.OMARCHY_COMPANION_HOST || "0.0.0.0";
const version = "0.2.0";

const defaultMenuPath = "/usr/share/omarchy/default/omarchy/omarchy-menu.jsonc";
const userMenuPath = join(homedir(), ".config/omarchy/extensions/omarchy-menu.jsonc");
const omarchyIconPath = "/usr/share/omarchy/icon.png";
const omarchyLogoSvgPath = "/usr/share/omarchy/logo.svg";
const omarchyLogoPath = "/usr/share/pixmaps/omarchy.png";

const appDirs = [
  "/var/lib/flatpak/exports/share/applications",
  "/usr/share/applications",
  "/usr/local/share/applications",
  join(homedir(), ".local/share/applications"),
  join(homedir(), ".local/share/flatpak/exports/share/applications")
];

const appCache = { at: 0, apps: [] };
const appCacheTtlMs = 30 * 1000;

// SSE connected clients
const sseClients = new Set();
let lastClientActivityTime = 0;

// Virtual mouse daemon child process
let uinputProcess = null;
let uinputReady = false;

function initUinput() {
  const helperBin = join(here, "uinput-helper");
  if (!existsSync(helperBin)) {
    try {
      execSync(`gcc -O2 ${join(here, "uinput-helper.c")} -o ${helperBin}`, { stdio: "ignore" });
    } catch {
      // ignore build failure, fallback will be used
    }
  }
  if (existsSync(helperBin)) {
    try {
      uinputProcess = spawn(helperBin, [], { stdio: ["pipe", "pipe", "ignore"] });
      uinputProcess.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("READY")) {
          uinputReady = true;
        }
      });
      uinputProcess.on("close", () => {
        uinputReady = false;
        uinputProcess = null;
      });
    } catch {
      uinputProcess = null;
    }
  }
}

function sendUinput(command) {
  if (uinputProcess && uinputProcess.stdin && !uinputProcess.killed) {
    try {
      uinputProcess.stdin.write(command + "\n");
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function cleanText(value, max = 300) {
  return String(value ?? "").replace(/[\u0000-\r]/g, "").trim().slice(0, max);
}

function now() { return Date.now(); }

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*"
  });
  res.end(JSON.stringify(body));
}

function fail(res, status, message) {
  json(res, status, { ok: false, error: message });
}

let cachedSessionEnv = null;
let lastSessionEnvCheck = 0;
let sessionEnvPromise = null;

async function fetchSessionEnvironment() {
  const env = { ...process.env };

  try {
    const res = await new Promise((done) => {
      let out = "";
      const c = spawn("systemctl", ["--user", "show-environment"], { shell: false, env: process.env });
      c.stdout.on("data", (d) => { out += d; });
      c.on("error", () => done(null));
      c.on("close", (code) => done(code === 0 ? out : null));
    });

    if (res) {
      for (const line of res.split("\n")) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          let val = match[2];
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val.startsWith("$'") && val.endsWith("'")) val = val.slice(2, -1);
          env[match[1]] = val;
        }
      }
    }
  } catch {}

  const runtime = env.XDG_RUNTIME_DIR || process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  env.XDG_RUNTIME_DIR = runtime;

  if (!env.HYPRLAND_INSTANCE_SIGNATURE) {
    try {
      const entries = await readdir(join(runtime, "hypr"), { withFileTypes: true });
      const instance = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().at(-1);
      if (instance) env.HYPRLAND_INSTANCE_SIGNATURE = instance;
    } catch {}
  }

  if (!env.WAYLAND_DISPLAY) {
    try {
      const entries = await readdir(runtime);
      const waylandSocket = entries.find((e) => /^wayland-\d+$/.test(e));
      if (waylandSocket) env.WAYLAND_DISPLAY = waylandSocket;
    } catch {}
  }

  if (!env.DISPLAY) {
    env.DISPLAY = ":0";
  }

  if (!env.XDG_CURRENT_DESKTOP) {
    env.XDG_CURRENT_DESKTOP = "Hyprland";
  }

  const home = env.HOME || process.env.HOME || homedir();
  const currentPath = env.PATH || process.env.PATH || "/usr/local/bin:/usr/bin";
  const standardPaths = [
    join(home, ".local", "bin"),
    "/usr/share/omarchy/bin",
    join(home, ".local", "share", "mise", "shims"),
    "/usr/local/bin",
    "/usr/bin"
  ];
  const mergedPath = Array.from(new Set([...standardPaths, ...currentPath.split(":")])).join(":");
  env.PATH = mergedPath;

  cachedSessionEnv = env;
  lastSessionEnvCheck = Date.now();
  return env;
}

async function getSessionEnvironment() {
  const nowMs = Date.now();
  if (cachedSessionEnv && (nowMs - lastSessionEnvCheck < 3000)) {
    return cachedSessionEnv;
  }
  if (!sessionEnvPromise) {
    sessionEnvPromise = fetchSessionEnvironment().finally(() => {
      sessionEnvPromise = null;
    });
  }
  return sessionEnvPromise;
}

async function hyprEnvironment() {
  return getSessionEnvironment();
}

async function run(command, args = [], timeout = 15000, options = {}) {
  const sessionEnv = options.noSessionEnv ? {} : await getSessionEnvironment();
  const env = { ...process.env, ...sessionEnv, ...(options.env || {}) };
  return new Promise((done) => {
    let stdout = "", stderr = "", killed = false;
    const child = spawn(command, args.map(String), { shell: false, env });
    if (options.input !== undefined) child.stdin.end(String(options.input));
    const timer = setTimeout(() => { killed = true; child.kill("SIGTERM"); }, timeout);
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-16000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16000); });
    child.on("error", (error) => { clearTimeout(timer); done({ ok: false, code: -1, stdout, stderr: error.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0 && !killed, code: code ?? -1, stdout: stdout.trim(), stderr: (killed ? "Timed out. " : "") + stderr.trim() });
    });
  });
}

async function getTailscaleIp() {
  const res = await run("tailscale", ["ip", "-4"], 2000);
  if (res.ok && res.stdout) {
    const ip = res.stdout.split("\n")[0].trim();
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return ip;
  }
  const nets = networkInterfaces();
  for (const [name, ifaces] of Object.entries(nets)) {
    if (name.toLowerCase().includes("tailscale") || name.startsWith("ts")) {
      const match = ifaces?.find(i => i.family === "IPv4" && !i.internal);
      if (match) return match.address;
    }
  }
  for (const ifaces of Object.values(nets)) {
    const match = ifaces?.find(i => i.family === "IPv4" && !i.internal && i.address.startsWith("100."));
    if (match) return match.address;
  }
  return null;
}

function getLocalIps() {
  const nets = networkInterfaces();
  const ips = [];
  for (const [name, ifaces] of Object.entries(nets)) {
    if (name.toLowerCase().includes("tailscale") || name.startsWith("ts")) continue;
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

async function getNetworkInfo() {
  const tailscaleIp = await getTailscaleIp();
  const localIps = getLocalIps();
  const localIp = localIps[0] || "127.0.0.1";
  const tailscaleUrl = tailscaleIp ? `http://${tailscaleIp}:${port}` : null;
  const localUrl = `http://${localIp}:${port}`;
  return {
    tailscaleIp,
    tailscaleUrl,
    localIp,
    localUrl,
    primaryUrl: tailscaleUrl || localUrl,
    addresses: [...(tailscaleIp ? [tailscaleIp] : []), ...localIps]
  };
}

function activeClientCount() {
  const sseCount = sseClients.size;
  const isRecent = (now() - lastClientActivityTime) < 20000;
  return sseCount > 0 ? sseCount : (isRecent ? 1 : 0);
}

async function hypr(args, timeout = 15000) {
  return run("hyprctl", args, timeout);
}

async function hyprJson(args) {
  const result = await hypr(["-j", ...args]);
  try {
    return { result, value: JSON.parse(result.stdout) };
  } catch {
    return { result, value: null };
  }
}

const luaStr = (value) => '"' + String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

function luaFindWindow(addressExpr, windowVar) {
  return `
local ${windowVar} = nil
for _, __w in ipairs(hl.get_windows()) do
  if __w.address == ${addressExpr} then
    ${windowVar} = __w
    break
  end
end
if not ${windowVar} then
  error("Window with address " .. tostring(${addressExpr}) .. " not found.")
end
`;
}

async function hyprDispatch(lua, timeout = 15000) {
  const res = await run("hyprctl", ["eval", lua], timeout);
  if (!res.ok || (res.stderr && res.stderr.includes("error:"))) {
    throw new Error(res.stderr || "Hyprland dispatch error");
  }
  return res;
}

function validAddress(value) {
  return /^0x[0-9a-f]+$/i.test(String(value || ""));
}

function parseColorsToml(content) {
  const colors = {};
  for (const line of (content || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([a-zA-Z0-9_]+)\s*=\s*["']?([^"']+)["']?$/);
    if (match) {
      colors[match[1]] = match[2].trim();
    }
  }
  return colors;
}

let cachedTheme = null;
let lastThemeCheck = 0;

async function getThemeInfo() {
  const nowMs = Date.now();
  if (cachedTheme && (nowMs - lastThemeCheck < 1500)) {
    return cachedTheme;
  }
  lastThemeCheck = nowMs;

  const home = process.env.HOME || homedir();
  const stateThemeDir = join(home, ".local", "state", "omarchy", "current");
  const themeNamePath = join(stateThemeDir, "theme.name");
  const colorsPath = join(stateThemeDir, "theme", "colors.toml");

  let themeName = "unknown";
  try {
    themeName = (await readFile(themeNamePath, "utf8")).trim();
  } catch {}

  let colors = {};
  try {
    const rawColors = await readFile(colorsPath, "utf8");
    colors = parseColorsToml(rawColors);
  } catch {}

  // Fallbacks
  if (!colors.background) colors.background = "#000000";
  if (!colors.foreground) colors.foreground = "#ffffff";
  if (!colors.accent) colors.accent = "#8d8d8d";
  if (!colors.selection) colors.selection = "#1a1a1a";
  if (!colors.muted) colors.muted = "#7a7a7a";

  // Check hyprland rounding
  let rounding = 0;
  try {
    const roundingOpt = await hyprJson(["getoption", "decoration:rounding"]);
    if (typeof roundingOpt?.value?.int === "number") {
      rounding = roundingOpt.value.int;
    }
  } catch {}

  // Check hyprland active border
  let activeBorder = colors.accent;
  try {
    const borderOpt = await hyprJson(["getoption", "general:col.active_border"]);
    if (borderOpt?.value?.gradient) {
      const match = borderOpt.value.gradient.match(/([0-9a-fA-F]{6,8})/);
      if (match) {
        let hex = match[1];
        if (hex.length === 8) hex = hex.slice(2);
        activeBorder = "#" + hex;
      }
    }
  } catch {}

  cachedTheme = {
    name: themeName,
    mode: colors.mode || "dark",
    rounding,
    colors: {
      background: colors.background,
      darkBackground: colors.dark_background || colors.background,
      darkerBackground: colors.darker_background || colors.background,
      lighterBackground: colors.lighter_background || colors.selection || colors.background,
      foreground: colors.foreground,
      darkForeground: colors.dark_foreground || colors.muted,
      lightForeground: colors.light_foreground || colors.foreground,
      brightForeground: colors.bright_foreground || colors.foreground,
      accent: colors.accent,
      selection: colors.selection,
      muted: colors.muted,
      activeBorder,
      red: colors.red || "#ef4444",
      green: colors.green || "#22c55e",
      blue: colors.blue || colors.accent,
      yellow: colors.yellow || "#eab308",
      orange: colors.orange || "#f97316"
    }
  };

  return cachedTheme;
}

function watchThemeChanges() {
  const home = process.env.HOME || homedir();
  const stateThemeDir = join(home, ".local", "state", "omarchy", "current");
  if (!existsSync(stateThemeDir)) return;
  try {
    watch(stateThemeDir, { recursive: true }, () => {
      cachedTheme = null;
      lastThemeCheck = 0;
      forceBroadcast = true;
      broadcastDesktopState();
    });
  } catch {}
}

async function desktopState() {
  const [monitors, workspaces, clients, active, cursor, activeWin, theme] = await Promise.all([
    hyprJson(["monitors"]),
    hyprJson(["workspaces"]),
    hyprJson(["clients"]),
    hyprJson(["activeworkspace"]),
    hyprJson(["cursorpos"]),
    hyprJson(["activewindow"]),
    getThemeInfo()
  ]);

  const monitorList = (monitors.value || []).map((m) => ({
    name: m.name,
    x: m.x,
    y: m.y,
    width: m.width,
    height: m.height,
    scale: m.scale,
    focused: m.focused,
    activeWorkspace: m.activeWorkspace
  }));

  const workspaceList = (workspaces.value || [])
    .filter((w) => w.id > 0)
    .sort((a, b) => a.id - b.id)
    .map((w) => ({
      id: w.id,
      name: w.name,
      windows: w.windows,
      hasfullscreen: w.hasfullscreen,
      monitor: w.monitor
    }));

  const activeWinAddress = activeWin?.value?.address || "";
  const clientList = (clients.value || [])
    .filter((c) => c.mapped !== false)
    .map((c) => ({
      address: c.address,
      title: c.title || c.initialTitle || c.class || "Window",
      class: c.class || "",
      workspace: c.workspace,
      at: c.at || [0, 0],
      size: c.size || [100, 100],
      fullscreen: Boolean(c.fullscreen),
      floating: Boolean(c.floating),
      hidden: Boolean(c.hidden),
      focused: c.address === activeWinAddress
    }));

  return {
    monitors: monitorList,
    workspaces: workspaceList,
    clients: clientList,
    activeWorkspace: active.value || null,
    activeWindow: activeWin?.value || null,
    cursor: cursor.value || null,
    theme
  };
}

let broadcastInFlight = false;
let broadcastPendingUpdate = false;
let lastBroadcastSig = "";
let forceBroadcast = false;

function desktopSignature(monitors, clients, activeWinAddress) {
  return JSON.stringify([
    (monitors || []).map(m => [
      m.name, m.x, m.y, m.width, m.height, m.scale, m.focused ? 1 : 0, m.activeWorkspace?.id || 0
    ]),
    activeWinAddress || "",
    (clients || []).map(c => [
      c.address,
      c.at,
      c.size,
      c.fullscreen ? 1 : 0,
      c.floating ? 1 : 0,
      c.hidden ? 1 : 0,
      c.mapped === false ? 1 : 0,
      c.workspace?.id || 0,
      c.pinned ? 1 : 0
    ])
  ]);
}

async function broadcastDesktopState() {
  if (sseClients.size === 0) return;
  if (broadcastInFlight) {
    broadcastPendingUpdate = true;
    return;
  }
  broadcastInFlight = true;
  try {
    // Cheap change check before building the full state, so clients only get
    // re-rendered when the desktop layout actually changed.
    const [monitors, clients, activeWin] = await Promise.all([
      hyprJson(["monitors"]),
      hyprJson(["clients"]),
      hyprJson(["activewindow"])
    ]);
    const sig = desktopSignature(monitors.value, clients.value, activeWin?.value?.address || "");
    if (!forceBroadcast && sig === lastBroadcastSig) return;
    forceBroadcast = false;
    lastBroadcastSig = sig;

    const state = await desktopState();
    const payload = `data: ${JSON.stringify({ type: "desktop", ...state })}\n\n`;
    for (const client of sseClients) {
      try { client.write(payload); } catch { sseClients.delete(client); }
    }
  } catch {}
  finally {
    broadcastInFlight = false;
    if (broadcastPendingUpdate) {
      broadcastPendingUpdate = false;
      setImmediate(broadcastDesktopState);
    }
  }
}

async function desktopControl(input) {
  const kind = cleanText(input.kind || input.action, 40);
  const address = cleanText(input.address || input.sourceAddress, 30);
  const targetAddress = cleanText(input.targetAddress || input.target, 30);

  if (kind === "workspace") {
    const id = Number(input.workspace || input.id);
    if (!Number.isInteger(id) || id < 1 || id > 99) throw new Error("Invalid workspace.");
    await hyprDispatch(`hl.dispatch(hl.dsp.focus({ workspace = ${id} }))`);
    setTimeout(broadcastDesktopState, 80);
    return { ok: true, workspace: id };
  }

  if (kind === "move-to-workspace" || kind === "movetoworkspace") {
    if (!validAddress(address)) throw new Error("Invalid window reference.");
    const wsId = Number(input.workspace || input.workspaceId || input.targetWorkspace);
    if (!Number.isInteger(wsId) || wsId < 1 || wsId > 99) throw new Error("Invalid workspace.");
    await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
hl.dispatch(hl.dsp.window.move({ workspace = ${wsId}, window = winA }))
`);
    setTimeout(broadcastDesktopState, 80);
    return { ok: true, workspace: wsId };
  }

  if (["focus", "close", "fullscreen", "tile", "float", "toggle-floating"].includes(kind) && !validAddress(address)) {
    throw new Error("Invalid window reference.");
  }

  if (kind === "focus") {
    const state = await desktopState();
    const targetWin = state.clients.find(c => c.address === address);
    if (targetWin?.workspace?.id && targetWin.workspace.id !== state.activeWorkspace?.id) {
      await hyprDispatch(`hl.dispatch(hl.dsp.focus({ workspace = ${targetWin.workspace.id} }))`);
    }
    await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
hl.dispatch(hl.dsp.focus({ window = winA }))
hl.dispatch(hl.dsp.window.bring_to_top())
`);
    if (targetWin?.at && targetWin?.size) {
      const cx = Math.round(targetWin.at[0] + targetWin.size[0] / 2);
      const cy = Math.round(targetWin.at[1] + targetWin.size[1] / 2);
      await hyprDispatch(`hl.dispatch(hl.dsp.cursor.move({ x = ${cx}, y = ${cy} }))`);
    }
    setTimeout(broadcastDesktopState, 50);
    return { ok: true };
  }

  if (kind === "tile") {
    await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
hl.dispatch(hl.dsp.focus({ window = winA }))
hl.dispatch(hl.dsp.window.float({ action = "unset", window = winA }))
`);
    setTimeout(broadcastDesktopState, 80);
    return { ok: true };
  }

  if (kind === "float" || kind === "toggle-floating") {
    const action = kind === "float" ? "set" : "toggle";
    await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
hl.dispatch(hl.dsp.focus({ window = winA }))
hl.dispatch(hl.dsp.window.float({ action = "${action}", window = winA }))
`);
    setTimeout(broadcastDesktopState, 80);
    return { ok: true };
  }

  if (kind === "close") {
    await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
hl.dispatch(hl.dsp.window.close({ window = winA }))
`);
    setTimeout(broadcastDesktopState, 150);
    return { ok: true };
  }

  if (kind === "togglesplit" || kind === "toggle-split") {
    if (address && validAddress(address)) {
      await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
hl.dispatch(hl.dsp.focus({ window = winA }))
hl.dispatch(hl.dsp.layout("togglesplit"))
`);
    } else {
      await hyprDispatch(`hl.dispatch(hl.dsp.layout("togglesplit"))`);
    }
    setTimeout(broadcastDesktopState, 80);
    return { ok: true };
  }

  if (kind === "fullscreen") {
    await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
hl.dispatch(hl.dsp.focus({ window = winA }))
hl.dispatch(hl.dsp.window.fullscreen())
`);
    setTimeout(broadcastDesktopState, 50);
    return { ok: true };
  }

  if (kind === "swap") {
    if (!validAddress(address) || !validAddress(targetAddress)) throw new Error("Invalid window addresses for swap.");
    await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
${luaFindWindow(luaStr(targetAddress), "winB")}
hl.dispatch(hl.dsp.window.swap({ window = winA, target = winB }))
`);
    setTimeout(broadcastDesktopState, 80);
    return { ok: true };
  }

  if (kind === "split" || kind === "move") {
    if (!validAddress(address)) throw new Error("Invalid window address.");
    const dir = cleanText(input.direction, 5) || "r";
    const dirMap = { r: "r", l: "l", u: "u", d: "d", right: "r", left: "l", up: "u", down: "d" };
    const cleanDir = dirMap[dir] || "r";

    if (targetAddress && validAddress(targetAddress) && targetAddress !== address) {
      // Directed split relative to target window
      await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
${luaFindWindow(luaStr(targetAddress), "winB")}
if winA.floating then hl.dispatch(hl.dsp.window.float({ action = "unset", window = winA })) end
if winB.floating then hl.dispatch(hl.dsp.window.float({ action = "unset", window = winB })) end
hl.dispatch(hl.dsp.focus({ window = winA }))
hl.dispatch(hl.dsp.window.move({ direction = "${cleanDir}" }))
local isHoriz = math.abs(winA.at.y - winB.at.y) < math.abs(winA.at.x - winB.at.x)
if ("${cleanDir}" == "r" or "${cleanDir}" == "l") and not isHoriz then
  hl.dispatch(hl.dsp.layout("togglesplit"))
elseif ("${cleanDir}" == "u" or "${cleanDir}" == "d") and isHoriz then
  hl.dispatch(hl.dsp.layout("togglesplit"))
end
`);
    } else {
      await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
if winA.floating then hl.dispatch(hl.dsp.window.float({ action = "unset", window = winA })) end
hl.dispatch(hl.dsp.focus({ window = winA }))
hl.dispatch(hl.dsp.window.move({ direction = "${cleanDir}" }))
`);
    }

    setTimeout(broadcastDesktopState, 80);
    return { ok: true };
  }

  if (kind === "drop") {
    if (!validAddress(address)) throw new Error("Invalid window address.");
    const workspace = Number(input.workspace);
    const state = await desktopState();
    const target = state.monitors.find((m) => m.activeWorkspace?.id === workspace) || state.monitors[0];
    if (!target) throw new Error("No monitor available.");
    const monScale = target.scale || 1.6;
    const monLogicalW = target.width / monScale;
    const monLogicalH = target.height / monScale;
    const relativeX = Math.max(0, Math.min(1, Number(input.x) || 0));
    const relativeY = Math.max(0, Math.min(1, Number(input.y) || 0));
    const finalX = Math.round(target.x + relativeX * monLogicalW);
    const finalY = Math.round(target.y + relativeY * monLogicalH);
    await hyprDispatch(`
${luaFindWindow(luaStr(address), "winA")}
hl.dispatch(hl.dsp.window.float({ action = "set", window = winA }))
hl.dispatch(hl.dsp.window.move({ x = ${finalX}, y = ${finalY}, relative = false, window = winA }))
`);
    setTimeout(broadcastDesktopState, 100);
    return { ok: true };
  }

  throw new Error("Unknown desktop action: " + kind);
}

async function inputControl(input) {
  const kind = cleanText(input.kind, 20);

  if (kind === "move") {
    const dx = Math.round(Number(input.dx) || 0);
    const dy = Math.round(Number(input.dy) || 0);
    if (uinputReady && sendUinput(`move ${dx} ${dy}`)) {
      return { ok: true };
    }
    // Fallback: use hyprctl cursor pos + move
    const state = await desktopState();
    const monitor = state.monitors.find((m) => m.focused) || state.monitors[0];
    if (!monitor) throw new Error("No monitor available.");
    const cursor = state.cursor || { x: monitor.x + monitor.width / 2, y: monitor.y + monitor.height / 2 };
    const x = Math.round(Math.max(monitor.x, Math.min(monitor.x + monitor.width - 1, cursor.x + dx)));
    const y = Math.round(Math.max(monitor.y, Math.min(monitor.y + monitor.height - 1, cursor.y + dy)));
    return hyprDispatch(`hl.dispatch(hl.dsp.cursor.move({ x = ${x}, y = ${y} }))`);
  }

  if (kind === "scroll") {
    const dy = Math.round(Number(input.dy) || 0);
    if (uinputReady && sendUinput(`scroll ${dy}`)) {
      return { ok: true };
    }
    return { ok: false, error: "Uinput scroll not ready." };
  }

  if (kind === "click") {
    const btn = cleanText(input.button, 16) || "left";
    const code = btn === "right" ? 1 : btn === "middle" ? 2 : 0;
    if (uinputReady && sendUinput(`click ${code}`)) {
      return { ok: true };
    }
    return { ok: false, error: "Uinput not available for clicks." };
  }

  if (kind === "double_click") {
    if (uinputReady && sendUinput("double_click")) {
      return { ok: true };
    }
    return { ok: false, error: "Uinput not available." };
  }

  if (kind === "down" || kind === "up") {
    const btn = cleanText(input.button, 16) || "left";
    const code = btn === "right" ? 1 : btn === "middle" ? 2 : 0;
    if (uinputReady && sendUinput(`${kind} ${code}`)) {
      return { ok: true };
    }
    return { ok: false, error: "Uinput not available." };
  }

  if (kind === "type") {
    const text = String(input.text || "");
    if (!text) return { ok: true };
    return run("wtype", ["--", text]);
  }

  if (kind === "key") {
    const key = cleanText(input.key, 32);
    if (!key) throw new Error("Key is required.");
    
    // Quick special key combos
    if (key === "copy") return run("wtype", ["-M", "logo", "-k", "c", "-m", "logo"]);
    if (key === "paste") return run("wtype", ["-M", "logo", "-k", "v", "-m", "logo"]);
    if (key === "undo") return run("wtype", ["-M", "ctrl", "-k", "z", "-m", "ctrl"]);
    if (key === "alttab") return run("wtype", ["-M", "alt", "-k", "Tab", "-m", "alt"]);
    if (key === "super") return run("wtype", ["-k", "Super_L"]);

    const keyMap = {
      esc: "Escape",
      escape: "Escape",
      enter: "Return",
      return: "Return",
      tab: "Tab",
      backspace: "BackSpace",
      up: "Up",
      down: "Down",
      left: "Left",
      right: "Right",
      space: "space"
    };

    const targetKey = keyMap[key.toLowerCase()] || key;
    const mods = Array.isArray(input.mods) ? input.mods : [];
    const argv = [];
    for (const mod of mods) {
      if (["ctrl", "alt", "shift", "logo", "win"].includes(mod)) argv.push("-M", mod);
    }
    argv.push("-k", targetKey);
    for (const mod of mods) {
      if (["ctrl", "alt", "shift", "logo", "win"].includes(mod)) argv.push("-m", mod);
    }
    return run("wtype", argv);
  }

  throw new Error("Unknown input kind: " + kind);
}

function parseDesktopEntry(file, text) {
  const parsed = { id: basename(file, ".desktop") };
  let inSection = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) { inSection = line === "[Desktop Entry]"; continue; }
    if (!inSection) continue;
    const split = line.indexOf("=");
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    if (key.includes("[") || key.includes("]")) continue;
    parsed[key] = line.slice(split + 1).trim();
  }
  return parsed;
}

function desktopExecArgs(app) {
  const execStr = app?.exec || app?.Exec || "";
  const raw = [];
  let buf = "", quoted = false;
  for (let i = 0; i < execStr.length; i++) {
    const ch = execStr[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "\\") { if (i + 1 < execStr.length) { buf += execStr[i + 1]; i++; } continue; }
    if (!quoted && /\s/.test(ch)) { if (buf) { raw.push(buf); buf = ""; } continue; }
    buf += ch;
  }
  if (buf) raw.push(buf);
  const icon = app?.icon || app?.Icon || "";
  const name = app?.name || app?.Name || "";
  const args = [];
  for (const token of raw) {
    if (/^%[fFuUdDnNv]$/.test(token) || token === "%U" || token === "%F") continue;
    if (token === "%i") { if (icon) args.push("--icon", icon); continue; }
    if (token === "%c") { if (name) args.push(name); continue; }
    if (token === "%k" || token === "%v" || token === "%m") continue;
    args.push(token);
  }
  return args;
}

async function desktopApps() {
  if (appCache.at > now() - appCacheTtlMs) return appCache.apps;
  const apps = new Map();
  for (const dir of appDirs) {
    let files;
    try { files = await readdir(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith(".desktop")) continue;
      try {
        const entry = parseDesktopEntry(join(dir, file), await readFile(join(dir, file), "utf8"));
        if (entry.Type !== "Application" || entry.NoDisplay === "true" || entry.Hidden === "true" || !entry.Name || !entry.Exec) continue;
        apps.set(entry.id, entry);
      } catch { /* ignore unreadable */ }
    }
  }
  const list = [...apps.values()]
    .map((app) => ({
      id: app.id,
      name: app.Name,
      comment: app.Comment || "",
      icon: app.Icon || "",
      categories: app.Categories || "",
      keywords: app.Keywords || "",
      terminal: app.Terminal === "true",
      exec: app.Exec,
      Exec: app.Exec,
      Name: app.Name,
      Icon: app.Icon
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  appCache.apps = list;
  appCache.at = now();
  return list;
}

function stripJsonc(raw) {
  return String(raw || "")
    .replace(/^\s*\/\/[^\n]*(\n|$)/gm, "")
    .replace(/,(\s*[}\]])/g, "$1");
}

function parseMenuHierarchy(defRaw, userRaw) {
  let def = {};
  let user = {};
  try { def = defRaw ? JSON.parse(stripJsonc(defRaw)) : {}; } catch {}
  try { user = userRaw ? JSON.parse(stripJsonc(userRaw)) : {}; } catch {}
  const merged = { ...def, ...user };

  const items = {};
  const rootOrder = ["apps", "learn", "trigger", "style", "setup", "install", "remove", "update", "about", "system"];

  for (const [id, val] of Object.entries(merged)) {
    if (!val || typeof val !== "object") continue;
    let parent = val.parent;
    if (parent === undefined) {
      parent = id.includes(".") ? id.split(".").slice(0, -1).join(".") : "root";
    }
    if (id === "root") parent = "";

    const kind = val.action ? "action" : (val.target ? "link" : "menu");
    items[id] = {
      id,
      parent,
      kind,
      icon: val.icon || "",
      iconFont: val.iconFont || "",
      label: val.label || id,
      title: val.title || val.label || id,
      target: val.target || "",
      description: val.description || "",
      action: val.action || "",
      provider: val.provider || "",
      aliases: Array.isArray(val.aliases) ? val.aliases : (typeof val.aliases === "string" ? [val.aliases] : [])
    };
  }

  items["root"] = {
    id: "root",
    parent: "",
    kind: "menu",
    icon: "󰀻",
    label: "Go",
    title: "Go"
  };

  return { items, rootOrder };
}

async function getMenuStructure() {
  let defaultRaw = "";
  try {
    defaultRaw = await readFile(defaultMenuPath, "utf8");
  } catch {}

  let userRaw = "";
  try {
    if (existsSync(userMenuPath)) {
      userRaw = await readFile(userMenuPath, "utf8");
    }
  } catch {}

  const { items, rootOrder } = parseMenuHierarchy(defaultRaw, userRaw);
  const apps = await desktopApps();

  return {
    items,
    rootOrder,
    allApps: apps.map(a => ({
      id: a.id,
      name: a.name,
      comment: a.comment,
      icon: a.icon,
      terminal: a.terminal,
      exec: a.exec
    }))
  };
}

async function launchDetached(command, args = [], options = {}) {
  const sessionEnv = options.noSessionEnv ? {} : await getSessionEnvironment();
  const env = { ...process.env, ...sessionEnv, ...(options.env || {}) };
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", env });
      let hasError = false;
      child.on("error", (err) => {
        hasError = true;
        console.error(`[launchDetached] Error launching ${command}:`, err.message);
        reject(err);
      });
      setTimeout(() => {
        if (!hasError) {
          try { child.unref(); } catch {}
          resolve({ ok: true, message: `Launched ${command}` });
        }
      }, 60);
    } catch (err) {
      console.error(`[launchDetached] Failed to spawn ${command}:`, err.message);
      reject(err);
    }
  });
}

async function executeMenuAction(actionId, params = {}) {
  // If a specific workspace was requested, focus that workspace first
  if (params.workspace !== undefined && params.workspace !== null) {
    const wsId = Number(params.workspace);
    if (Number.isInteger(wsId) && wsId >= 1) {
      try {
        await hyprDispatch(`hl.dispatch(hl.dsp.focus({ workspace = ${wsId} }))`);
      } catch (e) {
        console.warn(`[executeMenuAction] Could not focus workspace ${wsId}:`, e.message);
      }
    }
  }

  const apps = await desktopApps();

  // If launching an app
  if (actionId.startsWith("app:") || params.type === "app" || params.kind === "app") {
    const targetId = String(actionId.replace(/^app:/, "") || params.id || params.appId || "").trim();
    const cleanTargetId = targetId.replace(/\.desktop$/i, "").toLowerCase();

    let app = apps.find((a) => {
      const aId = (a.id || "").trim();
      const aCleanId = aId.replace(/\.desktop$/i, "").toLowerCase();
      const aName = (a.name || "").trim().toLowerCase();
      return (
        aId === targetId ||
        aCleanId === cleanTargetId ||
        aName === cleanTargetId ||
        aName === targetId.toLowerCase()
      );
    });

    if (!app && params.exec) {
      app = {
        id: targetId,
        name: params.name || params.label || targetId,
        exec: params.exec,
        terminal: Boolean(params.terminal)
      };
    }

    if (!app) {
      const cleanExec = targetId.replace(/\.desktop$/i, "");
      app = {
        id: targetId,
        name: params.name || cleanExec,
        exec: cleanExec,
        terminal: false
      };
    }

    const shouldTile = params.tile === true || params.forceTile === true || params.tile !== false;
    let initialClients = [];
    if (shouldTile) {
      try {
        const state = await desktopState();
        initialClients = (state.clients || []).map(c => c.address);
      } catch {}
    }

    const args = desktopExecArgs(app);
    if (!args.length) throw new Error("App cannot be launched.");
    if (app.terminal) {
      await launchDetached("omarchy", ["launch", "terminal", ...args]);
    } else {
      await launchDetached("uwsm-app", ["--", ...args]).catch(() => {
        return launchDetached(args[0], args.slice(1));
      });
    }

    if (shouldTile) {
      const targetWs = params.workspace ? Number(params.workspace) : null;
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts++;
        if (attempts > 8) {
          clearInterval(timer);
          return;
        }
        try {
          const curr = await desktopState();
          const newWins = (curr.clients || []).filter(c => !initialClients.includes(c.address));
          for (const nw of newWins) {
            if (!targetWs || nw.workspace?.id === targetWs) {
              if (nw.floating) {
                await hyprDispatch(`hl.dispatch(hl.dsp.window.float({ action = "unset", window = ${luaStr("address:" + nw.address)} }))`);
                setTimeout(broadcastDesktopState, 80);
              }
            }
          }
        } catch {}
      }, 200);
    }

    setTimeout(broadcastDesktopState, 400);
    setTimeout(broadcastDesktopState, 1200);
    return { ok: true, message: `Launched ${app.name || targetId}` };
  }

  // If explicit action command provided
  if (params.action) {
    launchDetached("bash", ["-c", params.action]);
    return { ok: true, message: `Executed ${params.name || params.label || actionId}` };
  }

  // Check in parsed menu hierarchy
  const menu = await getMenuStructure();
  const menuItem = menu.items?.[actionId];
  if (menuItem?.action) {
    launchDetached("bash", ["-c", menuItem.action]);
    return { ok: true, message: `Executed ${menuItem.label || actionId}` };
  }

  // Fallbacks for known aliases
  switch (actionId) {
    case "shutdown":
    case "system.shutdown":
      run("omarchy", ["system", "shutdown"]).catch(() => run("systemctl", ["poweroff"]));
      return { ok: true, message: "Shutting down..." };

    case "reboot":
    case "system.reboot":
      run("omarchy", ["system", "reboot"]).catch(() => run("systemctl", ["reboot"]));
      return { ok: true, message: "Rebooting..." };

    case "suspend":
    case "system.suspend":
      run("omarchy", ["system", "suspend"]).catch(() => run("systemctl", ["suspend"]));
      return { ok: true, message: "Suspending..." };

    case "lock":
    case "system.lock":
      run("omarchy", ["system", "lock"]);
      return { ok: true, message: "Screen locked" };

    case "logout":
    case "system.logout":
      run("omarchy", ["system", "logout"]);
      return { ok: true, message: "Logging out..." };

    case "screensaver":
    case "system.screensaver":
      run("omarchy", ["launch", "screensaver"]).catch(() => run("omarchy-launch-screensaver", ["force"]));
      return { ok: true, message: "Screensaver started" };

    case "about":
      launchDetached("omarchy", ["launch", "about"]).catch(() => launchDetached("omarchy-launch-about"));
      return { ok: true, message: "Opened About" };

    default:
      throw new Error("Unknown action: " + actionId);
  }
}

async function getPanelsList() {
  const shellJsonPath = join(homedir(), ".config/omarchy/shell.json");
  let barConfig = null;
  try {
    barConfig = JSON.parse(await readFile(shellJsonPath, "utf8"));
  } catch {
    barConfig = {};
  }

  const panelsMap = new Map();
  const knownTitles = {
    "omarchy.menu": { name: "Omarchy Menu", icon: "󰀻", desc: "Main system launcher" },
    "omarchy.workspaces": { name: "Workspaces", icon: "󱂬", desc: "Workspace indicator" },
    "omarchy.clock": { name: "Clock & Calendar", icon: "", desc: "Time and calendar popover" },
    "omarchy.indicators": { name: "Indicators", icon: "󱅫", desc: "Status indicators" },
    "omarchy.weather": { name: "Weather", icon: "󰖐", desc: "Live weather forecast" },
    "omarchy.media": { name: "Media Player", icon: "󰝚", desc: "MPRIS media controls" },
    "omarchy.audio": { name: "Audio", icon: "󰕾", desc: "Volume & device switcher" },
    "omarchy.bluetooth": { name: "Bluetooth", icon: "󰂯", desc: "Bluetooth devices" },
    "omarchy.network": { name: "Network", icon: "󰤨", desc: "Wi-Fi & Ethernet settings" },
    "omarchy.battery": { name: "Battery & Power", icon: "󰁹", desc: "Power profiles & battery" },
    "omarchy.notifications": { name: "Notifications", icon: "󰂚", desc: "Notification center" },
    "omarchy.agents": { name: "AI Agents", icon: "󰚩", desc: "AI assistant launchers" },
    "omarchy.system": { name: "System Controls", icon: "󰐥", desc: "Lock, sleep, shutdown" }
  };

  const sections = ["start", "center", "end"];
  for (const sec of sections) {
    const list = barConfig[sec] || [];
    for (const item of list) {
      if (typeof item === "string") {
        const meta = knownTitles[item] || { name: item, icon: "󱂬", desc: "" };
        panelsMap.set(item, {
          id: item,
          name: meta.name,
          icon: meta.icon,
          description: meta.desc,
          section: sec,
          enabled: true
        });
      }
    }
  }

  for (const [id, meta] of Object.entries(knownTitles)) {
    if (!panelsMap.has(id)) {
      panelsMap.set(id, {
        id,
        name: meta.name,
        icon: meta.icon,
        description: meta.desc,
        section: "other",
        enabled: true
      });
    }
  }

  return [...panelsMap.values()];
}

async function togglePanel(panelId) {
  const id = cleanText(panelId, 60);
  if (!id) throw new Error("Panel ID is required.");
  return run("omarchy-shell", ["shell", "toggle", id, "{}"], 3000, {
    env: { OMARCHY_PATH: "/usr/share/omarchy" }
  });
}

async function getControlsState() {
  let volume = 50;
  let muted = false;
  try {
    const volRes = await run("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"]);
    const match = volRes.stdout.match(/Volume:\s+([0-9.]+)/i);
    if (match) volume = Math.round(parseFloat(match[1]) * 100);
    muted = volRes.stdout.includes("[MUTED]");
  } catch {}

  let nightlight = false;
  try {
    const nlRes = await run("omarchy", ["toggle", "nightlight", "--status"]);
    if (nlRes.ok) {
      const parsed = JSON.parse(nlRes.stdout);
      nightlight = Boolean(parsed.enabled);
    }
  } catch {}

  let idle = false;
  try {
    const idleRes = await run("omarchy", ["toggle", "idle", "status"]);
    if (idleRes.ok) {
      const parsed = JSON.parse(idleRes.stdout);
      idle = Boolean(parsed.enabled);
    }
  } catch {}

  let dnd = false;
  try {
    const dndRes = await run("omarchy", ["toggle", "enabled", "notification-silencing"]);
    dnd = dndRes.ok;
  } catch {}

  return { volume, muted, nightlight, idle, dnd };
}

async function executeControlAction(action, payload = {}) {
  const cleanAction = cleanText(action, 50);
  switch (cleanAction) {
    case "volume-set": {
      const vol = Math.max(0, Math.min(150, Number(payload.volume ?? payload.value ?? 0)));
      await run("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", `${(vol / 100).toFixed(2)}`]);
      return { ok: true, volume: vol };
    }
    case "volume-step": {
      const step = Number(payload.step || 5);
      const sign = step >= 0 ? "+" : "-";
      await run("omarchy", ["audio", "output", "volume", `${sign}${Math.abs(step)}%`]).catch(() => {
        return run("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", `${Math.abs(step)}%${sign}`]);
      });
      return { ok: true };
    }
    case "toggle-mute": {
      await run("omarchy", ["audio", "output", "volume", "mute-toggle"]).catch(() => {
        return run("wpctl", ["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"]);
      });
      return { ok: true };
    }
    case "media-play-pause": {
      await run("wtype", ["-k", "XF86AudioPlay"]);
      return { ok: true };
    }
    case "media-next": {
      await run("wtype", ["-k", "XF86AudioNext"]);
      return { ok: true };
    }
    case "media-prev": {
      await run("wtype", ["-k", "XF86AudioPrev"]);
      return { ok: true };
    }
    case "media-stop": {
      await run("wtype", ["-k", "XF86AudioStop"]);
      return { ok: true };
    }
    case "toggle-idle":
    case "toggle-stay-awake": {
      await run("omarchy", ["toggle", "idle"]).catch(() => {
        return run("omarchy-toggle-idle");
      });
      return { ok: true };
    }
    case "toggle-nightlight": {
      await run("omarchy", ["toggle", "nightlight"]);
      return { ok: true };
    }
    case "toggle-notifications": {
      await run("omarchy", ["toggle", "notification", "silencing"]);
      return { ok: true };
    }
    case "toggle-dpms": {
      await run("hyprctl", ["dispatch", "dpms", "toggle"]);
      return { ok: true };
    }
    case "dpms-off": {
      await run("hyprctl", ["dispatch", "dpms", "off"]);
      return { ok: true };
    }
    case "dpms-on": {
      await run("hyprctl", ["dispatch", "dpms", "on"]);
      return { ok: true };
    }
    case "screenshot": {
      const res = await run("omarchy", ["capture", "screenshot", "fullscreen", "save"]);
      return { ok: true, output: res.stdout.trim() };
    }
    case "lock": {
      await run("omarchy", ["system", "lock"]);
      return { ok: true };
    }
    case "suspend": {
      await run("omarchy", ["system", "suspend"]).catch(() => run("systemctl", ["suspend"]));
      return { ok: true };
    }
    case "reboot": {
      await run("omarchy", ["system", "reboot"]).catch(() => run("systemctl", ["reboot"]));
      return { ok: true };
    }
    case "poweroff": {
      await run("systemctl", ["poweroff"]);
      return { ok: true };
    }
    default:
      throw new Error(`Unknown control action: ${cleanAction}`);
  }
}

async function getActiveIconThemes() {
  const themes = [];
  const themeFile = join(homedir(), ".local/state/omarchy/current/theme/icons.theme");
  if (existsSync(themeFile)) {
    try {
      const cur = (await readFile(themeFile, "utf8")).trim();
      if (cur) {
        themes.push(cur);
        const indexTheme = `/usr/share/icons/${cur}/index.theme`;
        if (existsSync(indexTheme)) {
          const content = await readFile(indexTheme, "utf8");
          const match = content.match(/^Inherits=(.*)$/m);
          if (match) {
            for (const inh of match[1].split(",")) {
              const t = inh.trim();
              if (t && !themes.includes(t)) themes.push(t);
            }
          }
        }
      }
    } catch {}
  }
  for (const fb of ["Yaru", "Humanity", "hicolor", "Adwaita", "AdwaitaLegacy", "breeze"]) {
    if (!themes.includes(fb)) themes.push(fb);
  }
  return themes;
}

const iconLookupCache = new Map();

function findIconInThemes(iconName, themes) {
  if (!iconName) return null;
  const cleanName = iconName.trim();
  if (!cleanName) return null;
  if (cleanName.startsWith("/") && existsSync(cleanName)) return cleanName;

  const subdirs = [
    "scalable/apps", "scalable", "scalable/devices", "scalable/places", "scalable/actions", "scalable/categories", "scalable/status", "scalable/ui",
    "256x256/apps", "256x256@2x/apps", "128x128/apps", "64x64/apps", "48x48/apps", "48x48@2x/apps", "32x32/apps", "24x24/apps", "16x16/apps",
    "256x256/places", "128x128/places", "48x48/places", "32x32/places",
    "256x256/devices", "128x128/devices", "48x48/devices",
    "256x256/actions", "128x128/actions", "48x48/actions"
  ];

  for (const theme of themes) {
    const baseDirs = [
      join(homedir(), ".local/share/icons", theme),
      join(homedir(), ".icons", theme),
      `/usr/share/icons/${theme}`
    ];
    for (const base of baseDirs) {
      for (const sub of subdirs) {
        const svg = `${base}/${sub}/${cleanName}.svg`;
        if (existsSync(svg)) return svg;
        const png = `${base}/${sub}/${cleanName}.png`;
        if (existsSync(png)) return png;
      }
    }
  }

  // Check /usr/share/pixmaps
  const pmPng = `/usr/share/pixmaps/${cleanName}.png`;
  if (existsSync(pmPng)) return pmPng;
  const pmSvg = `/usr/share/pixmaps/${cleanName}.svg`;
  if (existsSync(pmSvg)) return pmSvg;

  return null;
}

async function resolveIcon(nameOrClass) {
  const target = cleanText(nameOrClass, 100).toLowerCase().trim();
  if (!target) return null;

  // Omarchy official app or shell icon
  if (target === "omarchy" || target === "omarchy-companion" || target === "omarchy-shell" || target === "omarchy-menu" || target === "omarchy.menu") {
    if (existsSync(omarchyIconPath)) return omarchyIconPath;
    if (existsSync(omarchyLogoPath)) return omarchyLogoPath;
  }

  if (iconLookupCache.has(target)) {
    return iconLookupCache.get(target);
  }

  const themes = await getActiveIconThemes();

  // 1. Direct search with target name
  let found = findIconInThemes(target, themes);

  // 2. Desktop apps database match
  if (!found) {
    const apps = await desktopApps();
    const matched = apps.find(a => 
      a.id.toLowerCase() === target || 
      a.name.toLowerCase() === target || 
      a.id.toLowerCase().replace(/\.desktop$/, "") === target ||
      (a.exec && a.exec.toLowerCase().includes(target))
    );
    if (matched && matched.icon) {
      found = findIconInThemes(matched.icon, themes);
    }
  }

  // 3. Fallback name variants (e.g. reverse domain or suffix removal)
  if (!found && target.includes(".")) {
    const parts = target.split(".");
    const lastPart = parts[parts.length - 1];
    found = findIconInThemes(lastPart, themes);
  }

  if (found) {
    iconLookupCache.set(target, found);
  }
  return found;
}

function generateFallbackSvg(name, char) {
  const theme = getThemeInfo();
  const rounding = theme.rounding || 0;
  const initial = (char || name || "W").charAt(0).toUpperCase();
  const hashVal = [...(name || "app")].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const hues = [210, 260, 330, 160, 45, 180];
  const hue = hues[hashVal % hues.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">
  <rect width="48" height="48" rx="${rounding}" fill="hsl(${hue}, 45%, 20%)" stroke="hsl(${hue}, 60%, 40%)" stroke-width="1.5"/>
  <text x="50%" y="54%" font-family="monospace" font-size="22" font-weight="bold" fill="hsl(${hue}, 90%, 80%)" text-anchor="middle" dominant-baseline="middle">${initial}</text>
</svg>`;
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2 * 1024 * 1024) throw new Error("Request body too large");
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error("Expected JSON body"); }
}

async function handleApi(req, res, url) {
  lastClientActivityTime = now();

  // SSE Events stream
  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write(":\n\n");
    sseClients.add(res);

    // Send initial state immediately
    desktopState().then((state) => {
      res.write(`data: ${JSON.stringify({ type: "desktop", ...state })}\n\n`);
    }).catch(() => {});

    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  // System & server status
  if (url.pathname === "/api/status" && req.method === "GET") {
    const net = await getNetworkInfo();
    const serviceRes = await run("systemctl", ["--user", "is-active", "omarchy-companion.service"]);
    const clientCount = activeClientCount();
    return json(res, 200, {
      ok: true,
      version,
      running: true,
      service: serviceRes.stdout === "active" ? "active" : "inactive",
      clientCount,
      hasClient: clientCount > 0,
      tailscaleIp: net.tailscaleIp,
      tailscaleUrl: net.tailscaleUrl,
      localIp: net.localIp,
      localUrl: net.localUrl,
      primaryUrl: net.primaryUrl,
      addresses: net.addresses
    });
  }

  // Desktop layout & windows
  if (url.pathname === "/api/desktop" && req.method === "GET") {
    const state = await desktopState();
    return json(res, 200, { ok: true, ...state, uinputReady });
  }

  // Omarchy active theme
  if (url.pathname === "/api/theme" && req.method === "GET") {
    const theme = await getThemeInfo();
    return json(res, 200, { ok: true, theme });
  }

  if (url.pathname === "/api/desktop" && req.method === "POST") {
    const input = await body(req);
    const result = await desktopControl(input);
    return json(res, 200, { ok: true, result });
  }

  // Mouse & Keyboard input
  if (url.pathname === "/api/input" && req.method === "POST") {
    const input = await body(req);
    const result = await inputControl(input);
    return json(res, 200, { ok: true, result });
  }

  // Omarchy Menu & launcher
  if (url.pathname === "/api/menu" && req.method === "GET") {
    const menu = await getMenuStructure();
    return json(res, 200, { ok: true, ...menu });
  }

  if (url.pathname === "/api/menu/launch" && req.method === "POST") {
    const input = await body(req);
    const actionId = cleanText(input.id || input.action, 80);
    const result = await executeMenuAction(actionId, input);
    return json(res, 200, { ok: true, result });
  }

  // Desktop bar panels
  if (url.pathname === "/api/panels" && req.method === "GET") {
    const panels = await getPanelsList();
    return json(res, 200, { ok: true, panels });
  }

  if (url.pathname === "/api/panels/toggle" && req.method === "POST") {
    const input = await body(req);
    const result = await togglePanel(input.panelId || input.id);
    return json(res, 200, { ok: true, result });
  }

  // Desktop Controls (Volume, Media, Power, Display)
  if (url.pathname === "/api/controls" && req.method === "GET") {
    const state = await getControlsState();
    return json(res, 200, { ok: true, ...state });
  }

  if (url.pathname === "/api/controls" && req.method === "POST") {
    const input = await body(req);
    const result = await executeControlAction(input.action, input);
    const state = await getControlsState();
    return json(res, 200, { ok: true, result, ...state });
  }

  // Icon resolver
  if (url.pathname === "/api/icon" && (req.method === "GET" || req.method === "HEAD")) {
    const target = url.searchParams.get("name") || url.searchParams.get("class") || "";
    const iconFile = await resolveIcon(target);
    if (iconFile) {
      const ext = extname(iconFile).toLowerCase();
      const mime = ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=86400" });
      if (req.method === "HEAD") return res.end();
      return createReadStream(iconFile).pipe(res);
    }
    const svg = generateFallbackSvg(target);
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
    if (req.method === "HEAD") return res.end();
    return res.end(svg);
  }

  // Omarchy Logo (square icon or SVG wordmark)
  if (url.pathname === "/api/logo" && (req.method === "GET" || req.method === "HEAD")) {
    const type = url.searchParams.get("type") || url.searchParams.get("format") || "";
    if (type === "wordmark" || type === "svg") {
      if (existsSync(omarchyLogoSvgPath)) {
        res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
        if (req.method === "HEAD") return res.end();
        return createReadStream(omarchyLogoSvgPath).pipe(res);
      }
    }
    const iconPath = existsSync(omarchyIconPath) ? omarchyIconPath : (existsSync(omarchyLogoPath) ? omarchyLogoPath : null);
    if (iconPath) {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      if (req.method === "HEAD") return res.end();
      return createReadStream(iconPath).pipe(res);
    }
    return fail(res, 404, "Logo not found");
  }

  if (url.pathname === "/api/logo.svg" && (req.method === "GET" || req.method === "HEAD")) {
    if (existsSync(omarchyLogoSvgPath)) {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
      if (req.method === "HEAD") return res.end();
      return createReadStream(omarchyLogoSvgPath).pipe(res);
    }
    return fail(res, 404, "Logo SVG not found");
  }

  // Official fonts (JetBrainsMono Nerd Font & omarchy icon font)
  if (url.pathname.startsWith("/api/font/") && (req.method === "GET" || req.method === "HEAD")) {
    const fontName = basename(url.pathname);
    const fontPaths = {
      "JetBrainsMonoNerdFont-Regular.ttf": "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf",
      "JetBrainsMonoNerdFont-Bold.ttf": "/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Bold.ttf",
      "omarchy.ttf": "/usr/share/fonts/omarchy/omarchy.ttf"
    };
    const targetFont = fontPaths[fontName];
    if (targetFont && existsSync(targetFont)) {
      res.writeHead(200, {
        "Content-Type": "font/ttf",
        "Cache-Control": "public, max-age=31536000, immutable"
      });
      if (req.method === "HEAD") return res.end();
      return createReadStream(targetFont).pipe(res);
    }
    return fail(res, 404, "Font not found");
  }

  return fail(res, 404, "Unknown API endpoint: " + url.pathname);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2"
};

async function serveStatic(req, res, url) {
  const reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = normalize(join(webDir, reqPath));
  if (!target.startsWith(webDir + "/")) return fail(res, 403, "Access denied");

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*"
    });
    createReadStream(target).pipe(res);
  } catch {
    fail(res, 404, "Not found");
  }
}

async function startServer() {
  initUinput();
  watchThemeChanges();

  // Periodic SSE broadcast for smooth state sync
  setInterval(broadcastDesktopState, 1500);

  const server = createServer(async (req, res) => {
    // Handle preflight CORS
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      });
      return res.end();
    }

    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
      } else {
        await serveStatic(req, res, url);
      }
    } catch (error) {
      fail(res, 400, error.message || "Bad request");
    }
  });

  server.on("error", (err) => {
    console.error("Omarchy Companion Server Error:", err.message);
    process.exitCode = 1;
  });

  server.listen(port, host, async () => {
    const net = await getNetworkInfo();
    console.log(`Omarchy Companion Server v${version} running:`);
    if (net.tailscaleUrl) console.log(`  Tailscale: ${net.tailscaleUrl}`);
    console.log(`  Local LAN: ${net.localUrl}`);
  });
}

// CLI panel-status command for Quickshell QML
async function printPanelStatus() {
  let isRunning = false;
  let clientCount = 0;
  try {
    const check = await run("systemctl", ["--user", "is-active", "omarchy-companion.service"]);
    isRunning = check.stdout === "active";
  } catch {
    isRunning = false;
  }

  let autostart = false;
  try {
    const check = await run("systemctl", ["--user", "is-enabled", "omarchy-companion.service"]);
    autostart = check.stdout.trim() === "enabled";
  } catch {
    autostart = false;
  }

  const net = await getNetworkInfo();

  // If running, query server for live client count
  if (isRunning) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const body = await response.json();
        clientCount = body.clientCount || 0;
      }
    } catch { /* fallback to 0 */ }
  }

  const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  const qrPath = join(runtime, "omarchy-companion-qr.png");
  const urlToEncode = net.primaryUrl || net.tailscaleUrl || net.localUrl || `http://127.0.0.1:${port}`;
  if (urlToEncode) {
    try {
      await run("qrencode", ["-s", "6", "-m", "2", "-o", qrPath, urlToEncode]);
    } catch {}
  }

  let recentLogs = "";
  try {
    const logsRes = await run("journalctl", ["--user", "-u", "omarchy-companion.service", "-n", "8", "--no-pager", "--output=cat"]);
    recentLogs = logsRes.stdout.trim();
  } catch {}

  const output = {
    running: isRunning,
    clientCount,
    hasClient: clientCount > 0,
    tailscaleIp: net.tailscaleIp,
    tailscaleUrl: net.tailscaleUrl,
    localIp: net.localIp,
    localUrl: net.localUrl,
    primaryUrl: net.primaryUrl,
    port,
    autostart,
    qrPath,
    recentLogs
  };

  console.log(JSON.stringify(output));
}

async function main() {
  const command = process.argv[2];
  if (command === "serve") return startServer();
  if (command === "panel-status") return printPanelStatus();
  if (command === "restart") {
    await run("systemctl", ["--user", "restart", "omarchy-companion.service"]);
    return printPanelStatus();
  }
  if (command === "stop") {
    await run("systemctl", ["--user", "stop", "omarchy-companion.service"]);
    return printPanelStatus();
  }
  if (command === "start") {
    await run("systemctl", ["--user", "start", "omarchy-companion.service"]);
    return printPanelStatus();
  }
  if (command === "autostart-toggle") {
    let isEnabled = false;
    try {
      const check = await run("systemctl", ["--user", "is-enabled", "omarchy-companion.service"]);
      isEnabled = check.stdout.trim() === "enabled";
    } catch {}
    if (isEnabled) {
      await run("systemctl", ["--user", "disable", "omarchy-companion.service"]);
    } else {
      await run("systemctl", ["--user", "enable", "omarchy-companion.service"]);
    }
    return printPanelStatus();
  }
  if (command === "copy-url") {
    const targetUrl = process.argv[3] || "";
    if (targetUrl) {
      await run("wl-copy", [targetUrl]);
    }
    return;
  }
  if (command === "status") return printPanelStatus();

  console.log("Usage: companion.mjs <serve|panel-status|restart|stop|start|autostart-toggle|copy-url|status>");
  process.exitCode = 1;
}

main();
