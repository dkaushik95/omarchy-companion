// Omarchy Companion Progressive Web App

const state = {
  desktop: null,
  selectedWorkspaceId: 1,
  activeTab: "workspace",
  tileOnLaunch: localStorage.getItem("omarchy_tile_on_launch") !== "false",
  menu: null,
  menuNavStack: ["root"],
  searchQuery: "",
  selectedWindow: null,
  connected: false,
  sseActive: false,
  drag: {
    active: false,
    element: null,
    sourceAddress: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    targetAddress: null,
    dragged: false,
    renderPending: false
  },
  trackpad: {
    lastX: null,
    lastY: null,
    touchStartTime: 0,
    touchStartX: 0,
    touchStartY: 0,
    lastTapTime: 0,
    scrollLastY: null
  }
};

// UI Elements
const el = {
  mainContent: document.getElementById("main-content"),
  connectionStatus: document.getElementById("connection-status"),
  statusPill: document.getElementById("status-pill"),
  statusLabel: document.getElementById("status-label"),
  workspacesTabs: document.getElementById("workspaces-tabs"),
  activeWorkspaceBadge: document.getElementById("active-workspace-badge"),
  monitorFrame: document.getElementById("monitor-frame"),
  monitorSurface: document.getElementById("monitor-surface"),
  canvasDropPreview: document.getElementById("canvas-drop-preview"),
  dropPreviewIcon: document.getElementById("drop-preview-icon"),
  dropPreviewLabel: document.getElementById("drop-preview-label"),
  monitorFocusedTitle: document.getElementById("monitor-focused-title"),
  surfacePlaceholder: document.getElementById("surface-placeholder"),
  btnQuickLaunch: document.getElementById("btn-quick-launch"),
  btnToggleSplit: document.getElementById("btn-toggle-split"),
  btnActionToggleSplit: document.getElementById("btn-action-toggle-split"),
  btnCanvasAddApp: document.getElementById("btn-canvas-add-app"),
  navTabs: document.querySelectorAll(".nav-item[data-tab]"),
  tabPanels: document.querySelectorAll(".tab-panel"),
  btnOmarchyMenu: document.getElementById("btn-omarchy-menu"),
  modalLauncher: document.getElementById("modal-omarchy-menu"),
  btnCloseLauncher: document.getElementById("btn-close-launcher"),
  launcherSearch: document.getElementById("launcher-search"),
  btnClearSearch: document.getElementById("btn-clear-search"),
  toggleLauncherTile: document.getElementById("toggle-launcher-tile"),
  menuNavBreadcrumb: document.getElementById("menu-nav-breadcrumb"),
  btnMenuBack: document.getElementById("btn-menu-back"),
  menuBackText: document.getElementById("menu-back-text"),
  menuCurrentTitle: document.getElementById("menu-current-title"),
  launcherContent: document.getElementById("launcher-content"),
  modalWindowActions: document.getElementById("modal-window-actions"),
  btnCloseWindowSheet: document.getElementById("btn-close-window-sheet"),
  sheetWindowIcon: document.getElementById("sheet-window-icon"),
  sheetWindowTitle: document.getElementById("sheet-window-title"),
  sheetWindowClass: document.getElementById("sheet-window-class"),
  btnActionFocus: document.getElementById("btn-action-focus"),
  btnActionTile: document.getElementById("btn-action-tile"),
  iconActionTile: document.getElementById("icon-action-tile"),
  labelActionTile: document.getElementById("label-action-tile"),
  btnActionFullscreen: document.getElementById("btn-action-fullscreen"),
  labelActionFullscreen: document.getElementById("label-action-fullscreen"),
  btnActionClose: document.getElementById("btn-action-close"),
  trackpadSurface: document.getElementById("trackpad-surface"),
  specialKeyBtns: document.querySelectorAll(".key-btn[data-key]"),
  formTypeToPc: document.getElementById("form-type-to-pc"),
  inputTypeText: document.getElementById("input-type-text"),
  btnQuickTypeSend: document.getElementById("btn-quick-type-send"),
  toggleBtns: document.querySelectorAll(".toggle-btn[data-action]"),
  volumeBadge: document.getElementById("volume-badge"),
  btnVolMute: document.getElementById("btn-vol-mute"),
  volMuteIcon: document.getElementById("vol-mute-icon"),
  volSlider: document.getElementById("vol-slider"),
  quickVolBtns: document.querySelectorAll(".quick-vol-btn"),
  powerBtns: document.querySelectorAll(".power-btn[data-power-action]"),
  toastContainer: document.getElementById("toast-container")
};

function haptic(ms = 15) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch { /* ignore */ }
  }
}

function showToast(message, duration = 2200) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.2s, transform 0.2s";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-8px)";
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// API Helper
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Real-Time EventSource
let sseRetryTimer = null;
function connectSSE() {
  if (sseRetryTimer) clearTimeout(sseRetryTimer);
  const es = new EventSource("/api/events");

  es.onopen = () => {
    state.sseActive = true;
    setConnectionState(true);
  };

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "desktop") {
        updateDesktopState(data);
      }
    } catch { /* ignore */ }
  };

  es.onerror = () => {
    es.close();
    state.sseActive = false;
    setConnectionState(false);
    sseRetryTimer = setTimeout(connectSSE, 2500);
  };
}

function setConnectionState(online) {
  state.connected = online;
  if (el.statusPill) {
    if (online) el.statusPill.classList.add("online");
    else el.statusPill.classList.remove("online");
  }
  if (el.statusLabel) {
    el.statusLabel.textContent = online ? "Online" : "Offline";
  }
  if (el.connectionStatus) {
    el.connectionStatus.textContent = online ? "Connected to PC" : "Connecting to PC...";
  }
}

// Initial Desktop State Fetch & Polling Fallback
async function syncDesktopState() {
  try {
    const data = await api("/api/desktop");
    if (data.ok) {
      setConnectionState(true);
      updateDesktopState(data);
    }
  } catch {
    setConnectionState(false);
  }
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") return null;
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16)
    };
  }
  if (clean.length >= 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16)
    };
  }
  return null;
}

