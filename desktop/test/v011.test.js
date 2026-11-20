"use strict";
/* v0.1.11 batch: static checks for the pieces that need Electron to
   run live (sound styles, tooltips, idle auto-dismiss, calendar
   border inset). Dragging was removed in v0.1.16 — the drag tests
   that used to live here are gone with it (see test/no-drag.test.js
   for the removal assertions). The live behavior is verified
   headlessly in the smoke run; these tests pin the wiring so it
   cannot silently drift. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const mainJs = read(path.join(DESKTOP, "main.js"));
const preloadJs = read(path.join(DESKTOP, "preload.js"));
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));
const stylesCss = read(path.join(DESKTOP, "renderer", "styles.css"));
const settingsHtml = read(path.join(DESKTOP, "renderer", "settings.html"));

test("calendar border is inset inside the frame on all four sides", () => {
  /* The border lines sat on the window's extreme edge, so the right
     and bottom lines were lost on some platforms while the corners
     (curving inward) still showed. A 2px margin puts all four lines
     inside the frame. */
  assert.ok(stylesCss.includes(".calendar-view {"), "styles must define .calendar-view");
  const block = stylesCss.slice(stylesCss.indexOf(".calendar-view {"));
  assert.ok(block.includes("margin: 2px;"), "calendar view must be inset 2px from the frame");
  assert.ok(block.includes("border: 1.5px solid"), "calendar view must keep its border");
});

test("dragging is disabled: no drag IPC in main, no drag state anywhere", () => {
  /* v0.1.16: drag-to-move is gone entirely (Kyle's call — the scale
     issue persisted through two fixes). The full removal assertions
     live in test/no-drag.test.js; this test pins the two spots
     this file used to cover (the main-process drag handlers and
     the hover-scale guard). */
  for (const ch of ["sideshow:drag-start", "sideshow:drag-move", "sideshow:drag-end"]) {
    assert.ok(!mainJs.includes('ipcMain.handle("' + ch + '"'), "main must not handle " + ch);
    assert.ok(!preloadJs.includes(ch), "preload must not expose " + ch);
  }
  assert.ok(!rendererJs.includes("is-dragging"), "renderer must not mark a drag");
  assert.ok(!stylesCss.includes("is-dragging"), "styles must carry no drag rules");
  assert.ok(!stylesCss.includes("#bubbleView.is-dragging"), "no drag-scoped hover suppression may remain");
});

test("sound styles: eight distinct sets, Bubbly default, sample on change", () => {
  for (const style of ["bubbly", "chime", "click", "pop", "thud", "sparkle", "zap", "pluck"]) {
    assert.ok(rendererJs.includes(style + ": {"), "renderer must define the " + style + " sound set");
  }
  assert.ok(mainJs.includes('const SOUND_STYLES = ["bubbly", "chime", "click", "pop", "thud", "sparkle", "zap", "pluck"];'),
    "main must validate all eight sound styles");
  assert.ok(rendererJs.includes('let soundStyle = "bubbly"'), "default sound style must be Bubbly");
  assert.ok(rendererJs.includes("function playStyled("), "sounds must go through the style table");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-sound-style"'), "main must handle get-sound-style");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:set-sound-style"'), "main must handle set-sound-style");
  assert.ok(preloadJs.includes('getSoundStyle: () => ipcRenderer.invoke("sideshow:get-sound-style")'),
    "preload must expose getSoundStyle");
  assert.ok(preloadJs.includes('setSoundStyle: (value) => ipcRenderer.invoke("sideshow:set-sound-style", value)'),
    "preload must expose setSoundStyle");
  assert.ok(settingsHtml.includes('id="soundStyleBtn"'), "settings must have a Sound style button");
  /* The four sets must differ: chime is sine and long, click is
     square and short, pop drops in pitch. */
  assert.ok(rendererJs.includes('"square"'), "Click set must use square waves");
  assert.ok(rendererJs.includes("[900, 250,"), "Pop set must drop in pitch on copy");
  /* v0.1.14: four more, each audibly distinct from the first four
     and from each other — Thud is low and drum-like, Sparkle is
     very high and short, Zap is the only sawtooth, Pluck is a
     flat mid-tone triangle (mellower than Click's square). */
  assert.ok(rendererJs.includes("[220, 110,"), "Thud copy must be low and dropping");
  assert.ok(rendererJs.includes("[2600, 3600,"), "Sparkle copy must be very high");
  assert.ok(rendererJs.includes('"sawtooth"'), "Zap set must use sawtooth waves");
  assert.ok(rendererJs.includes("[900, 900,"), "Pluck copy must be flat and mid-tone");
  /* Every style defines all four moments + tick, and every style
     has a label and a cycle entry. */
  for (const style of ["bubbly", "chime", "click", "pop", "thud", "sparkle", "zap", "pluck"]) {
    assert.ok(rendererJs.includes(style + ": {"), "renderer must define the " + style + " sound set");
  }
  assert.ok(rendererJs.includes('const SOUND_STYLE_CYCLE = ["bubbly", "chime", "click", "pop", "thud", "sparkle", "zap", "pluck"];'),
    "the sound cycle must include all eight styles");
});

