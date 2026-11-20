"use strict";
/* Shift Shift — desktop main process.
   Tray / menu-bar app. No window on launch. A global hotkey toggles a
   small always-on-top panel that shows the saved Main Eventer events.
   Sign-in is Google OAuth in the system browser with a localhost
   redirect (the desktop-app flow). No secrets are printed or logged.
   (Renamed from Sideshow in v0.1.13. The IPC channels still say
   "sideshow:" and the settings/token files still say "sideshow-":
   both are internal only, and renaming them would drop every
   existing user's settings and sign-in for no user-visible gain.) */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, clipboard, safeStorage, nativeImage, Notification, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const position = require("./position.js");
const bubbleOptions = require("./bubble-options.js");
const { reminderFireMs } = require("./reminder-time.js");
const { DEFAULT_THEME, themeById, themeIconFile } = require("./theme-icons.js");
const { migrateLegacyUserData } = require("./migrate-userdata.js");
const extensionServer = require("./extension-server.js");
const { autoUpdater } = require("electron-updater");

const DEFAULT_HOTKEY = "CommandOrControl+Shift+E";
const OAUTH_PORT = 53682;
/* Help page: GitHub Pages serving docs/ from main. */
const HELP_URL = "https://kmberry1989.github.io/sideshow/";
const TOKEN_FILE = "sideshow-token.json";
const SETTINGS_FILE = "sideshow-settings.json";

/* ---------- browser-extension local server ----------
   Loopback-only HTTP on 127.0.0.1:53683, serving the merged event
   list to the companion browser extension (see extension-server.js).
   The pairing token is random per launch and shown in Settings →
   General; the extension pastes it once and sends it as a header.
   The event list comes from the renderer (it owns the merge/dedup);
   until the first push arrives, the server falls back to the events
   cache file in userData, marked cached. */
let pairingToken = null;
let extensionServerHandle = null;
let extensionEvents = [];
let extensionEventsUpdatedAt = 0;

function extensionEventsPayload() {
  if (extensionEvents.length) {
    return { events: extensionEvents, cached: false, updatedAt: extensionEventsUpdatedAt };
  }
  try {
    const raw = fs.readFileSync(eventsCachePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.events)) {
      return { events: parsed.events.slice(0, 200), cached: true, updatedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0 };
    }
  } catch (e) { /* no cache yet */ }
  return { events: [], cached: true, updatedAt: 0 };
}

async function startExtensionServer() {
  pairingToken = extensionServer.generatePairingToken();
  try {
    extensionServerHandle = await extensionServer.createExtensionServer({
      token: pairingToken,
      getEvents: extensionEventsPayload,
      getStatus: () => ({ version: app.getVersion(), events: extensionEventsPayload().events.length }),
    });
  } catch (e) {
    /* Port taken (another copy running?): the bubble still works,
       the extension just cannot connect. */
    extensionServerHandle = null;
  }
}

function stopExtensionServer() {
  if (extensionServerHandle && extensionServerHandle.server) {
    try { extensionServerHandle.server.close(); } catch (e) { /* already closed */ }
    extensionServerHandle = null;
  }
}

let tray = null;
let panel = null;
let settingsWindow = null;
let panelVisibleBeforeSettings = false; /* restore the bubble's visibility when settings closes */
let config = null;
let oauthServer = null;
let oauthState = null;
let oauthVerifier = null;
let settings = {};
let currentHotkey = DEFAULT_HOTKEY;
/* Effective motion for the panel fade ("full" | "reduced" | "off").
   The renderer computes it from the user's motion setting plus the
   OS reduced-motion preference and tells main via IPC. Defaults to
   full; a missing or late value never blocks showing the panel. */
let effectiveMotion = "full";

/* Gesture summon (global mouse hook). Loaded lazily so a missing
   native module never breaks the app — the hotkey still works. */
let gesture = null;
try {
  gesture = require("./gesture.js");
} catch (e) {
  gesture = null;
}

/* Double-tap summon (global keyboard hook) and long-click summon
   (global mouse hook). Same lazy pattern as the gesture module —
   a missing native module never breaks the app. */
let doubletap = null;
try {
  doubletap = require("./doubletap.js");
} catch (e) {
  doubletap = null;
}
let longclick = null;
try {
  longclick = require("./longclick.js");
} catch (e) {
  longclick = null;
}

/* ---------- settings (hotkey + gesture), stored in userData ---------- */

function settingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (e) { /* no settings yet */ }
  return {};
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings), "utf8");
  } catch (e) { /* settings not persisted */ }
}

/* ---------- hotkey ---------- */

/* An Electron accelerator needs at least one modifier plus one key. */
function isValidAccelerator(acc) {
  if (typeof acc !== "string" || !acc) return false;
  const mods = ["CommandOrControl", "CmdOrCtrl", "Command", "Cmd", "Control", "Ctrl", "Alt", "Option", "Shift", "Super", "Meta"];
  const parts = acc.split("+");
  const hasMod = parts.some((p) => mods.indexOf(p) >= 0);
  const keys = parts.filter((p) => mods.indexOf(p) < 0);
  return hasMod && keys.length === 1 && keys[0].length > 0;
}

/* Register a new hotkey, keeping the old one if the new one fails
   (invalid, or already taken by the system/another app). */
function registerHotkey(acc) {
  if (!isValidAccelerator(acc)) return false;
  globalShortcut.unregister(currentHotkey);
  const ok = globalShortcut.register(acc, requestToggle);
  if (!ok) {
    globalShortcut.register(currentHotkey, requestToggle);
    return false;
  }
  currentHotkey = acc;
  return true;
}

function applyGesture() {
  if (!gesture || !gesture.available) return;
  gesture.setGesture(settings.gesture || null, requestToggle);
}

/* Double-tap summon: a lone modifier key tapped twice. Default is
   Shift; the user can pick another modifier in settings. */
function applyDoubleTap() {
  if (!doubletap || !doubletap.available) return;
  doubletap.setKey(settings.doubleTapKey || "Shift", requestToggle);
}

/* Long-click summon: press and hold one mouse button. Off by
   default; the user records the button + hold length in settings. */
function applyLongClick() {
  if (!longclick || !longclick.available) return;
  longclick.setConfig(settings.longClick || null, requestToggle);
}

function configPaths() {
  return [
    path.join(app.getPath("userData"), "firebase-config.json"),
    path.join(__dirname, "firebase-config.json"),
  ];
}

function loadConfig() {
  for (const p of configPaths()) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.firebase && parsed.firebase.projectId) return parsed;
    } catch (e) { /* missing or unreadable; try next */ }
  }
  return null;
}

function configStatus() {
  const fb = config && config.firebase;
  const hasFirebase = !!(fb && fb.apiKey && fb.authDomain && fb.projectId && fb.appId);
  const oa = config && config.googleOAuth;
  const hasOAuth = !!(oa && oa.clientId && oa.clientSecret);
  return { hasConfig: hasFirebase, hasOAuth };
}

function tokenPath() {
  return path.join(app.getPath("userData"), TOKEN_FILE);
}

function storeRefreshToken(refreshToken) {
  try {
    let value = refreshToken;
    if (safeStorage.isEncryptionAvailable()) {
      value = safeStorage.encryptString(refreshToken).toString("base64");
    }
    fs.writeFileSync(tokenPath(), JSON.stringify({ v: 1, enc: safeStorage.isEncryptionAvailable(), token: value }), "utf8");
  } catch (e) { /* token not persisted; sign-in stays session-only */ }
}

function readRefreshToken() {
  try {
    const data = JSON.parse(fs.readFileSync(tokenPath(), "utf8"));
    if (!data || !data.token) return null;
    if (data.enc && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(data.token, "base64"));
    }
    return data.token;
  } catch (e) { return null; }
}