function applyTheme(theme) {
  if (!theme || !theme.colors) return;
  const c = theme.colors;
  const isLight = theme.mode === "light";
  const rounding = Number(theme.rounding) || 0;
  const root = document.documentElement;

  // Simple and clean: NO ROUNDING unless the theme explicitly sets rounding!
  if (rounding === 0) {
    root.style.setProperty("--omarchy-rounding", "0px");
    root.style.setProperty("--radius-sm", "0px");
    root.style.setProperty("--radius-md", "0px");
    root.style.setProperty("--radius-lg", "0px");
    root.style.setProperty("--radius-xl", "0px");
    root.style.setProperty("--radius-full", "0px");
  } else {
    root.style.setProperty("--omarchy-rounding", `${rounding}px`);
    root.style.setProperty("--radius-sm", `${Math.max(2, Math.round(rounding * 0.7))}px`);
    root.style.setProperty("--radius-md", `${rounding}px`);
    root.style.setProperty("--radius-lg", `${Math.round(rounding * 1.5)}px`);
    root.style.setProperty("--radius-xl", `${Math.round(rounding * 2)}px`);
    root.style.setProperty("--radius-full", "9999px");
  }

  // Omarchy palette colors
  const bg = c.background || (isLight ? "#ffffff" : "#000000");
  const fg = c.foreground || (isLight ? "#111827" : "#ffffff");
  const darkBg = c.darkBackground || bg;
  const darkerBg = c.darkerBackground || darkBg;
  const lighterBg = c.lighterBackground || (isLight ? "#e5e7eb" : "#1a1a1a");
  const accent = c.accent || (isLight ? "#2563eb" : "#8d8d8d");
  const activeBorder = c.activeBorder || accent;
  const muted = c.muted || (isLight ? "#6b7280" : "#7a7a7a");
  const secondary = c.lightForeground || c.darkForeground || (isLight ? "#4b5563" : "#d1d5db");

  root.style.setProperty("--bg-primary", bg);
  root.style.setProperty("--bg-secondary", darkBg);
  root.style.setProperty("--bg-tertiary", lighterBg);
  root.style.setProperty("--bg-card", darkBg);
  root.style.setProperty("--bg-card-hover", lighterBg);

  root.style.setProperty("--text-primary", fg);
  root.style.setProperty("--text-secondary", secondary);
  root.style.setProperty("--text-muted", muted);

  root.style.setProperty("--accent", accent);
  root.style.setProperty("--active-border", activeBorder);
  root.style.setProperty("--border-focus", activeBorder);

  // Borders
  const borderSubtle = isLight ? "rgba(0, 0, 0, 0.14)" : "rgba(255, 255, 255, 0.14)";
  root.style.setProperty("--border-subtle", borderSubtle);

  // Accent RGB & Glow
  const rgb = hexToRgb(accent);
  if (rgb) {
    root.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.style.setProperty("--accent-glow", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
  }

  if (c.green) root.style.setProperty("--accent-green", c.green);
  if (c.red) root.style.setProperty("--accent-red", c.red);
  if (c.yellow) root.style.setProperty("--accent-yellow", c.yellow);

  // Update browser theme-color meta
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", bg);
}

let lastThemeKey = "";

function updateDesktopState(data) {
  state.desktop = data;
  if (data.theme) {
    const key = JSON.stringify(data.theme);
    if (key !== lastThemeKey) {
      lastThemeKey = key;
      applyTheme(data.theme);
    }
  }
  if (data.activeWorkspace?.id) {
    if (!state.selectedWorkspaceId || !data.workspaces.some(w => w.id === state.selectedWorkspaceId)) {
      state.selectedWorkspaceId = data.activeWorkspace.id;
    }
  }
  // Never tear down the canvas mid-drag; that is what makes dragging feel
  // finicky. Re-render once the pointer is released instead.
  if (state.drag.active) {
    state.drag.renderPending = true;
    return;
  }
  renderWorkspaces();
  renderCanvas();
}

// Render Workspaces Tabs
function renderWorkspaces() {
  const workspaces = state.desktop?.workspaces || [];
  const activeWsId = state.desktop?.activeWorkspace?.id || 1;
  const currentViewId = state.selectedWorkspaceId || activeWsId;

  // Ensure workspaces 1 to 5 at least exist in list
  const existingIds = new Set(workspaces.map(w => w.id));
  const fullList = [...workspaces];
  for (let i = 1; i <= Math.max(5, ...existingIds); i++) {
    if (!existingIds.has(i)) {
      fullList.push({ id: i, name: String(i), windows: 0 });
    }
  }
  fullList.sort((a, b) => a.id - b.id);

  el.activeWorkspaceBadge.textContent = `Active: Workspace ${activeWsId}`;
  el.workspacesTabs.innerHTML = "";

  fullList.forEach(ws => {
    const btn = document.createElement("button");
    btn.className = `workspace-tab ${ws.id === currentViewId ? "active" : ""}`;
    btn.dataset.workspaceId = ws.id;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", ws.id === currentViewId ? "true" : "false");
    
    btn.innerHTML = `
      <span>${ws.id}</span>
      ${ws.windows > 0 ? `<span class="window-count">${ws.windows}</span>` : ""}
    `;

    btn.addEventListener("click", () => {
      haptic();
      state.selectedWorkspaceId = ws.id;
      renderWorkspaces();
      renderCanvas();
      // Also switch active workspace on Hyprland if different
      if (ws.id !== activeWsId) {
        api("/api/desktop", {
          method: "POST",
          body: JSON.stringify({ action: "workspace", id: ws.id })
        }).catch(err => showToast(err.message));
      }
    });

    el.workspacesTabs.appendChild(btn);
  });
}

// Render Workspace Canvas & Windows
function renderCanvas() {
  const wsId = state.selectedWorkspaceId || state.desktop?.activeWorkspace?.id || 1;
  const monitor = state.desktop?.monitors?.find(m => m.focused) || state.desktop?.monitors?.[0] || { width: 1920, height: 1080, x: 0, y: 0, scale: 1.6 };
  const clients = (state.desktop?.clients || []).filter(c => c.workspace?.id === wsId && !c.hidden);

  if (el.monitorFocusedTitle) {
    const focusedClient = clients.find(c => c.address === state.desktop?.clients?.find(cl => cl.focused)?.address) || clients[0];
    el.monitorFocusedTitle.textContent = focusedClient ? `${focusedClient.title} (${focusedClient.class})` : "Desktop (Empty)";
  }

  // Remove existing window rectangles
  const oldRects = el.monitorSurface.querySelectorAll(".window-rect");
  oldRects.forEach(r => r.remove());

  if (clients.length === 0) {
    el.surfacePlaceholder.style.display = "flex";
    return;
  }
  el.surfacePlaceholder.style.display = "none";

  const monScale = monitor.scale || 1.6;
  const monLogicalW = monitor.width / monScale;
  const monLogicalH = monitor.height / monScale;

  const tiledClients = clients.filter(c => !c.floating);
  let minTiledX = Infinity, maxTiledX = -Infinity;
  let minTiledY = Infinity, maxTiledY = -Infinity;

  tiledClients.forEach(c => {
    const x1 = c.at[0];
    const y1 = c.at[1];
    const x2 = c.at[0] + c.size[0];
    const y2 = c.at[1] + c.size[1];
    if (x1 < minTiledX) minTiledX = x1;
    if (x2 > maxTiledX) maxTiledX = x2;
    if (y1 < minTiledY) minTiledY = y1;
    if (y2 > maxTiledY) maxTiledY = y2;
  });

  const spanTiledX = (maxTiledX > minTiledX && (maxTiledX - minTiledX) > 100) ? (maxTiledX - minTiledX) : monLogicalW;
  const spanTiledY = (maxTiledY > minTiledY && (maxTiledY - minTiledY) > 100) ? (maxTiledY - minTiledY) : monLogicalH;

  clients.forEach(c => {
    let leftPct = 0;
    let topPct = 0;
    let widthPct = 100;
    let heightPct = 100;

    if (c.floating) {
      // Floating windows positioned by exact monitor coordinates
      leftPct = Math.max(0, Math.min(92, (c.at[0] / monLogicalW) * 100));
      topPct = Math.max(0, Math.min(92, (c.at[1] / monLogicalH) * 100));
      widthPct = Math.max(15, Math.min(100 - leftPct, (c.size[0] / monLogicalW) * 100));
      heightPct = Math.max(15, Math.min(100 - topPct, (c.size[1] / monLogicalH) * 100));
    } else if (tiledClients.length > 1) {
      // Tiled windows span flush across tiled layout space
      leftPct = Math.max(0, Math.min(96, ((c.at[0] - minTiledX) / spanTiledX) * 100));
      topPct = Math.max(0, Math.min(96, ((c.at[1] - minTiledY) / spanTiledY) * 100));
      widthPct = Math.max(12, Math.min(100 - leftPct, (c.size[0] / spanTiledX) * 100));
      heightPct = Math.max(12, Math.min(100 - topPct, (c.size[1] / spanTiledY) * 100));
    }

    const rect = document.createElement("div");
    rect.className = `window-rect ${c.fullscreen ? "fullscreen" : ""} ${c.floating ? "floating" : ""}`;
    rect.dataset.address = c.address;
    rect.dataset.title = c.title || c.class;
    rect.style.left = `calc(${leftPct.toFixed(2)}% + 3px)`;
    rect.style.top = `calc(${topPct.toFixed(2)}% + 3px)`;
    rect.style.width = `calc(${widthPct.toFixed(2)}% - 6px)`;
    rect.style.height = `calc(${heightPct.toFixed(2)}% - 6px)`;

    rect.innerHTML = `
      <div class="window-rect-header">
        <img class="window-rect-icon" src="/api/icon?class=${encodeURIComponent(c.class)}" alt="">
        <span class="window-rect-title">${escapeHtml(c.title || c.class)}</span>
        ${c.floating ? `<span class="window-floating-badge" title="Floating centered window">Float</span>` : ""}
      </div>
      <div class="window-rect-body">
        <img class="window-rect-big-icon" src="/api/icon?class=${encodeURIComponent(c.class)}" alt="">
      </div>
    `;

    setupWindowDragAndClick(rect, c);
    el.monitorSurface.appendChild(rect);
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Find drop target window, workspace tab, or surface edge
function findDropTarget(clientX, clientY, sourceAddress, isFloating = false) {
  const surfaceRect = el.monitorSurface.getBoundingClientRect();

  // 1. Workspace strip: the whole header above the canvas snaps to the nearest tab
  //    (no precision required - just drag up into the strip).
  const tabsEl = el.workspacesTabs;
  if (tabsEl && tabsEl.children.length > 1) {
    const stripRect = tabsEl.parentElement.getBoundingClientRect();
    if (clientY >= stripRect.top && clientY <= stripRect.bottom &&
        clientX >= stripRect.left && clientX <= stripRect.right) {
      let nearest = null;
      let nearestDist = Infinity;
      for (const tab of tabsEl.children) {
        const b = tab.getBoundingClientRect();
        const dist = Math.abs(b.left + b.width / 2 - clientX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = tab;
        }
      }
      if (nearest && nearestDist < 80) {
        const wsId = Number(nearest.dataset.workspaceId);
        const currentWs = state.selectedWorkspaceId || state.desktop?.activeWorkspace?.id || 1;
        if (wsId && wsId !== currentWs) {
          return {
            type: "workspace",
            workspaceId: wsId,
            tabEl: nearest,
            label: `Move to Workspace ${wsId}`,
            icon: "󰍹"
          };
        }
      }
    }
  }

  // If the dragged window is floating, disable all snapping to windows and surface edges
  if (isFloating) {
    return null;
  }

  // 2. Outer corridor of the canvas = move the window to that side of the screen.
  //    These take precedence so edge-moves stay reachable even when tiled windows
  //    cover the entire canvas.
  const relSurfX = (clientX - surfaceRect.left) / surfaceRect.width;
  const relSurfY = (clientY - surfaceRect.top) / surfaceRect.height;
  const inSurface = clientX >= surfaceRect.left && clientX <= surfaceRect.right &&
                    clientY >= surfaceRect.top && clientY <= surfaceRect.bottom;
  const corridor = 0.09;
  if (inSurface) {
    if (relSurfX < corridor) {
      return {
        type: "move",
        direction: "l",
        preview: { left: 0, top: 0, width: surfaceRect.width / 2, height: surfaceRect.height },
        label: "Move Left ⇤",
        icon: "󰁍"
      };
    }
    if (relSurfX > 1 - corridor) {
      return {
        type: "move",
        direction: "r",
        preview: { left: surfaceRect.width / 2, top: 0, width: surfaceRect.width / 2, height: surfaceRect.height },
        label: "Move Right ⇥",
        icon: "󰁔"
      };
    }
    if (relSurfY < corridor) {
      return {
        type: "move",
        direction: "u",
        preview: { left: 0, top: 0, width: surfaceRect.width, height: surfaceRect.height / 2 },
        label: "Move Up ⤒",
        icon: "󰁝"
      };
    }
    if (relSurfY > 1 - corridor) {
      return {
        type: "move",
        direction: "d",
        preview: { left: 0, top: surfaceRect.height / 2, width: surfaceRect.width, height: surfaceRect.height / 2 },
        label: "Move Down ⤓",
        icon: "󰁅"
      };
    }
  }

  // 3. Check if hovering over another window (center = swap, edge = split)
  const rects = el.monitorSurface.querySelectorAll(".window-rect");

  for (const r of rects) {
    if (r.dataset.address === sourceAddress) continue;
    const b = r.getBoundingClientRect();
    if (clientX >= b.left && clientX <= b.right && clientY >= b.top && clientY <= b.bottom) {
      const relX = (clientX - b.left) / b.width;
      const relY = (clientY - b.top) / b.height;
      const bLeft = b.left - surfaceRect.left;
      const bTop = b.top - surfaceRect.top;
      const title = r.dataset.title || "Window";

      const dx = relX - 0.5;
      const dy = relY - 0.5;

      // Center 40% zone = SWAP
      if (Math.abs(dx) < 0.22 && Math.abs(dy) < 0.22) {
        return {
          type: "swap",
          targetAddress: r.dataset.address,
          targetEl: r,
          title,
          preview: { left: bLeft, top: bTop, width: b.width, height: b.height },
          label: `Swap with ${title}`,
          icon: "⇄"
        };
      }

      // Outer directional quadrants = SPLIT LAYOUT
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx > 0) {
          return {
            type: "split",
            direction: "r",
            targetAddress: r.dataset.address,
            targetEl: r,
            title,
            preview: { left: bLeft + b.width / 2, top: bTop, width: b.width / 2, height: b.height },
            label: `Split Right ›`,
            icon: "󱂬"
          };
        } else {
          return {
            type: "split",
            direction: "l",
            targetAddress: r.dataset.address,
            targetEl: r,
            title,
            preview: { left: bLeft, top: bTop, width: b.width / 2, height: b.height },
            label: `Split Left ‹`,
            icon: "󱂬"
          };
        }
      } else {
        if (dy > 0) {
          return {
            type: "split",
            direction: "d",
            targetAddress: r.dataset.address,
            targetEl: r,
            title,
            preview: { left: bLeft, top: bTop + b.height / 2, width: b.width, height: b.height / 2 },
            label: `Split Below ∨`,
            icon: "󱂬"
          };
        } else {
          return {
            type: "split",
            direction: "u",
            targetAddress: r.dataset.address,
            targetEl: r,
            title,
            preview: { left: bLeft, top: bTop, width: b.width, height: b.height / 2 },
            label: `Split Above ∧`,
            icon: "󱂬"
          };
        }
      }
    }
  }

  return null;
}

// Drag & Drop + Click Handler for Window Rectangles
function setupWindowDragAndClick(rect, client) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentTranslateX = 0;
  let currentTranslateY = 0;
  let hasMoved = false;
  let currentDropTarget = null;
  let lastTargetKey = null;
  let lastHoveredEl = null;

  const clearHoverTargets = () => {
    if (lastHoveredEl) {
      lastHoveredEl.classList.remove("drop-target");
      lastHoveredEl = null;
    }
    document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
  };

  const onPointerDown = (e) => {
    if (state.drag.active) return;
    state.drag.active = true;
    isDragging = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    currentTranslateX = 0;
    currentTranslateY = 0;
    currentDropTarget = null;
    lastTargetKey = null;
    state.drag.sourceAddress = client.address;
    try { rect.setPointerCapture(e.pointerId); } catch {}
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!hasMoved && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
      hasMoved = true;
      rect.classList.add("dragging");
      haptic(25);
    }

    if (hasMoved) {
      currentTranslateX = dx;
      currentTranslateY = dy;
      rect.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

      const target = findDropTarget(e.clientX, e.clientY, client.address, Boolean(client.floating));
      currentDropTarget = target;

      const targetKey = target ? `${target.type}:${target.direction || ""}:${target.workspaceId || target.targetAddress || ""}` : null;
      if (targetKey !== lastTargetKey) {
        lastTargetKey = targetKey;
        clearHoverTargets();
        if (target) {
          haptic(15);
          if (target.targetEl) {
            target.targetEl.classList.add("drop-target");
            lastHoveredEl = target.targetEl;
          } else if (target.tabEl) {
            target.tabEl.classList.add("drop-target");
            lastHoveredEl = target.tabEl;
          }
        }
      }

      if (target && target.preview && el.canvasDropPreview) {
        el.canvasDropPreview.classList.add("active");
        el.canvasDropPreview.style.left = `${target.preview.left}px`;
        el.canvasDropPreview.style.top = `${target.preview.top}px`;
        el.canvasDropPreview.style.width = `${target.preview.width}px`;
        el.canvasDropPreview.style.height = `${target.preview.height}px`;
        if (el.dropPreviewIcon) el.dropPreviewIcon.textContent = target.icon || "⇄";
        if (el.dropPreviewLabel) el.dropPreviewLabel.textContent = target.label || "Action";
      } else if (el.canvasDropPreview) {
        el.canvasDropPreview.classList.remove("active");
      }
    }
  };

  const onPointerUp = async (e) => {
    if (!isDragging) return;
    isDragging = false;
    state.drag.active = false;
    clearHoverTargets();
    rect.classList.remove("dragging");
    if (el.canvasDropPreview) el.canvasDropPreview.classList.remove("active");

    if (state.drag.renderPending) {
      state.drag.renderPending = false;
      renderWorkspaces();
      renderCanvas();
    }

    if (!hasMoved) {
      rect.style.transform = "";
      openWindowActionSheet(client);
      return;
    }

    const target = currentDropTarget;
    currentDropTarget = null;
    lastTargetKey = null;

    if (target) {
      rect.style.transform = "";
      if (target.type === "swap") {
        haptic(35);
        showToast(`Swapping with ${target.title}...`);
        try {
          await api("/api/desktop", {
            method: "POST",
            body: JSON.stringify({
              action: "swap",
              sourceAddress: client.address,
              targetAddress: target.targetAddress
            })
          });
          showToast("Windows swapped!");
          setTimeout(syncDesktopState, 150);
        } catch (err) {
          showToast("Swap failed: " + err.message);
        }
      } else if (target.type === "split") {
        haptic(35);
        showToast(`Splitting with ${target.title}...`);
        try {
          await api("/api/desktop", {
            method: "POST",
            body: JSON.stringify({
              action: "split",
              address: client.address,
              targetAddress: target.targetAddress,
              direction: target.direction
            })
          });
          showToast("Layout updated!");
          setTimeout(syncDesktopState, 150);
        } catch (err) {
          showToast("Split failed: " + err.message);
        }
      } else if (target.type === "workspace") {
        haptic(35);
        showToast(`Moving to Workspace ${target.workspaceId}...`);
        try {
          await api("/api/desktop", {
            method: "POST",
            body: JSON.stringify({
              action: "move-to-workspace",
              address: client.address,
              workspace: target.workspaceId
            })
          });
          showToast(`Moved to Workspace ${target.workspaceId}`);
          setTimeout(syncDesktopState, 150);
        } catch (err) {
          showToast("Move failed: " + err.message);
        }
      } else if (target.type === "move") {
        haptic(25);
        try {
          await api("/api/desktop", {
            method: "POST",
            body: JSON.stringify({
              action: "move",
              address: client.address,
              direction: target.direction
            })
          });
          showToast(`Moved window ${target.direction.toUpperCase()}`);
          setTimeout(syncDesktopState, 150);
        } catch (err) {
          showToast(err.message);
        }
      }
    } else if (client.floating) {
      // User dragged a floating window onto free space on the monitor canvas!
      const surfaceRect = el.monitorSurface.getBoundingClientRect();
      const currentWs = state.selectedWorkspaceId || state.desktop?.activeWorkspace?.id || 1;
      
      // Calculate final center or top-left position relative to monitor surface (0 to 1)
      const finalLeftPx = (rect.offsetLeft || 0) + currentTranslateX;
      const finalTopPx = (rect.offsetTop || 0) + currentTranslateY;
      
      const relX = Math.max(0.01, Math.min(0.95, finalLeftPx / surfaceRect.width));
      const relY = Math.max(0.01, Math.min(0.95, finalTopPx / surfaceRect.height));

      haptic(25);
      showToast("Repositioned floating window");
      rect.style.transform = "";

      try {
        await api("/api/desktop", {
          method: "POST",
          body: JSON.stringify({
            action: "drop",
            address: client.address,
            workspace: currentWs,
            x: relX,
            y: relY
          })
        });
        setTimeout(syncDesktopState, 150);
      } catch (err) {
        showToast("Move failed: " + err.message);
        syncDesktopState();
      }
    } else {
      // Smoothly snap tiled window back to origin if no target
      rect.style.transition = "transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)";
      rect.style.transform = "translate3d(0, 0, 0)";
      setTimeout(() => {
        rect.style.transition = "";
        rect.style.transform = "";
      }, 240);
    }
  };

  rect.addEventListener("pointerdown", onPointerDown);
  rect.addEventListener("pointermove", onPointerMove);
  rect.addEventListener("pointerup", onPointerUp);
  rect.addEventListener("pointercancel", onPointerUp);
}