test("tooltips: native titles, a disable setting, and coverage of the interactive elements", () => {
  assert.ok(rendererJs.includes("function setTitle("), "renderer must have setTitle");
  assert.ok(rendererJs.includes("function applyTooltips("), "renderer must have applyTooltips");
  assert.ok(rendererJs.includes('let tooltipsOn = true'), "tooltips must default on");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-tooltips"'), "main must handle get-tooltips");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:set-tooltips"'), "main must handle set-tooltips");
  assert.ok(preloadJs.includes('getTooltips: () => ipcRenderer.invoke("sideshow:get-tooltips")'),
    "preload must expose getTooltips");
  assert.ok(settingsHtml.includes('id="tooltipsBtn"'), "settings must have a Tooltips button");
  /* Coverage: header buttons, value bubbles, Copy all, eye, chips,
     week entries, settings tabs and controls. */
  for (const tip of ['"Settings"', '"Copy name"', '"Copy all details"', '"Hide event"', '"Close"']) {
    assert.ok(rendererJs.includes(tip) || read(path.join(DESKTOP, "renderer", "index.html")).includes("data-tip=" + tip),
      "tooltip must exist: " + tip);
  }
  assert.ok(rendererJs.includes('setTitle(vb, "Copy "'), "value bubbles must get Copy tooltips");
  assert.ok(rendererJs.includes('setTitle(row, eventTitle(ev))'), "week entries must get tooltips");
  assert.ok(rendererJs.includes('setTitle(chip, eventTitle(ev))'), "calendar chips must get tooltips");
});

test("idle auto-dismiss: idle-based, fades, guarded, labeled idle", () => {
  assert.ok(rendererJs.includes("function resetIdleTimer("), "renderer must have resetIdleTimer");
  assert.ok(rendererJs.includes("function clearIdleTimer("), "renderer must have clearIdleTimer");
  assert.ok(rendererJs.includes('window.sideshow.hide()'), "idle expiry must hide through the normal fade path");
  assert.ok(rendererJs.includes("settingsWindowOpen"), "idle dismiss must know when settings are open");
  assert.ok(rendererJs.includes("onSettingsWindow"), "renderer must listen for the settings window state");
  assert.ok(mainJs.includes('panel.webContents.send("sideshow:settings-window"'), "main must tell the bubble when settings open/close");
  assert.ok(preloadJs.includes("onSettingsWindow"), "preload must expose onSettingsWindow");
  assert.ok(settingsHtml.includes('id="dismissBtn"'), "settings must have a Dismiss when idle button");
  assert.ok(settingsHtml.includes("Dismiss when idle"), "the setting must say idle, not mouse-leaves");
  /* Activity resets the clock: pointer, click, key, input, scroll. */
  assert.ok(rendererJs.includes('"pointermove", "pointerdown", "click", "keydown", "input", "wheel"'),
    "activity listeners must cover pointer, click, key, input, scroll");
});

test("Copy all format setting: Labeled default, Plain choice, persisted", () => {
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-copy-all-format"'), "main must handle get-copy-all-format");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:set-copy-all-format"'), "main must handle set-copy-all-format");
  assert.ok(preloadJs.includes('getCopyAllFormat: () => ipcRenderer.invoke("sideshow:get-copy-all-format")'),
    "preload must expose getCopyAllFormat");
  assert.ok(settingsHtml.includes('id="copyAllFormatBtn"'), "settings must have a Copy all format button");
  assert.ok(rendererJs.includes('let copyAllFormat = "labeled"'), "Copy all format must default to Labeled");
});

test("Position tab: width, display, gap, reset spot, and idle dismiss are wired", () => {
  for (const id of ["panelWidthSlider", "panelDisplayBtn", "cursorGapSlider", "resetSpotBtn", "dismissBtn"]) {
    assert.ok(settingsHtml.includes('id="' + id + '"'), "settings must have " + id);
  }
  for (const id of ["panelWidthSlider", "panelDisplayBtn", "cursorGapSlider", "resetSpotBtn", "dismissBtn"]) {
    assert.ok(rendererJs.includes('$("' + id + '")'), "renderer must wire " + id);
  }
  assert.ok(mainJs.includes("panelWidth()"), "main must use the width setting for the window");
  assert.ok(mainJs.includes('p.display === "primary" ? screen.getPrimaryDisplay()'),
    "main must open on the primary display when picked");
  assert.ok(rendererJs.includes('custom: null'), "reset spot must clear the saved custom spot");
});