function clearRefreshToken() {
  try { fs.unlinkSync(tokenPath()); } catch (e) { /* already gone */ }
  cachedAccessToken = null;
}

/* Revoke the stored Google refresh token at Google, then clear it
   locally. Best-effort: never throws, never blocks sign-in.
   Called before a fresh sign-in so Google issues a new refresh
   token carrying the current scopes (including calendar.readonly);
   without this, Google may reuse the old token, which was granted
   before the calendar scope existed, and Calendar calls fail with
   scope-missing. Also used on sign-out so the token is invalidated
   server-side, not just deleted locally. */
async function revokeRefreshToken() {
  const token = readRefreshToken();
  clearRefreshToken();
  if (!token) return;
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch (e) { /* revoke is best-effort; sign-in proceeds anyway */ }
}

/* Frameless + transparent window: no window chrome, no rectangular
   frame, no solid background — just the bubble tree floating on the
   desktop, with the desktop showing through behind and around it.
   The renderer makes transparent areas click-through (via
   sideshow:ignore-mouse) so clicks outside the bubble reach the
   desktop. The bubble stays open until dismissed (x button or
   re-summon); it no longer hides on click-away (v0.1.6). The
   bubble itself is the hit area and the drag handle (any spot on
   the panel, via sideshow:drag-start / sideshow:drag-move). */
function createPanel() {
  panel = new BrowserWindow({
    width: panelWidth(),
    height: 560,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  panel.loadFile(path.join(__dirname, "renderer", "index.html"));
  /* No blur-hide: the bubble stays open until dismissed (x button,
     re-summon, or quit). Auto-hide on click-away was removed in v0.1.6
     at the user's request. */
  panel.on("closed", () => { panel = null; });
}

/* ---------- settings window ---------- */

/* Settings lives in its own window: a normal framed, opaque,
   resizable window — not the frameless transparent bubble. The
   bubble stays open beside it as a live preview of appearance
   changes. Single instance: opening it again just focuses it.
   Centered on the display with the cursor. */
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  /* Remember whether the bubble was showing, and show it as the
     preview if it was hidden. */
  panelVisibleBeforeSettings = !!(panel && panel.isVisible());
  if (panel && !panel.isVisible()) showPanel();
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;
  const w = 480, h = 700;
  settingsWindow = new BrowserWindow({
    width: w,
    height: h,
    title: "Shift Shift Settings",
    icon: themeIconAbsPath(),
    show: false,
    frame: true,
    transparent: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWindow.setPosition(
    Math.round(area.x + Math.max(0, (area.width - w) / 2)),
    Math.round(area.y + Math.max(0, (area.height - h) / 2))
  );
  settingsWindow.loadFile(path.join(__dirname, "renderer", "settings.html"));
  settingsWindow.once("ready-to-show", () => { if (settingsWindow) settingsWindow.show(); });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
    notifySettingsWindow(false);
    /* Restore the bubble to how it was before settings opened:
       hidden again if it was hidden, untouched if it was showing. */
    if (!panelVisibleBeforeSettings) hidePanel();
  });
  notifySettingsWindow(true);
}

/* Tell the bubble whether the settings window is open. The bubble
   is the live preview while settings are open, so its idle
   auto-dismiss must not fire then. */
function notifySettingsWindow(open) {
  try {
    if (panel && !panel.isDestroyed()) panel.webContents.send("sideshow:settings-window", !!open);
  } catch (e) { /* panel gone */ }
}

function closeSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
}

/* Send a message to every renderer (bubble + settings window). Used
   for sign-in results, which can start in either window. */
function sendToAllRenderers(channel, data) {
  [panel, settingsWindow].forEach((win) => {
    try {
      if (win && !win.isDestroyed()) win.webContents.send(channel, data);
    } catch (e) { /* window gone */ }
  });
}

/* Live preview: a settings change in the settings window applies to
   the visible bubble at once. Main broadcasts the changed key; the
   bubble renderer reloads that setting and re-applies it. */
function broadcastSettingsChange(key) {
  try {
    if (panel && !panel.isDestroyed()) panel.webContents.send("sideshow:settings-changed", key);
  } catch (e) { /* panel gone */ }
}

function togglePanel() {
  if (!panel) return;
  if (panel.isVisible()) { hidePanel(); return; }
  showPanel();
}

/* Summon guard: several summon sources can fire on one physical
   interaction (e.g. a long hold matching both the gesture and the
   long-click). Ignore a second toggle within 300 ms so the panel
   does not show and immediately hide again. */
let lastToggleAt = 0;
function requestToggle() {
  const now = Date.now();
  if (now - lastToggleAt < 300) return;
  lastToggleAt = now;
  togglePanel();
}

/* Smooth open/close: fade the window in/out instead of an instant
   appear/disappear. The renderer plays a soft sound on the
   panel-showing / panel-hiding messages. Fade length follows the
   effective motion setting: full ~150ms, reduced ~50ms, off instant. */
let fadeTimer = null;

/* Fade duration in ms for the panel open/close, from the effective
   motion. "off" (0) means show/hide instantly. */
function fadeDurationMs() {
  if (effectiveMotion === "off") return 0;
  if (effectiveMotion === "reduced") return 50;
  return 150;
}

function setPanelOpacity(v) {
  try { if (panel) panel.setOpacity(v); } catch (e) { /* opacity unsupported */ }
}

/* Where the panel opens: the Position setting (follow cursor, a
   fixed corner/center of the cursor's display, or a remembered
   dragged spot). The window height is fitted to the bubble content
   (the renderer reports it) instead of staying at the 560 max —
   that is the fix for the panel landing "way up": the old code
   flipped the whole 560px window above a low cursor, so the bubble
   (at the window's top) sat ~576px above the pointer. */
let panelHeight = position.PANEL_MAX_H; /* fitted height, updated by the renderer */

function positionSetting() {
  return position.normalizePositionSetting(settings.position);
}

/* The panel width from the Position setting (320–560, default 400).
   The window, the positioning/clamping, and the drag clamp all use
   this width; the renderer layout is fluid, so it follows the
   window without a reload. */
function panelWidth() {
  return positionSetting().width;
}

/* Where the panel opens right now, for the current Position setting
   and the cursor's display. Fixed spots anchor to the cursor's
   display work area, so the panel appears on the monitor being used.
   Display "primary" opens on the primary display instead of the
   display with the cursor. */
function computePanelPosition() {
  const cursor = screen.getCursorScreenPoint();
  const p = positionSetting();
  const display = p.display === "primary" ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint(cursor);
  return {
    cursor,
    pos: position.resolvePanelPosition(p.mode, p.custom, cursor, display.workArea, panelHeight, p.width, p.gap),
  };
}

function repositionPanel() {
  if (!panel) return;
  const { pos } = computePanelPosition();
  panel.setPosition(pos.x, pos.y);
}

/* Fit the window height to the bubble content, as reported by the
   renderer. While the panel is visible the position is only clamped
   (never re-anchored), so growing/shrinking the tree does not move
   the panel out from under the pointer. */
function setPanelHeight(h) {
  if (!panel) return;
  const cur = panel.getPosition();
  const display = screen.getDisplayNearestPoint({ x: cur[0], y: cur[1] });
  const nh = position.clampHeight(h, display.workArea.height);
  if (nh === panelHeight) return;
  panelHeight = nh;
  /* setContentSize, not setSize: on Linux setSize is a silent no-op
     for this frameless non-resizable window, while setContentSize
     resizes it. For a frameless window the two are the same size. */
  try { panel.setContentSize(panelWidth(), panelHeight); } catch (e) { /* resize unsupported */ }
  if (panel.isVisible()) {
    const p = panel.getPosition();
    const c = position.clampPosition(p[0], p[1], display.workArea, panelWidth(), panelHeight);
    if (c.x !== p[0] || c.y !== p[1]) panel.setPosition(c.x, c.y);
  }
}