// Window Action Sheet Modal
function openWindowActionSheet(client) {
  state.selectedWindow = client;
  el.sheetWindowIcon.src = `/api/icon?class=${encodeURIComponent(client.class)}`;
  el.sheetWindowTitle.textContent = client.title || client.class;
  el.sheetWindowClass.textContent = client.class;
  el.labelActionFullscreen.textContent = client.fullscreen ? "Exit Full Screen" : "Full Screen";

  if (el.btnActionTile) {
    if (client.floating) {
      if (el.iconActionTile) el.iconActionTile.textContent = "󰹟";
      if (el.labelActionTile) el.labelActionTile.textContent = "Tile into Workspace";
    } else {
      if (el.iconActionTile) el.iconActionTile.textContent = "󰉈";
      if (el.labelActionTile) el.labelActionTile.textContent = "Float (Center Window)";
    }
  }

  // Populate 1-tap swap buttons with other windows in this workspace
  const swapsList = document.getElementById("sheet-swaps-list");
  if (swapsList) {
    swapsList.innerHTML = "";
    const wsId = client.workspace?.id || state.selectedWorkspaceId;
    const otherClients = (state.desktop?.clients || []).filter(c => c.workspace?.id === wsId && c.address !== client.address);

    if (otherClients.length > 0) {
      const title = document.createElement("div");
      title.className = "sheet-swaps-title";
      title.textContent = "SWAP POSITION WITH:";
      swapsList.appendChild(title);

      otherClients.forEach(other => {
        const btn = document.createElement("button");
        btn.className = "action-sheet-btn swap-btn";
        btn.innerHTML = `
          <span class="action-btn-icon">⇄</span>
          <span class="action-btn-label">Swap with ${escapeHtml(other.title || other.class)}</span>
        `;
        btn.addEventListener("click", async () => {
          haptic(25);
          closeWindowActionSheet();
          showToast(`Swapping with ${other.class}...`);
          try {
            await api("/api/desktop", {
              method: "POST",
              body: JSON.stringify({ action: "swap", sourceAddress: client.address, targetAddress: other.address })
            });
            showToast("Windows swapped!");
            setTimeout(syncDesktopState, 150);
          } catch (err) {
            showToast("Swap failed: " + err.message);
          }
        });
        swapsList.appendChild(btn);
      });
    }
  }

  el.modalWindowActions.classList.add("open");
}

function closeWindowActionSheet() {
  state.selectedWindow = null;
  el.modalWindowActions.classList.remove("open");
}

el.btnCloseWindowSheet.addEventListener("click", closeWindowActionSheet);
el.modalWindowActions.addEventListener("click", (e) => {
  if (e.target === el.modalWindowActions) closeWindowActionSheet();
});

el.btnToggleSplit?.addEventListener("click", async () => {
  haptic();
  showToast("Toggling split layout...");
  try {
    await api("/api/desktop", {
      method: "POST",
      body: JSON.stringify({ action: "togglesplit" })
    });
    setTimeout(syncDesktopState, 150);
  } catch (err) {
    showToast(err.message);
  }
});

el.btnActionToggleSplit?.addEventListener("click", async () => {
  const win = state.selectedWindow;
  if (!win || !win.address) return;
  haptic();
  closeWindowActionSheet();
  try {
    await api("/api/desktop", {
      method: "POST",
      body: JSON.stringify({ action: "togglesplit", address: win.address })
    });
    showToast("Toggled split layout");
    setTimeout(syncDesktopState, 150);
  } catch (err) {
    showToast(err.message);
  }
});

el.btnActionFocus.addEventListener("click", async () => {
  const win = state.selectedWindow;
  if (!win || !win.address) return;
  haptic();
  closeWindowActionSheet();
  try {
    await api("/api/desktop", { method: "POST", body: JSON.stringify({ action: "focus", address: win.address }) });
    showToast("Focused window");
    setTimeout(syncDesktopState, 80);
  } catch (err) { showToast(err.message); }
});