function showPanel() {
  if (!panel) return;
  const { cursor, pos } = computePanelPosition();
  panel.setPosition(pos.x, pos.y);
  /* Start interactive: a tap must land even when the pointer is
     elsewhere — a tray-tap summon on a touchscreen leaves the mouse
     cursor far from the panel, so there is no position to seed
     click-through from and the bubble would stay untappable (touch
     has no hover to flip it back). The renderer enables
     click-through (ignore=true) once the pointer really moves over
     empty space. */
  try { panel.setIgnoreMouseEvents(false); } catch (e) { /* click-through unsupported */ }
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  const dur = fadeDurationMs();
  /* Cursor position relative to the panel, so the renderer can set
     the initial click-through state (the pointer starts near the
     top-left of the window). */
  const relCursor = { x: cursor.x - pos.x, y: cursor.y - pos.y };
  if (dur <= 0) {
    setPanelOpacity(1);
    panel.show();
    panel.focus();
    panel.webContents.send("sideshow:panel-showing", relCursor);
    return;
  }
  setPanelOpacity(0);
  panel.show();
  panel.focus();
  panel.webContents.send("sideshow:panel-showing", relCursor);
  let o = 0;
  const step = 30 / dur;
  fadeTimer = setInterval(() => {
    o += step;
    if (o >= 1) {
      setPanelOpacity(1);
      clearInterval(fadeTimer);
      fadeTimer = null;
    } else {
      setPanelOpacity(o);
    }
  }, 30);
}

function hidePanel() {
  if (!panel || !panel.isVisible()) return;
  panel.webContents.send("sideshow:panel-hiding");
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  const dur = fadeDurationMs();
  if (dur <= 0) {
    setPanelOpacity(1);
    if (panel) panel.hide();
    return;
  }
  let o = 1;
  const step = 30 / dur;
  fadeTimer = setInterval(() => {
    o -= step;
    if (o <= 0) {
      clearInterval(fadeTimer);
      fadeTimer = null;
      setPanelOpacity(1);
      if (panel) panel.hide();
    } else {
      setPanelOpacity(o);
    }
  }, 30);
}

/* Theme icon: the Shift² variant for the saved theme, or the static
   app icon (orange) for Studio/Dark/Light and unknown ids. The tray
   icon is the only runtime-swappable icon — the exe/dock icon is
   baked at build and stays orange. */
function themeIconAbsPath() {
  const f = themeIconFile(settings.theme);
  return path.join(__dirname, "assets", f ? path.join("icons", f) : "icon.png");
}

/* Swap the tray icon (and the Settings window icon, when it is open)
   to the saved theme's icon, re-compositing the badge if one is
   showing. Called at startup and whenever the theme changes. */
function applyThemeIcon() {
  iconB64Cache = null;
  if (tray) updateBadge(lastBadgeCount);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    try {
      const img = nativeImage.createFromPath(themeIconAbsPath());
      if (!img.isEmpty()) settingsWindow.setIcon(img);
    } catch (e) { /* window icon failed; tray still swapped */ }
  }
}

function createTray() {
  const iconPath = themeIconAbsPath();
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Shift Shift");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Shift Shift", click: togglePanel },
    { label: "Sign in", click: () => { togglePanel(); startSignIn(); } },
    { label: "Check for updates", click: () => { checkForUpdates(); } },
    { label: "Help", click: () => { shell.openExternal(HELP_URL); } },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
  /* Tray: single-click toggles (after a short delay so a double-click
     is not also a single-click), double-click toggles at once. Either
     way the panel toggles exactly once. */
  let trayClickTimer = null;
  tray.on("click", () => {
    if (trayClickTimer) return;
    trayClickTimer = setTimeout(() => {
      trayClickTimer = null;
      requestToggle();
    }, 250);
  });
  tray.on("double-click", () => {
    if (trayClickTimer) { clearTimeout(trayClickTimer); trayClickTimer = null; }
    requestToggle();
  });
}

/* ---------- reminders + badge (optional; never blocks the core) ----------

   The renderer sends the saved events (id, name, date YYYY-MM-DD,
   startTime HH:MM) whenever the list changes. Main schedules one
   reminder per event, a configurable lead time before it starts,
   shows a system notification for it, and keeps a badge count of
   upcoming events. Reminders are OFF by default (the options
   principle — the core works with everything off) and can be turned
   on in settings. The badge does not require reminders and reminders
   do not require the badge. If notifications are denied by the OS,
   reminders are skipped silently — the panel still works. */

const REMINDER_FILE = "sideshow-reminders.json";
/* Lead-time list — Kyle's picks: 5, 15, 30, 60 minutes (Nov 10,
   2026) plus 2 hours, 1 day, 2 days, 1 week (Nov 19, 2026).
   It lives in this one constant so changing it is a one-line edit.
   Values are minutes before an event starts that its reminder
   fires. Default 15. Whole-day leads fire at the same wall-clock
   time the day(s) before — see reminderFireMs in
   reminder-time.js (calendar days, not 1440-minute epochs). */
const REMINDER_LEAD_MINUTES = [5, 15, 30, 60, 120, 1440, 2880, 10080];
const REMINDER_LEAD_DEFAULT = 15;
let reminderTimers = [];
let firedReminders = null; /* Set of keys, persisted in userData. */

function remindersEnabled() {
  return settings.reminders === true;
}

/* The lead time in minutes, from the setting, validated against the
   list — an unknown value falls back to the default. */
function reminderLeadMinutes() {
  const v = settings.reminderLeadMinutes;
  if (typeof v === "number" && REMINDER_LEAD_MINUTES.indexOf(v) >= 0) return v;
  return REMINDER_LEAD_DEFAULT;
}

function reminderStorePath() {
  return path.join(app.getPath("userData"), REMINDER_FILE);
}

function loadFiredReminders() {
  if (firedReminders) return firedReminders;
  try {
    const raw = fs.readFileSync(reminderStorePath(), "utf8");
    const arr = JSON.parse(raw);
    firedReminders = new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    firedReminders = new Set();
  }
  return firedReminders;
}

function saveFiredReminders() {
  try {
    fs.writeFileSync(reminderStorePath(), JSON.stringify([...loadFiredReminders()]), "utf8");
  } catch (e) { /* fired list not persisted */ }
}

/* Event start as a Date, or null when date/startTime is missing or
   unparsable. Events without both are skipped for reminders. */