el.btnActionTile?.addEventListener("click", async () => {
  const win = state.selectedWindow;
  if (!win || !win.address) return;
  haptic();
  const isFloating = Boolean(win.floating);
  closeWindowActionSheet();
  try {
    await api("/api/desktop", {
      method: "POST",
      body: JSON.stringify({ action: isFloating ? "tile" : "float", address: win.address })
    });
    showToast(isFloating ? "Tiled into workspace" : "Floated (centered)");
    setTimeout(syncDesktopState, 80);
  } catch (err) { showToast(err.message); }
});

el.btnActionFullscreen.addEventListener("click", async () => {
  const win = state.selectedWindow;
  if (!win || !win.address) return;
  haptic();
  const wasFs = Boolean(win.fullscreen);
  closeWindowActionSheet();
  try {
    await api("/api/desktop", { method: "POST", body: JSON.stringify({ action: "fullscreen", address: win.address }) });
    showToast(wasFs ? "Exited Fullscreen" : "Fullscreen mode");
    setTimeout(syncDesktopState, 80);
  } catch (err) { showToast(err.message); }
});

el.btnActionClose.addEventListener("click", async () => {
  const win = state.selectedWindow;
  if (!win || !win.address) return;
  haptic();
  const name = win.class || "window";
  closeWindowActionSheet();
  try {
    await api("/api/desktop", { method: "POST", body: JSON.stringify({ action: "close", address: win.address }) });
    showToast("Closed " + name);
    setTimeout(syncDesktopState, 120);
  } catch (err) { showToast(err.message); }
});

// Tab Navigation Switching
el.navTabs.forEach(tabBtn => {
  tabBtn.addEventListener("click", () => {
    const tabName = tabBtn.dataset.tab;
    haptic();
    switchTab(tabName);
  });
});

function switchTab(tabName) {
  state.activeTab = tabName;
  el.navTabs.forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  el.tabPanels.forEach(p => p.classList.toggle("active", p.id === `tab-panel-${tabName}`));

  if (el.mainContent) {
    el.mainContent.classList.toggle("interactions-mode", tabName === "interactions");
  }

  if (tabName === "workspace") {
    renderWorkspaces();
    renderCanvas();
  }

  if (tabName === "controls") {
    loadControlsState();
  }
}

// Omarchy Super + Space Launcher Modal
el.btnOmarchyMenu.addEventListener("click", () => {
  haptic(20);
  openLauncher();
});

el.btnQuickLaunch?.addEventListener("click", () => {
  haptic(20);
  openLauncher();
});

el.btnCanvasAddApp?.addEventListener("click", () => {
  haptic(20);
  openLauncher();
});

el.btnCloseLauncher.addEventListener("click", closeLauncher);
el.modalLauncher.addEventListener("click", (e) => {
  if (e.target === el.modalLauncher) closeLauncher();
});

if (el.toggleLauncherTile) {
  el.toggleLauncherTile.checked = state.tileOnLaunch;
  el.toggleLauncherTile.addEventListener("change", (e) => {
    state.tileOnLaunch = e.target.checked;
    localStorage.setItem("omarchy_tile_on_launch", state.tileOnLaunch ? "true" : "false");
    haptic(10);
  });
}

const MENU_ICONS = {
  "apps": "󰀻",
  "learn": "󰧑",
  "trigger": "󱓞",
  "style": "",
  "setup": "",
  "install": "󰉉",
  "remove": "󰭌",
  "update": "",
  "about": "",
  "system": "",
  "system.lock": "",
  "system.screensaver": "󱄄",
  "system.suspend": "󰒲",
  "system.hibernate": "󰤁",
  "system.logout": "󰍃",
  "system.reboot": "󰜉",
  "system.shutdown": "󰐥",
  "learn.keybindings": "",
  "learn.omarchy": "",
  "learn.hyprland": "",
  "learn.arch": "󰣇",
  "learn.neovim": "",
  "learn.bash": "󱆃",
  "learn.tmux-keybindings": "",
  "learn.herdr-keybindings": "",
  "learn.community": "󰙯",
  "trigger.emoji": "",
  "trigger.reminder": "󰢌",
  "trigger.capture": "",
  "trigger.capture.screenshot": "",
  "trigger.capture.screenrecord": "",
  "trigger.capture.text": "󰴑",
  "trigger.capture.qr": "󰐲",
  "trigger.capture.color": "󰃉",
  "trigger.share": "󱓞",
  "trigger.toggle": "󰍜",
  "trigger.toggle.idle-lock": "",
  "trigger.toggle.notifications": "󰂛",
  "trigger.toggle.nightlight": "󰔎",
  "trigger.toggle.top-bar": "󰍜",
  "trigger.toggle.touchpad": "󰟸",
  "trigger.tests": "⚡",
  "style.theme": "󰸌",
  "style.background": "󰸌",
  "style.font": "󰬬",
  "style.bar": "󰍜",
  "setup.monitors": "󰍹",
  "setup.keybindings": "",
  "setup.input": "󰍽",
  "setup.network": "󱚾",
  "setup.audio": "",
  "setup.bluetooth": "󰂯",
  "setup.power": "󰚥"
};

function getMenuIcon(item, isApp = false) {
  if (isApp) {
    return `<img class="menu-row-app-icon" src="/api/icon?class=${encodeURIComponent(item.icon || item.id)}" alt="" onerror="this.outerHTML='<span class=\\'menu-row-icon\\'>󰀻</span>'">`;
  }
  if (item?.icon) {
    if (item.icon.includes("/") || item.icon.endsWith(".png") || item.icon.endsWith(".svg")) {
      return `<img class="menu-row-app-icon" src="/api/icon?name=${encodeURIComponent(item.icon)}" alt="" onerror="this.outerHTML='<span class=\\'menu-row-icon\\'>❖</span>'">`;
    }
    return `<span class="menu-row-icon">${escapeHtml(item.icon)}</span>`;
  }
  if (item?.id && MENU_ICONS[item.id]) {
    return `<span class="menu-row-icon">${MENU_ICONS[item.id]}</span>`;
  }
  if (item?.parent && MENU_ICONS[item.parent]) {
    return `<span class="menu-row-icon">${MENU_ICONS[item.parent]}</span>`;
  }
  return `<span class="menu-row-icon">❖</span>`;
}

function getBreadcrumbPath(itemId) {
  if (!state.menu?.items) return "";
  const parts = [];
  let curr = state.menu.items[itemId];
  while (curr && curr.id !== "root") {
    parts.unshift(curr.label || curr.title || curr.id);
    curr = state.menu.items[curr.parent];
  }
  return parts.join(" › ");
}

async function openLauncher() {
  el.modalLauncher.classList.add("open");
  el.launcherSearch.value = "";
  state.searchQuery = "";
  state.menuNavStack = ["root"];
  el.btnClearSearch.style.display = "none";
  el.launcherSearch.focus();
  if (!state.menu) {
    await loadMenu();
  }
  renderLauncherItems();
}

function closeLauncher() {
  el.modalLauncher.classList.remove("open");
}

async function loadMenu() {
  try {
    const data = await api("/api/menu");
    if (data.ok) {
      state.menu = data;
    }
  } catch (err) {
    showToast("Failed to load menu: " + err.message);
  }
}

el.launcherSearch.addEventListener("input", (e) => {
  state.searchQuery = e.target.value.trim().toLowerCase();
  el.btnClearSearch.style.display = state.searchQuery ? "block" : "none";
  renderLauncherItems();
});

el.btnClearSearch.addEventListener("click", () => {
  el.launcherSearch.value = "";
  state.searchQuery = "";
  el.btnClearSearch.style.display = "none";
  el.launcherSearch.focus();
  renderLauncherItems();
});

el.btnMenuBack?.addEventListener("click", () => {
  haptic(10);
  if (state.menuNavStack.length > 1) {
    state.menuNavStack.pop();
    renderLauncherItems();
  }
});