function eventStartMs(ev) {
  if (!ev || !ev.date || !ev.startTime) return null;
  const dp = String(ev.date).split("-");
  const tp = String(ev.startTime).split(":");
  if (dp.length !== 3 || tp.length < 2) return null;
  const d = new Date(+dp[0], +dp[1] - 1, +dp[2], +tp[0], +tp[1]);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function reminderKey(ev, lead, startMs) {
  const id = ev.id || [ev.title, ev.date, ev.startTime].filter(Boolean).join("|");
  return id + "|" + lead + "|" + startMs;
}

function clearReminderTimers() {
  reminderTimers.forEach((t) => { try { clearTimeout(t); } catch (e) { /* already fired */ } });
  reminderTimers = [];
}

/* Schedule (or reschedule) reminders for the given events. One
   reminder per event, at the configured lead time before it starts.
   Only future reminder times are scheduled; past events and
   already-fired reminders are skipped. A restart never re-fires a
   reminder. */
function scheduleReminders(events) {
  clearReminderTimers();
  const now = Date.now();
  const fired = loadFiredReminders();
  if (!remindersEnabled() || !Array.isArray(events)) return;
  const lead = reminderLeadMinutes();
  const leadKey = lead + "m";
  events.forEach((ev) => {
    const startMs = eventStartMs(ev);
    if (startMs == null || startMs <= now) return;
    /* Day-based leads subtract calendar days (same wall-clock
       time), so a 1-day lead still fires at the right time across
       a DST change; minute/hour leads subtract minutes. */
    const fireAt = reminderFireMs(startMs, lead);
    if (fireAt == null || fireAt <= now) return;
    const key = reminderKey(ev, leadKey, startMs);
    if (fired.has(key)) return;
    const delay = fireAt - now;
    if (delay > 2147483647) return; /* setTimeout ceiling (~24.8d) */
    reminderTimers.push(setTimeout(() => fireReminder(ev, leadKey, startMs, key), delay));
  });
}

function fireReminder(ev, lead, startMs, key) {
  const fired = loadFiredReminders();
  if (fired.has(key)) return;
  fired.add(key);
  saveFiredReminders();
  if (!remindersEnabled()) return;
  showReminderNotification(ev, lead, startMs);
}

function reminderTimeText(startMs) {
  const d = new Date(startMs);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let h = d.getHours();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  const m = d.getMinutes();
  return days[d.getDay()] + ", " + months[d.getMonth()] + " " + d.getDate() + ", " + h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
}

function showReminderNotification(ev, lead, startMs) {
  try {
    if (!Notification.isSupported()) return;
    const name = ev.title || "Event";
    const when = reminderTimeText(startMs);
    const note = new Notification({
      title: name,
      body: when,
      silent: settings.sound === false, /* sound off = visual only */
    });
    note.on("click", () => {
      showPanel();
      if (panel) panel.webContents.send("sideshow:open-event", ev.id || null);
    });
    note.show();
    /* The reminder sound is the current sound style's copy sound,
       played by the panel renderer (main has no Web Audio). Sound
       off means the notification stays visual-only. */
    if (settings.sound !== false) {
      try {
        if (panel && !panel.isDestroyed()) panel.webContents.send("sideshow:play-sound");
      } catch (e) { /* panel gone; notification already showed */ }
    }
  } catch (e) { /* notification failed; panel still works */ }
}

/* Badge: number of upcoming events (today or later, with a date set).
   Shown on the tray icon (all platforms), the Mac dock badge, and the
   Windows taskbar badge where the platform supports it. Cleared at 0. */

let iconB64Cache = null;
let lastBadgeCount = 0;
function iconBase64() {
  if (iconB64Cache) return iconB64Cache;
  try {
    iconB64Cache = fs.readFileSync(themeIconAbsPath()).toString("base64");
  } catch (e) {
    iconB64Cache = "";
  }
  return iconB64Cache;
}

function updateBadge(count) {
  const n = Math.max(0, count || 0);
  lastBadgeCount = n;
  try { app.setBadgeCount(n); } catch (e) { /* dock/taskbar badge unsupported */ }
  if (!tray) return;
  try {
    if (n === 0) {
      tray.setImage(nativeImage.createFromPath(themeIconAbsPath()));
      return;
    }
    const label = n > 99 ? "99+" : String(n);
    const b64 = iconBase64();
    if (!b64) return;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
      + '<image href="data:image/png;base64,' + b64 + '" x="0" y="0" width="32" height="32"/>'
      + '<circle cx="24" cy="8" r="8" fill="#c0392b"/>'
      + '<text x="24" y="11.5" font-size="11" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">' + label + "</text></svg>";
    const img = nativeImage.createFromDataURL("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"));
    if (!img.isEmpty()) tray.setImage(img);
    else tray.setImage(nativeImage.createFromPath(themeIconAbsPath())); /* badge raster failed (headless has no SVG rasterizer) — show the theme icon, not a stale one */
  } catch (e) { /* tray badge failed; dock/taskbar badge still applies */ }
}

function upcomingCount(events) {
  if (!Array.isArray(events)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let n = 0;
  events.forEach((ev) => {
    if (!ev || !ev.date) return;
    const dp = String(ev.date).split("-");
    if (dp.length !== 3) return;
    const d = new Date(+dp[0], +dp[1] - 1, +dp[2]);
    if (!isNaN(d.getTime()) && d.getTime() >= today.getTime()) n++;
  });
  return n;
}

/* ---------- in-place updates (electron-updater) ----------
   The app checks its GitHub releases (Kmberry1989/sideshow, see the
   "publish" block in package.json) for a newer version and installs
   it in place — no uninstall, no clean install. Settings, sign-in,
   reminders, and the cached events survive because they live in
   userData, outside the install directory (and the v0.1.13 rename
   migration keeps them across the rename too). Differential
   updates: the NSIS installer carries an embedded blockmap, so the
   updater downloads only the changed blocks — the full installer
   downloads only when there is no cached copy of the current one
   (first auto-update) or the differential fails. Only runs in the
   packaged app; `npm start` skips it (isUpdaterActive is false
   unpackaged). */
function showUpdateNotification(title, body, onClick) {
  try {
    if (!Notification.isSupported()) return;
    const note = new Notification({ title, body });
    if (onClick) note.on("click", onClick);
    note.show();
  } catch (e) { /* notification failed; the update still proceeds */ }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    showUpdateNotification(
      "Shift Shift update available",
      "Version " + (info && info.version ? info.version : "") + " is downloading — it installs when you quit."
    );
  });
  autoUpdater.on("update-downloaded", (info) => {
    showUpdateNotification(
      "Shift Shift update ready",
      "Version " + (info && info.version ? info.version : "") + " is ready. Click here to restart and install it.",
      () => { try { autoUpdater.quitAndInstall(); } catch (e) { /* install on next quit */ } }
    );
  });
  autoUpdater.on("error", () => { /* update check failed; the app still works */ });
}

async function checkForUpdates() {
  if (!app.isPackaged) return { ok: false, error: "not-packaged" };
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) return { ok: false, error: "check-failed" };
    return {
      ok: true,
      available: !!result.isUpdateAvailable,
      version: (result.updateInfo && result.updateInfo.version) || "",
      current: app.getVersion(),
    };
  } catch (e) {
    return { ok: false, error: "check-failed" };
  }
}

/* ---------- Google OAuth (system browser + localhost redirect) ---------- */

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function startSignIn() {
  const st = configStatus();
  if (!st.hasConfig || !st.hasOAuth) {
    sendToAllRenderers("sideshow:config-missing", st);
    return;
  }
  if (oauthServer) return;
  /* Revoke any stored refresh token first, so the new authorization
     issues a fresh one with the current scopes (calendar.readonly). */
  await revokeRefreshToken();
  oauthState = base64url(crypto.randomBytes(16));
  oauthVerifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(oauthVerifier).digest());
  const params = new URLSearchParams({
    client_id: config.googleOAuth.clientId,
    redirect_uri: "http://127.0.0.1:" + OAUTH_PORT + "/callback",
    response_type: "code",
    scope: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
    state: oauthState,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  });
  oauthServer = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1:" + OAUTH_PORT);
      if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      // Capture the PKCE verifier + state BEFORE stopOAuthServer() clears them.
      const savedState = oauthState;
      const savedVerifier = oauthVerifier;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body style=\"font-family:sans-serif;padding:40px\"><h2>Signed in</h2><p>Return to Shift Shift.</p></body></html>");
      stopOAuthServer();
      if (error || !code || state !== savedState) {
        sendToAllRenderers("sideshow:auth-error");
        return;
      }
      exchangeCode(code, savedVerifier);
    } catch (e) {
      stopOAuthServer();
      sendToAllRenderers("sideshow:auth-error");
    }
  });
  oauthServer.listen(OAUTH_PORT, "127.0.0.1", () => {
    shell.openExternal("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
  });
  oauthServer.on("error", () => {
    stopOAuthServer();
    sendToAllRenderers("sideshow:auth-error");
  });
}