function renderLauncherItems() {
  if (!state.menu?.items) {
    el.launcherContent.innerHTML = `<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4);font-family:var(--font-mono);font-size:13px;">Loading Omarchy menu...</div>`;
    return;
  }

  const query = (state.searchQuery || "").trim().toLowerCase();
  const currentMenuId = state.menuNavStack[state.menuNavStack.length - 1] || "root";
  const itemsMap = state.menu.items;
  const allApps = state.menu.allApps || [];

  // If search query is entered: SEARCH THROUGHOUT NESTING
  if (query) {
    el.menuNavBreadcrumb.style.display = "none";
    el.launcherContent.innerHTML = "";

    const results = [];

    // Search all apps
    for (const app of allApps) {
      const name = (app.name || "").toLowerCase();
      const comment = (app.comment || "").toLowerCase();
      const id = (app.id || "").toLowerCase();
      if (name.includes(query) || comment.includes(query) || id.includes(query)) {
        let score = 50;
        if (name === query) score = 100;
        else if (name.startsWith(query)) score = 85;
        else if (comment.includes(query)) score = 40;
        results.push({
          isApp: true,
          item: app,
          label: app.name,
          desc: app.comment,
          path: "Apps",
          score
        });
      }
    }

    // Search all menu items (all levels)
    for (const [id, item] of Object.entries(itemsMap)) {
      if (id === "root") continue;
      const label = (item.label || "").toLowerCase();
      const title = (item.title || "").toLowerCase();
      const desc = (item.description || "").toLowerCase();
      const aliases = (item.aliases || []).map(a => a.toLowerCase());
      const hasAlias = aliases.some(a => a.includes(query));

      if (label.includes(query) || title.includes(query) || desc.includes(query) || hasAlias) {
        let score = 50;
        if (label === query) score = 95;
        else if (label.startsWith(query)) score = 80;
        else if (hasAlias) score = 65;
        results.push({
          isApp: false,
          item,
          label: item.label || item.title || id,
          desc: item.description,
          path: getBreadcrumbPath(id),
          score
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    if (results.length === 0) {
      el.launcherContent.innerHTML = `<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4);font-family:var(--font-mono);font-size:13px;">No results for "${escapeHtml(query)}"</div>`;
      return;
    }

    results.slice(0, 60).forEach(res => {
      const row = document.createElement("div");
      row.className = "menu-row";

      const hasSub = !res.isApp && (res.item.kind === "menu" || res.item.provider === "apps" || Object.values(itemsMap).some(i => i.parent === res.item.id));

      row.innerHTML = `
        <div class="menu-row-left">
          ${getMenuIcon(res.item, res.isApp)}
          <div class="menu-row-text">
            <span class="menu-row-label">${escapeHtml(res.label)}</span>
            ${res.path ? `<span class="menu-row-path">${escapeHtml(res.path)}</span>` : ""}
          </div>
        </div>
        ${hasSub ? `<span class="menu-row-chevron">&gt;</span>` : ""}
      `;

      row.addEventListener("click", () => {
        haptic(15);
        if (hasSub) {
          state.searchQuery = "";
          el.launcherSearch.value = "";
          el.btnClearSearch.style.display = "none";
          state.menuNavStack = ["root", res.item.id];
          renderLauncherItems();
        } else {
          triggerMenuAction(res.item, res.isApp);
        }
      });

      el.launcherContent.appendChild(row);
    });
    return;
  }

  // Normal hierarchical navigation
  el.launcherContent.innerHTML = "";

  if (currentMenuId === "root") {
    el.menuNavBreadcrumb.style.display = "none";

    const rootOrder = state.menu.rootOrder || ["apps", "learn", "trigger", "style", "setup", "install", "remove", "update", "about", "system"];
    
    rootOrder.forEach(rootId => {
      const item = itemsMap[rootId] || { id: rootId, label: rootId };
      const row = document.createElement("div");
      row.className = "menu-row";
      const isLeaf = item.action && !item.provider && !Object.values(itemsMap).some(i => i.parent === rootId);

      row.innerHTML = `
        <div class="menu-row-left">
          ${getMenuIcon(item, false)}
          <div class="menu-row-text">
            <span class="menu-row-label">${escapeHtml(item.label || rootId)}</span>
          </div>
        </div>
        ${isLeaf ? "" : `<span class="menu-row-chevron">&gt;</span>`}
      `;

      row.addEventListener("click", () => {
        haptic(15);
        if (isLeaf) {
          triggerMenuAction(item, false);
        } else {
          state.menuNavStack.push(rootId);
          renderLauncherItems();
        }
      });

      el.launcherContent.appendChild(row);
    });
    return;
  }

  // Inside a submenu
  el.menuNavBreadcrumb.style.display = "flex";
  const parentId = state.menuNavStack.length > 1 ? state.menuNavStack[state.menuNavStack.length - 2] : "root";
  const parentItem = itemsMap[parentId] || { label: "Go" };
  const currentItem = itemsMap[currentMenuId] || { label: currentMenuId };

  el.menuBackText.textContent = parentItem.label || "Go";
  el.menuCurrentTitle.textContent = currentItem.label || currentMenuId;

  // If inside "apps"
  if (currentMenuId === "apps" || currentItem.provider === "apps") {
    allApps.forEach(app => {
      const row = document.createElement("div");
      row.className = "menu-row";
      row.innerHTML = `
        <div class="menu-row-left">
          ${getMenuIcon(app, true)}
          <div class="menu-row-text">
            <span class="menu-row-label">${escapeHtml(app.name)}</span>
            ${app.comment ? `<span class="menu-row-desc">${escapeHtml(app.comment)}</span>` : ""}
          </div>
        </div>
      `;
      row.addEventListener("click", () => {
        haptic(20);
        triggerMenuAction(app, true);
      });
      el.launcherContent.appendChild(row);
    });
    return;
  }

  // Render items whose parent === currentMenuId
  const children = Object.values(itemsMap).filter(i => i.parent === currentMenuId);

  if (children.length === 0) {
    el.launcherContent.innerHTML = `<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4);font-family:var(--font-mono);font-size:13px;">No items in this section</div>`;
    return;
  }

  children.forEach(child => {
    const hasSub = child.kind === "menu" || child.provider === "apps" || Object.values(itemsMap).some(i => i.parent === child.id);
    const row = document.createElement("div");
    row.className = "menu-row";
    row.innerHTML = `
      <div class="menu-row-left">
        ${getMenuIcon(child, false)}
        <div class="menu-row-text">
          <span class="menu-row-label">${escapeHtml(child.label || child.id)}</span>
          ${child.description ? `<span class="menu-row-desc">${escapeHtml(child.description)}</span>` : ""}
        </div>
      </div>
      ${hasSub ? `<span class="menu-row-chevron">&gt;</span>` : ""}
    `;

    row.addEventListener("click", () => {
      haptic(15);
      if (hasSub) {
        state.menuNavStack.push(child.id);
        renderLauncherItems();
      } else {
        triggerMenuAction(child, false);
      }
    });

    el.launcherContent.appendChild(row);
  });
}

async function triggerMenuAction(item, isApp) {
  closeLauncher();
  const name = item.name || item.label || item.id;
  showToast(`Running ${name}...`);
  try {
    const wsTarget = state.selectedWorkspaceId || state.desktop?.activeWorkspace?.id || 1;
    if (isApp) {
      await api("/api/menu/launch", {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          type: "app",
          kind: "app",
          workspace: wsTarget,
          tile: state.tileOnLaunch,
          exec: item.exec,
          name: item.name
        })
      });
    } else {
      await api("/api/menu/launch", {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          action: item.action,
          label: item.label,
          workspace: wsTarget,
          tile: state.tileOnLaunch
        })
      });
    }
    showToast(`Launched ${name}`);
    setTimeout(syncDesktopState, 400);
    setTimeout(syncDesktopState, 1200);
  } catch (err) {
    showToast(`Failed: ${err.message}`);
  }
}

// Trackpad & Mouse Interactions
function setupTrackpad() {
  const surface = el.trackpadSurface;

  let lastX = null;
  let lastY = null;
  let touchStartTime = 0;
  let startX = 0;
  let startY = 0;
  let hasMoved = false;
  let lastTapTime = 0;
  let singleTapTimer = null;
  let moveThrottle = 0;
  let isTwoFingerTap = false;
  let lastTwoFingerY = null;
  let longPressTimer = null;
  let didLongPress = false;

  surface.addEventListener("touchstart", (e) => {
    didLongPress = false;
    clearTimeout(longPressTimer);

    if (e.touches.length === 1) {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      lastX = t.clientX;
      lastY = t.clientY;
      touchStartTime = Date.now();
      hasMoved = false;
      isTwoFingerTap = false;

      // Long press (360ms hold) -> Right Click
      longPressTimer = setTimeout(() => {
        if (!hasMoved) {
          didLongPress = true;
          clearTimeout(singleTapTimer);
          singleTapTimer = null;
          lastTapTime = 0;
          haptic(40);
          showToast("Right Click");
          api("/api/input", { method: "POST", body: JSON.stringify({ kind: "click", button: "right" }) }).catch(() => {});
        }
      }, 360);

    } else if (e.touches.length === 2) {
      clearTimeout(singleTapTimer);
      clearTimeout(longPressTimer);
      isTwoFingerTap = true;
      hasMoved = false;
      lastTwoFingerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  }, { passive: true });

  surface.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1 && lastX !== null) {
      const t = e.touches[0];
      const dist = Math.hypot(t.clientX - startX, t.clientY - startY);
      if (dist > 5) {
        hasMoved = true;
        clearTimeout(longPressTimer);
      }

      const dx = (t.clientX - lastX) * 1.85;
      const dy = (t.clientY - lastY) * 1.85;
      lastX = t.clientX;
      lastY = t.clientY;

      const now = Date.now();
      if (now - moveThrottle > 14) {
        moveThrottle = now;
        api("/api/input", {
          method: "POST",
          body: JSON.stringify({ kind: "move", dx, dy })
        }).catch(() => {});
      }
    } else if (e.touches.length === 2 && lastTwoFingerY !== null) {
      clearTimeout(longPressTimer);
      hasMoved = true;
      isTwoFingerTap = false;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const dy = cy - lastTwoFingerY;
      if (Math.abs(dy) > 6) {
        const scrollDelta = dy > 0 ? -1 : 1;
        lastTwoFingerY = cy;
        api("/api/input", {
          method: "POST",
          body: JSON.stringify({ kind: "scroll", dy: scrollDelta })
        }).catch(() => {});
      }
    }
  }, { passive: true });

  surface.addEventListener("touchend", (e) => {
    clearTimeout(longPressTimer);

    if (didLongPress) {
      didLongPress = false;
      lastX = null;
      lastY = null;
      return;
    }

    // Two-finger tap -> Right Click!
    if (isTwoFingerTap && !hasMoved) {
      isTwoFingerTap = false;
      clearTimeout(singleTapTimer);
      singleTapTimer = null;
      lastTapTime = 0;
      haptic(35);
      showToast("Right Click");
      api("/api/input", { method: "POST", body: JSON.stringify({ kind: "click", button: "right" }) }).catch(() => {});
      lastX = null;
      lastY = null;
      return;
    }
    isTwoFingerTap = false;

    const elapsed = Date.now() - touchStartTime;
    if (!hasMoved && elapsed < 280) {
      const now = Date.now();
      if (now - lastTapTime < 280) {
        // DOUBLE TAP -> RIGHT CLICK!
        clearTimeout(singleTapTimer);
        singleTapTimer = null;
        lastTapTime = 0;
        haptic(35);
        showToast("Right Click");
        api("/api/input", { method: "POST", body: JSON.stringify({ kind: "click", button: "right" }) }).catch(() => {});
      } else {
        // Single tap -> Left Click after small delay to detect double tap
        lastTapTime = now;
        clearTimeout(singleTapTimer);
        singleTapTimer = setTimeout(() => {
          haptic(15);
          api("/api/input", { method: "POST", body: JSON.stringify({ kind: "click", button: "left" }) }).catch(() => {});
        }, 220);
      }
    }

    lastX = null;
    lastY = null;
    lastTwoFingerY = null;
  });
}