function stopOAuthServer() {
  if (oauthServer) { try { oauthServer.close(); } catch (e) {} oauthServer = null; }
  oauthState = null;
  oauthVerifier = null;
}

async function postToken(body) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) return null;
  return res.json();
}

async function exchangeCode(code, verifier) {
  const data = await postToken({
    client_id: config.googleOAuth.clientId,
    client_secret: config.googleOAuth.clientSecret,
    code,
    code_verifier: verifier,
    redirect_uri: "http://127.0.0.1:" + OAUTH_PORT + "/callback",
    grant_type: "authorization_code",
  });
  if (!data || !data.id_token) {
    sendToAllRenderers("sideshow:auth-error");
    return;
  }
  if (data.refresh_token) storeRefreshToken(data.refresh_token);
  sendToAllRenderers("sideshow:auth-token", { idToken: data.id_token });
}

async function refreshIdToken() {
  const refreshToken = readRefreshToken();
  if (!refreshToken || !configStatus().hasOAuth) return null;
  const data = await postToken({
    client_id: config.googleOAuth.clientId,
    client_secret: config.googleOAuth.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!data || !data.id_token) { clearRefreshToken(); return null; }
  if (data.refresh_token) storeRefreshToken(data.refresh_token);
  return data.id_token;
}

/* ---------- Google Calendar (read-only, main process only) ----------

   The access token never leaves main: the renderer asks for calendar
   lists / events over IPC and gets plain JSON back. The stored
   refresh token was granted BEFORE the calendar.readonly scope was
   added, so a refreshed access token only carries that scope after
   the user signs in again (re-consent). Calendar calls that fail
   with 401/403 therefore report "scope-missing" so the renderer can
   show the re-consent note instead of a generic error. */

let cachedAccessToken = null; /* { token, expiresAt } */
async function getAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60000) {
    return cachedAccessToken.token;
  }
  const refreshToken = readRefreshToken();
  if (!refreshToken || !configStatus().hasOAuth) return null;
  const data = await postToken({
    client_id: config.googleOAuth.clientId,
    client_secret: config.googleOAuth.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!data || !data.access_token) return null;
  if (data.refresh_token) storeRefreshToken(data.refresh_token);
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  cachedAccessToken = { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return cachedAccessToken.token;
}

/* One authenticated Calendar API GET. Returns { ok, status, data } —
   data is the parsed JSON body (or null). A null access token means
   the user is not signed in (error "not-signed-in"); 401/403 means
   the token lacks the calendar scope (error "scope-missing"). */
async function gcalGet(url) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "not-signed-in" };
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  } catch (e) {
    return { ok: false, error: "fetch-failed" };
  }
  if (res.status === 401 || res.status === 403) {
    cachedAccessToken = null; /* a 401 may mean the token is stale */
    return { ok: false, error: "scope-missing", status: res.status };
  }
  if (!res.ok) return { ok: false, error: "fetch-failed", status: res.status };
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { ok: true, status: res.status, data };
}

function calendarSetting() {
  const c = settings.calendar;
  if (!c || typeof c !== "object") return { enabled: false, selectedIds: [] };
  return {
    enabled: !!c.enabled,
    selectedIds: Array.isArray(c.selectedIds) ? c.selectedIds.filter((id) => typeof id === "string") : [],
  };
}

function normalizeCalendarSetting(value) {
  const v = (value && typeof value === "object") ? value : {};
  const ids = Array.isArray(v.selectedIds) ? v.selectedIds : [];
  const seen = new Set();
  const selectedIds = [];
  ids.forEach((id) => {
    if (typeof id === "string" && id && !seen.has(id)) { seen.add(id); selectedIds.push(id); }
  });
  return { enabled: !!v.enabled, selectedIds: selectedIds.slice(0, 50) };
}

/* ---------- IPC ---------- */

ipcMain.handle("sideshow:copy", (_e, text) => {
  if (typeof text === "string" && text) clipboard.writeText(text);
  return true;
});

ipcMain.handle("sideshow:hide", () => { hidePanel(); return true; });

ipcMain.handle("sideshow:open-settings", () => { openSettingsWindow(); return true; });
ipcMain.handle("sideshow:open-help", () => { shell.openExternal(HELP_URL); return true; });

/* Create-event shortcut: open a create-event page in the default
   browser. Strict allowlist — only the two pages the shortcut
   offers (Facebook create-event, the studio's Wix Events new-event
   page). Anything else is refused, so the renderer can never be
   used to open an arbitrary URL. */
const CREATE_EVENT_URLS = new Set([
  "https://www.facebook.com/events/create",
  "https://manage.wix.com/dashboard/cf57070b-8114-45e4-95b1-7242bf48c467/events/new",
]);
ipcMain.handle("sideshow:open-external", (_e, url) => {
  if (typeof url !== "string" || !CREATE_EVENT_URLS.has(url)) return false;
  shell.openExternal(url); return true;
});

ipcMain.handle("sideshow:close-settings", () => { closeSettingsWindow(); return true; });

/* Transparent window: the renderer makes transparent areas
   click-through (ignore=true, forwarded so it still gets mousemove)
   and re-enables input over the bubble (ignore=false). */
ipcMain.handle("sideshow:ignore-mouse", (_e, ignore) => {
  try {
    if (panel) panel.setIgnoreMouseEvents(!!ignore, { forward: true });
  } catch (err) { /* click-through unsupported on this platform */ }
  return true;
});

/* Custom drag: any spot on the panel is the drag handle. The
   renderer sends the window position at drag start, then deltas as
   the pointer moves. A click without a move is a click, not a drag.
   The move target is clamped to the work area: an unclamped move
   lets the window slide partly off-screen, so the visible panel
   shrinks instead of moving — it looks like the view is scaling.
   The drag-end save already clamped, but it never moved the window
   to the clamped spot, so the saved spot and the real position
   drifted apart and the next drag started from the wrong place. */
let dragStartPos = null;
ipcMain.handle("sideshow:drag-start", () => {
  dragStartPos = panel ? panel.getPosition() : null;
  return true;
});
ipcMain.handle("sideshow:drag-move", (_e, dx, dy) => {
  if (panel && dragStartPos) {
    const tx = Math.round(dragStartPos[0] + (dx || 0));
    const ty = Math.round(dragStartPos[1] + (dy || 0));
    const display = screen.getDisplayNearestPoint({ x: tx, y: ty });
    const c = position.clampDragPosition(tx, ty, display.workArea, panelHeight, panelWidth());
    panel.setPosition(c.x, c.y);
  }
  return true;
});
ipcMain.handle("sideshow:drag-end", (_e, moved) => {
  /* "Remember spot": a real drag (not a click) drops the bubble at a
     spot the panel opens at next time. Only in custom mode, and only
     when the drag actually moved — a click on the root bubble just
     toggles the focused event and must not set the spot. The window
     is moved to the clamped spot it saves, so the saved spot and
     the real position always agree. */
  if (moved && panel && positionSetting().mode === "custom") {
    const pos = panel.getPosition();
    const display = screen.getDisplayNearestPoint({ x: pos[0], y: pos[1] });
    const c = position.clampPosition(pos[0], pos[1], display.workArea, panelWidth(), panelHeight);
    if (c.x !== pos[0] || c.y !== pos[1]) panel.setPosition(c.x, c.y);
    const p = positionSetting();
    p.custom = { x: c.x, y: c.y };
    settings.position = p;
    saveSettings();
  }
  dragStartPos = null; return true;
});

ipcMain.handle("sideshow:config-status", () => configStatus());

ipcMain.handle("sideshow:firebase-config", () => {
  const fb = config && config.firebase;
  if (!fb) return null;
  return {
    apiKey: fb.apiKey, authDomain: fb.authDomain, projectId: fb.projectId,
    storageBucket: fb.storageBucket || "", messagingSenderId: fb.messagingSenderId || "", appId: fb.appId,
  };
});

ipcMain.handle("sideshow:sign-in", () => { startSignIn(); return true; });

ipcMain.handle("sideshow:sign-out", () => { revokeRefreshToken(); return true; });

ipcMain.handle("sideshow:refresh-token", async () => refreshIdToken());

ipcMain.handle("sideshow:open-config-folder", () => {
  shell.showItemInFolder(configPaths()[0]);
  return true;
});

ipcMain.handle("sideshow:get-hotkey", () => currentHotkey);

ipcMain.handle("sideshow:set-hotkey", (_e, acc) => {
  if (registerHotkey(acc)) {
    settings.hotkey = acc;
    saveSettings();
    return { ok: true, hotkey: currentHotkey };
  }
  return { ok: false, hotkey: currentHotkey };
});

ipcMain.handle("sideshow:reset-hotkey", () => {
  if (registerHotkey(DEFAULT_HOTKEY)) {
    settings.hotkey = DEFAULT_HOTKEY;
    saveSettings();
    return { ok: true, hotkey: currentHotkey };
  }
  return { ok: false, hotkey: currentHotkey };
});

ipcMain.handle("sideshow:get-gesture", () => {
  const g = settings.gesture || null;
  return { gesture: g, label: gesture ? gesture.describe(g) : "None", available: !!(gesture && gesture.available) };
});

ipcMain.handle("sideshow:record-gesture", async () => {
  if (!gesture || !gesture.available) return { ok: false, error: "Gesture unavailable on this system." };
  /* Pause the long-click detector while recording, so a hold does
     not also fire a long-click summon and hide the panel. */
  if (longclick) longclick.setPaused(true);
  let result;
  try {
    result = await gesture.record();
  } finally {
    if (longclick) longclick.setPaused(false);
  }
  if (result.gesture) {
    settings.gesture = result.gesture;
    saveSettings();
    applyGesture();
    return { ok: true, gesture: result.gesture, label: gesture.describe(result.gesture) };
  }
  return { ok: false, error: result.error || "Could not record a gesture." };
});

ipcMain.handle("sideshow:clear-gesture", () => {
  settings.gesture = null;
  saveSettings();
  applyGesture();
  return true;
});

/* Double-tap summon: which modifier key, tapped twice, summons the
   panel. Default Shift. Only Shift / Control / Alt / Meta are
   accepted — a letter would fire while typing. */
ipcMain.handle("sideshow:get-doubletap-key", () => settings.doubleTapKey || "Shift");

ipcMain.handle("sideshow:set-doubletap-key", (_e, name) => {
  const valid = ["Shift", "Control", "Alt", "Meta"];
  settings.doubleTapKey = valid.indexOf(name) >= 0 ? name : "Shift";
  saveSettings();
  applyDoubleTap();
  return settings.doubleTapKey;
});

ipcMain.handle("sideshow:capture-doubletap-key", async () => {
  if (!doubletap || !doubletap.available) return { ok: false, error: "Double-tap unavailable on this system." };
  const res = await doubletap.captureKey();
  if (res && res.key) {
    settings.doubleTapKey = res.key;
    saveSettings();
    applyDoubleTap();
    return { ok: true, key: res.key };
  }
  return { ok: false, error: (res && res.error) || "Could not capture a key." };
});

/* Long-click summon: press and hold one mouse button. Off by
   default. The user records it by performing the hold; the button
   and the hold length become the setting. While recording, the
   gesture detector is paused so a hold does not also fire a gesture. */
ipcMain.handle("sideshow:get-longclick", () => {
  const cfg = settings.longClick || null;
  return { config: cfg, label: longclick ? longclick.describe(cfg) : "None", available: !!(longclick && longclick.available) };
});

ipcMain.handle("sideshow:record-longclick", async () => {
  if (!longclick || !longclick.available) return { ok: false, error: "Long-click unavailable on this system." };
  if (gesture) gesture.setPaused(true);
  let res;
  try {
    res = await longclick.record();
  } finally {
    if (gesture) gesture.setPaused(false);
  }
  if (res && res.config) {
    settings.longClick = res.config;
    saveSettings();
    applyLongClick();
    return { ok: true, config: res.config, label: longclick.describe(res.config) };
  }
  return { ok: false, error: (res && res.error) || "Could not record a hold." };
});

ipcMain.handle("sideshow:clear-longclick", () => {
  settings.longClick = null;
  saveSettings();
  applyLongClick();
  return true;
});

/* Bubble appearance: "glass" (Liquid Glass, frosted) | "shaded"
   (soft tinted) | "clear" (nearly transparent). Default glass.
   Transparency is a 0–100 level (default 50) for how glassy the
   bubble is. Both persist. */
const APPEARANCES = ["glass", "shaded", "clear"];
ipcMain.handle("sideshow:get-appearance", () => settings.appearance || "glass");
ipcMain.handle("sideshow:set-appearance", (_e, value) => {
  settings.appearance = APPEARANCES.indexOf(value) >= 0 ? value : "glass";
  saveSettings();
  broadcastSettingsChange("appearance");
  return settings.appearance;
});
ipcMain.handle("sideshow:get-transparency", () => {
  const v = settings.transparency;
  return (typeof v === "number" && v >= 0 && v <= 100) ? v : 50;
});
ipcMain.handle("sideshow:set-transparency", (_e, value) => {
  const v = Math.max(0, Math.min(100, Math.round(+value || 0)));
  settings.transparency = v;
  saveSettings();
  broadcastSettingsChange("appearance");
  return v;
});

/* Panel position: where the bubble opens. "cursor" follows the
   pointer (default); the corners/center are fixed spots on the
   cursor's display; "custom" is a spot the user dragged the bubble
   to. The setting also carries the panel width (320–560, default
   400), which display it opens on (cursor's or primary), the gap
   from the cursor (0–64, default 16), and the idle auto-dismiss
   (0 = stay until closed, else seconds). Accepts a mode string
   (the old call — just cycles the mode) or a full object, merged
   over the saved setting. A null custom clears the remembered spot.
   Changing it while the panel is open moves/resizes the panel at
   once, so the user sees the new spot immediately; a width change
   resizes in place (clamped on-screen) instead of re-anchoring. */
ipcMain.handle("sideshow:get-position", () => positionSetting());
ipcMain.handle("sideshow:set-position", (_e, value) => {
  const cur = positionSetting();
  const incoming = (typeof value === "string")
    ? { mode: value }
    : (value && typeof value === "object" ? value : {});
  const merged = Object.assign({}, cur, incoming);
  if (incoming.custom === null) merged.custom = null;
  const p = position.normalizePositionSetting(merged);
  const widthChanged = p.width !== cur.width;
  const modeChanged = p.mode !== cur.mode;
  settings.position = p;
  saveSettings();
  if (panel) {
    if (widthChanged) {
      try { panel.setContentSize(p.width, panelHeight); } catch (err) { /* resize unsupported */ }
      const curPos = panel.getPosition();
      const display = screen.getDisplayNearestPoint({ x: curPos[0], y: curPos[1] });
      const c = position.clampPosition(curPos[0], curPos[1], display.workArea, p.width, panelHeight);
      if (c.x !== curPos[0] || c.y !== curPos[1]) panel.setPosition(c.x, c.y);
    }
    if (modeChanged && panel.isVisible()) repositionPanel();
  }
  broadcastSettingsChange("position");
  return p;
});
ipcMain.on("sideshow:content-height", (_e, h) => { setPanelHeight(h); });