// Special Keys Buttons
el.specialKeyBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.key;
    haptic(12);
    api("/api/input", { method: "POST", body: JSON.stringify({ kind: "key", key }) })
      .then(() => showToast(`Sent ${btn.textContent}`))
      .catch(err => showToast(err.message));
  });
});

// Quick Send Text to PC Cursor (Auto-growing Textarea & Suggestions)
function autoGrowTypeInput() {
  const input = el.inputTypeText;
  if (!input) return;
  input.style.height = "auto";
  const newH = Math.min(Math.max(input.scrollHeight, 48), 140);
  input.style.height = `${newH}px`;
}

el.inputTypeText?.addEventListener("input", autoGrowTypeInput);

el.inputTypeText?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    el.formTypeToPc?.requestSubmit();
  }
});

el.formTypeToPc?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = el.inputTypeText?.value;
  if (!text) return;
  haptic(15);
  try {
    await api("/api/input", { method: "POST", body: JSON.stringify({ kind: "type", text }) });
    showToast("Sent to PC cursor");
    if (el.inputTypeText) {
      el.inputTypeText.value = "";
      el.inputTypeText.style.height = "48px";
      el.inputTypeText.blur();
    }
  } catch (err) {
    showToast("Failed: " + err.message);
  }
});


// Controls Tab: Audio, Media, Tools, Power
let isUserDraggingVolume = false;
let volDebounceTimer = null;

async function loadControlsState() {
  try {
    const data = await api("/api/controls");
    if (!data.ok) return;
    if (el.volumeBadge && data.volume !== undefined) el.volumeBadge.textContent = `${data.volume}%`;
    if (el.volSlider && !isUserDraggingVolume && data.volume !== undefined) el.volSlider.value = data.volume;
    if (el.btnVolMute && data.muted !== undefined) {
      el.btnVolMute.classList.toggle("muted", data.muted);
      if (el.volMuteIcon) el.volMuteIcon.textContent = data.muted ? "󰝟" : "󰕾";
    }
    if (data.idle !== undefined) {
      const btn = document.querySelector('.toggle-btn[data-action="toggle-idle"]');
      if (btn) btn.classList.toggle("active", Boolean(data.idle));
    }
    if (data.nightlight !== undefined) {
      const btn = document.querySelector('.toggle-btn[data-action="toggle-nightlight"]');
      if (btn) btn.classList.toggle("active", Boolean(data.nightlight));
    }
    if (data.dnd !== undefined) {
      const btn = document.querySelector('.toggle-btn[data-action="toggle-notifications"]');
      if (btn) btn.classList.toggle("active", Boolean(data.dnd));
    }
  } catch {}
}

async function sendControlAction(action, payload = {}) {
  haptic(20);
  try {
    const res = await api("/api/controls", {
      method: "POST",
      body: JSON.stringify({ action, ...payload })
    });
    if (res && res.ok) {
      if (res.volume !== undefined && el.volumeBadge) el.volumeBadge.textContent = `${res.volume}%`;
      if (res.volume !== undefined && el.volSlider && !isUserDraggingVolume) el.volSlider.value = res.volume;
      if (res.muted !== undefined && el.btnVolMute) {
        el.btnVolMute.classList.toggle("muted", res.muted);
        if (el.volMuteIcon) el.volMuteIcon.textContent = res.muted ? "󰝟" : "󰕾";
      }
    }
    return res;
  } catch (err) {
    showToast(err.message || "Action failed");
  }
}

// Volume Controls
if (el.volSlider) {
  el.volSlider.addEventListener("input", () => {
    isUserDraggingVolume = true;
    if (el.volumeBadge) el.volumeBadge.textContent = `${el.volSlider.value}%`;
    clearTimeout(volDebounceTimer);
    volDebounceTimer = setTimeout(() => {
      sendControlAction("volume-set", { volume: Number(el.volSlider.value) });
    }, 150);
  });

  el.volSlider.addEventListener("change", () => {
    isUserDraggingVolume = false;
    sendControlAction("volume-set", { volume: Number(el.volSlider.value) });
  });
}

if (el.btnVolMute) {
  el.btnVolMute.addEventListener("click", () => {
    sendControlAction("toggle-mute");
  });
}

el.quickVolBtns?.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.volStep) {
      sendControlAction("volume-step", { step: Number(btn.dataset.volStep) });
    } else if (btn.dataset.volSet) {
      sendControlAction("volume-set", { volume: Number(btn.dataset.volSet) });
    }
  });
});

// Quick Tools Toggles
el.toggleBtns?.forEach(btn => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.action;
    await sendControlAction(action);
    const name = btn.querySelector(".toggle-name")?.textContent || "Action";
    showToast(`${name} toggled`);
    setTimeout(loadControlsState, 350);
  });
});

// Power & System Actions
el.powerBtns?.forEach(btn => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.powerAction;
    const label = btn.querySelector(".power-label")?.textContent || "Action";

    if (action === "poweroff") {
      if (!confirm("Are you sure you want to shut down your PC?")) return;
    } else if (action === "reboot") {
      if (!confirm("Are you sure you want to reboot your PC?")) return;
    }

    await sendControlAction(action);
    showToast(`${label} executed on PC`);
  });
});

// PWA Service Worker Registration & Instant Update
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.update().catch(() => {});
    }).catch(() => {});
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

// App Initialization
function init() {
  setupTrackpad();
  api("/api/theme").then((data) => {
    if (data?.ok && data.theme) applyTheme(data.theme);
  }).catch(() => {});
  connectSSE();
  syncDesktopState();
  // Poll fallback: only while the SSE stream is down
  setInterval(() => {
    if (!state.sseActive) syncDesktopState();
  }, 2500);
}

init();