/* Bubble options: scale, font + weight, border color, shadow,
   background color, corner style + roundness, branch alignment,
   gentle pulse, text color, per-field styling. One object, one
   get/set pair; the renderer applies it. Defaults are the current
   look (see bubble-options.js), so the core works with all of them
   unset. Merging a partial update keeps the rest. */
function bubbleSetting() {
  return bubbleOptions.normalizeBubbleOptions(settings.bubble);
}
ipcMain.handle("sideshow:get-bubble-options", () => bubbleSetting());
ipcMain.handle("sideshow:set-bubble-options", (_e, value) => {
  const merged = bubbleOptions.normalizeBubbleOptions(
    Object.assign({}, bubbleSetting(), (value && typeof value === "object") ? value : {})
  );
  settings.bubble = merged;
  saveSettings();
  broadcastSettingsChange("bubble-options");
  return merged;
});

/* Hidden events: ids the user hid with the eye icon. They stay in
   the bank (and in Settings, where the eye shows them again) but do
   not render in the bubble, the calendar view, or the badge /
   reminders. Persisted in settings; the bubble reloads them live. */
function hiddenEventsSetting() {
  const ids = Array.isArray(settings.hiddenEvents) ? settings.hiddenEvents : [];
  const seen = new Set();
  const out = [];
  ids.forEach((id) => {
    if (typeof id === "string" && id && !seen.has(id)) { seen.add(id); out.push(id); }
  });
  return out.slice(0, 500);
}
ipcMain.handle("sideshow:get-hidden-events", () => hiddenEventsSetting());
ipcMain.handle("sideshow:set-hidden-events", (_e, value) => {
  const ids = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  ids.forEach((id) => {
    if (typeof id === "string" && id && !seen.has(id)) { seen.add(id); out.push(id); }
  });
  settings.hiddenEvents = out.slice(0, 500);
  saveSettings();
  broadcastSettingsChange("hidden-events");
  return settings.hiddenEvents;
});

/* Pinned events: ids the user pinned with the pin icon. They stay
   in the bank, but render in the Pinned section at the top of the
   tree instead of their normal place. Persisted in settings; the
   bubble reloads them live. */
function pinnedEventsSetting() {
  const ids = Array.isArray(settings.pinnedEvents) ? settings.pinnedEvents : [];
  const seen = new Set();
  const out = [];
  ids.forEach((id) => {
    if (typeof id === "string" && id && !seen.has(id)) { seen.add(id); out.push(id); }
  });
  return out.slice(0, 500);
}
ipcMain.handle("sideshow:get-pinned-events", () => pinnedEventsSetting());
ipcMain.handle("sideshow:set-pinned-events", (_e, value) => {
  const ids = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  ids.forEach((id) => {
    if (typeof id === "string" && id && !seen.has(id)) { seen.add(id); out.push(id); }
  });
  settings.pinnedEvents = out.slice(0, 500);
  saveSettings();
  broadcastSettingsChange("pinned-events");
  return settings.pinnedEvents;
});

ipcMain.handle("sideshow:get-sound", () => settings.sound !== false);

ipcMain.handle("sideshow:set-sound", (_e, enabled) => {
  settings.sound = !!enabled;
  saveSettings();
  return settings.sound;
});

/* Sound style: which set of synthesized sounds plays. "bubbly" is
   the current set (default); "chime", "click", and "pop" are
   distinct sets for the open / close / copy moments, and v0.1.14
   adds "thud", "sparkle", "zap", and "pluck" — each audibly
   distinct from the rest. The Sound on/off toggle stays the master
   switch — the style only matters while sound is on. */
const SOUND_STYLES = ["bubbly", "chime", "click", "pop", "thud", "sparkle", "zap", "pluck"];
ipcMain.handle("sideshow:get-sound-style", () => {
  return SOUND_STYLES.indexOf(settings.soundStyle) >= 0 ? settings.soundStyle : "bubbly";
});
ipcMain.handle("sideshow:set-sound-style", (_e, value) => {
  settings.soundStyle = SOUND_STYLES.indexOf(value) >= 0 ? value : "bubbly";
  saveSettings();
  broadcastSettingsChange("sound-style");
  return settings.soundStyle;
});

/* Copy all format: "labeled" (default — one labeled line per field,
   "Name: Christmas Ornaments") or "plain" (values only, same order,
   one per line). Controls what Copy all puts on the clipboard. */
const COPY_ALL_FORMATS = ["labeled", "plain"];
ipcMain.handle("sideshow:get-copy-all-format", () => {
  return COPY_ALL_FORMATS.indexOf(settings.copyAllFormat) >= 0 ? settings.copyAllFormat : "labeled";
});
ipcMain.handle("sideshow:set-copy-all-format", (_e, value) => {
  settings.copyAllFormat = COPY_ALL_FORMATS.indexOf(value) >= 0 ? value : "labeled";
  saveSettings();
  broadcastSettingsChange("copy-all-format");
  return settings.copyAllFormat;
});

/* Tooltips on/off. On by default; off suppresses every hover
   tooltip in the bubble and the settings window. */
ipcMain.handle("sideshow:get-tooltips", () => settings.tooltips !== false);
ipcMain.handle("sideshow:set-tooltips", (_e, enabled) => {
  settings.tooltips = !!enabled;
  saveSettings();
  broadcastSettingsChange("tooltips");
  return settings.tooltips;
});

/* Motion: "full" | "reduced" | "off" | null (null = follow the OS).
   The renderer owns the OS preference and sends the effective value
   so the panel fade can follow it too. */
ipcMain.handle("sideshow:get-motion", () => settings.motion || null);

ipcMain.handle("sideshow:set-motion", (_e, value) => {
  const v = ["full", "reduced", "off"].indexOf(value) >= 0 ? value : null;
  settings.motion = v;
  saveSettings();
  broadcastSettingsChange("motion");
  return settings.motion;
});

ipcMain.handle("sideshow:motion-effective", (_e, value) => {
  if (["full", "reduced", "off"].indexOf(value) >= 0) effectiveMotion = value;
  return effectiveMotion;
});

/* Reminders on/off. Turning them off clears any pending timers. */
ipcMain.handle("sideshow:get-reminders", () => remindersEnabled());

ipcMain.handle("sideshow:set-reminders", (_e, enabled) => {
  settings.reminders = !!enabled;
  saveSettings();
  if (!settings.reminders) clearReminderTimers();
  return settings.reminders;
});

/* Reminder lead time: minutes before an event starts that its
   reminder fires. One value from REMINDER_LEAD_MINUTES (5, 15, 30,
   60, 120, 1440, 2880, 10080; default 15); anything else falls
   back to the default. Changing it reschedules — the renderer
   re-sends the event list after a change. */
ipcMain.handle("sideshow:get-reminder-lead", () => reminderLeadMinutes());

ipcMain.handle("sideshow:set-reminder-lead", (_e, value) => {
  const v = REMINDER_LEAD_MINUTES.indexOf(value) >= 0 ? value : REMINDER_LEAD_DEFAULT;
  settings.reminderLeadMinutes = v;
  saveSettings();
  return v;
});

/* Theme: the saved preset theme id (default White, v0.1.14).
   Setting one swaps the tray icon live to that theme's Shift²
   variant; the exe/dock icon is baked at build and stays white.
   A manual accent change does not touch the theme, so the icon
   stays with the theme
   pick. */
ipcMain.handle("sideshow:get-theme", () => (themeById(settings.theme) ? settings.theme : DEFAULT_THEME));

ipcMain.handle("sideshow:set-theme", (_e, id) => {
  const t = themeById(id);
  if (!t) return themeById(settings.theme) ? settings.theme : DEFAULT_THEME;
  settings.theme = t.id;
  saveSettings();
  applyThemeIcon();
  broadcastSettingsChange("theme");
  return settings.theme;
});

/* Accent color: a hex string (e.g. "#a44a24") or null for the
   platform default (blue on Mac, green on Windows). */
ipcMain.handle("sideshow:get-accent", () => settings.accent || null);

ipcMain.handle("sideshow:set-accent", (_e, value) => {
  const v = (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) ? value.toLowerCase() : null;
  settings.accent = v;
  saveSettings();
  broadcastSettingsChange("accent");
  return settings.accent;
});

/* Google Calendar setting: off by default, independent of every
   other setting. { enabled, selectedIds } — selectedIds are the
   calendar ids the user picked in the multi-select picker. */
ipcMain.handle("sideshow:get-calendar", () => calendarSetting());

ipcMain.handle("sideshow:set-calendar", (_e, value) => {
  settings.calendar = normalizeCalendarSetting(value);
  saveSettings();
  broadcastSettingsChange("calendar");
  return settings.calendar;
});

/* The user's calendars, for the multi-select picker. Only id,
   summary, primary and backgroundColor cross into the renderer. */
ipcMain.handle("sideshow:list-calendars", async () => {
  const res = await gcalGet("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  if (!res.ok) return { ok: false, error: res.error || "fetch-failed" };
  const items = (res.data && Array.isArray(res.data.items)) ? res.data.items : [];
  return {
    ok: true,
    calendars: items
      .filter((c) => c && typeof c.id === "string")
      .map((c) => ({ id: c.id, summary: c.summary || c.id, primary: !!c.primary, backgroundColor: c.backgroundColor || "" })),
  };
});

/* Upcoming events from each requested calendar (up to 50 per
   calendar, soonest first). Each event carries its calendarId so the
   renderer can build a stable id. A 401/403 on any calendar means
   the scope was not granted — the whole call reports scope-missing.
   Any other per-calendar failure is skipped; if every calendar
   fails that way the call reports fetch-failed. */
ipcMain.handle("sideshow:get-calendar-events", async (_e, calendarIds) => {
  const ids = Array.isArray(calendarIds) ? calendarIds.filter((id) => typeof id === "string" && id) : [];
  if (!ids.length) return { ok: true, events: [] };
  const timeMin = new Date().toISOString();
  const all = [];
  let otherFailed = false;
  for (const id of ids) {
    const url = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(id) + "/events"
      + "?timeMin=" + encodeURIComponent(timeMin) + "&singleEvents=true&orderBy=startTime&maxResults=50";
    const res = await gcalGet(url);
    if (!res.ok) {
      if (res.error === "scope-missing" || res.error === "not-signed-in") {
        return { ok: false, error: res.error };
      }
      otherFailed = true;
      continue;
    }
    const items = (res.data && Array.isArray(res.data.items)) ? res.data.items : [];
    items.forEach((ev) => {
      if (!ev || typeof ev !== "object") return;
      all.push({
        id: ev.id || "",
        calendarId: id,
        summary: ev.summary || "",
        start: ev.start || {},
        end: ev.end || {},
        location: ev.location || "",
        description: ev.description || "",
        htmlLink: ev.htmlLink || "",
      });
    });
  }
  if (!all.length && otherFailed) return { ok: false, error: "fetch-failed" };
  return { ok: true, events: all };
});

/* The renderer sends the saved events whenever the list changes.
   Main updates the badge count and (re)schedules reminders. */
ipcMain.handle("sideshow:events-updated", (_e, list) => {
  try {
    updateBadge(upcomingCount(list));
    scheduleReminders(list);
  } catch (err) { /* badge/reminders never block the panel */ }
  return true;
});

/* The full merged event list, for the browser-extension server.
   The renderer owns the merge/dedup, so main just keeps the latest
   push in memory and serves it on 127.0.0.1:53683. Hidden events
   are already filtered out by the renderer. */
ipcMain.handle("sideshow:events-full", (_e, list) => {
  if (Array.isArray(list)) {
    extensionEvents = list.slice(0, 200).map((ev) => ({
      id: (ev && ev.id) || "",
      title: (ev && ev.title) || "",
      date: (ev && ev.date) || "",
      startTime: (ev && ev.startTime) || "",
      endTime: (ev && ev.endTime) || "",
      price: (ev && ev.price) || "",
      ages: (ev && ev.ages) || "",
      host: (ev && ev.host) || "",
      location: (ev && ev.location) || "",
      description: (ev && ev.description) || "",
      link: (ev && ev.link) || "",
      source: (ev && ev.source) || "",
    }));
    extensionEventsUpdatedAt = Date.now();
  }
  return true;
});

/* Browser-extension pairing: the per-launch code, and whether the
   loopback server is up. The code is shown in Settings → General;
   the extension pastes it once and stores it. */
ipcMain.handle("sideshow:get-extension-token", () => ({
  code: pairingToken ? extensionServer.formatPairingToken(pairingToken) : "",
  running: !!extensionServerHandle,
}));

ipcMain.handle("sideshow:get-extension-status", () => ({
  running: !!extensionServerHandle,
  port: extensionServer.EXTENSION_PORT,
  events: extensionEventsPayload().events.length,
}));

/* In-place updates: manual check from the tray menu or Settings →
   General. The launch check runs once, 30 s after startup. */
ipcMain.handle("sideshow:check-for-updates", async () => checkForUpdates());
ipcMain.handle("sideshow:get-version", () => app.getVersion());

/* Cached events: the last successfully fetched merged event list
   (Main Eventer + Google Calendar), saved by the renderer whenever
   live data arrives. When a fetch fails or there is no network, the
   renderer renders from this cache and says so — stale data is
   never mistaken for live. */
const EVENTS_CACHE_FILE = "sideshow-events-cache.json";
function eventsCachePath() {
  return path.join(app.getPath("userData"), EVENTS_CACHE_FILE);
}
ipcMain.handle("sideshow:get-cached-events", () => {
  try {
    const raw = fs.readFileSync(eventsCachePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.events)) {
      return { savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0, events: parsed.events.slice(0, 200) };
    }
  } catch (e) { /* no cache yet */ }
  return null;
});
ipcMain.handle("sideshow:set-cached-events", (_e, value) => {
  try {
    if (value && Array.isArray(value.events)) {
      fs.writeFileSync(eventsCachePath(), JSON.stringify({ savedAt: Date.now(), events: value.events.slice(0, 200) }), "utf8");
      return true;
    }
  } catch (e) { /* cache not persisted */ }
  return false;
});

/* ---------- app lifecycle ---------- */

app.whenReady().then(() => {
  /* Rename migration (v0.1.13): the package name changed, so
     userData moved. Copy the settings / token / reminders / cache
     from the old Sideshow directory before anything reads them —
     without this the rename would silently sign the user out. */
  try {
    migrateLegacyUserData(app.getPath("userData"), app.getPath("appData"));
  } catch (e) { /* migration is best-effort; the app still starts */ }
  config = loadConfig();
  settings = loadSettings();
  if (settings.hotkey && isValidAccelerator(settings.hotkey)) {
    currentHotkey = settings.hotkey;
  }
  createPanel();
  createTray();
  applyThemeIcon(); /* saved theme's tray icon, from first launch */
  startExtensionServer();
  setupAutoUpdater();
  /* Launch update check, once, after the app has settled — not on
     the first paint, so a slow network never delays the bubble. */
  setTimeout(() => { checkForUpdates(); }, 30000);
  globalShortcut.register(currentHotkey, requestToggle);
  applyGesture();
  applyDoubleTap();
  applyLongClick();
  if (process.platform === "darwin") app.dock.hide();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (gesture) gesture.stop();
  if (doubletap) doubletap.stop();
  if (longclick) longclick.stop();
  stopOAuthServer();
  stopExtensionServer();
});

app.on("window-all-closed", (e) => { e.preventDefault(); });
