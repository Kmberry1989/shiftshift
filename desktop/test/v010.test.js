"use strict";
/* v0.1.10 static checks (no Electron needed): calendar view
   backdrop from the existing background settings, White in the
   color swatches, and one-tap preset themes. Dragging was removed
   in v0.1.16 (see test/no-drag.test.js for the removal assertions);
   the drag tests that used to live here are gone with it.
   Each test names the user-facing behavior it guards so a future
   edit that silently drops one fails loudly here first. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const RENDERER = path.join(DESKTOP, "renderer");
const read = (p) => fs.readFileSync(p, "utf8");
const settingsHtml = read(path.join(RENDERER, "settings.html"));
const stylesCss = read(path.join(RENDERER, "styles.css"));
const rendererJs = read(path.join(RENDERER, "renderer.js"));
const mainJs = read(path.join(DESKTOP, "main.js"));
/* Body of the first CSS rule whose selector starts a line as `sel`, or null.
   (Line-anchored: a combined selector line like ".x, .settings-body {"
   must not match ".settings-body".) */
const ruleBody = (css, sel) => {
  const m = css.match(new RegExp("(?:^|\\n)" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "s"));
  return m ? m[1] : null;
};

test("dragging is disabled: the root's click toggles the focused event, nothing moves the panel", () => {
  /* v0.1.16: dragging is gone entirely (Kyle's call — the scale
     issue persisted through two fixes). The toggle that used to
     live in the drag-end path is a plain click listener on the
     root bubble; see test/no-drag.test.js for the full removal
     assertions. */
  assert.ok(!rendererJs.includes("onRootMouseDown"), "the root-only drag handler must be gone");
  assert.ok(!rendererJs.includes('root.addEventListener("mousedown"'), "the root must not carry its own drag listener");
  const rootStart = rendererJs.indexOf('root.className = "bubble root-bubble pulse-item"');
  const rootBlock = rendererJs.slice(rootStart, rendererJs.indexOf("tree.appendChild(root);", rootStart));
  assert.ok(rootBlock.includes('root.addEventListener("click"'), "the root bubble must toggle on a plain click");
});

test("click-through: only leaf interactive elements keep clicks, transparent gaps pass through", () => {
  /* v0.1.15 reverses the v0.1.10 rule: Kyle reported clicks on the
     visibly transparent gaps between bubbles were eaten by the
     window. The hit test now lives in click-through.js and lists
     leaf elements only — the big containers (.bubble-tree,
     .bubble-header, .calendar-view) are gone, so a gap reads as
     empty and the click reaches the app behind. Calendar day cells
     stay interactive: they are visible content, not transparency. */
  const clickThroughJs = read(path.join(RENDERER, "click-through.js"));
  const sel = clickThroughJs.slice(clickThroughJs.indexOf("const CLICKABLE_SELECTOR"), clickThroughJs.indexOf(";", clickThroughJs.indexOf("const CLICKABLE_SELECTOR")));
  assert.ok(!sel.includes(".bubble-tree"), "tree gaps must pass clicks through to the desktop");
  assert.ok(!sel.includes(".bubble-header"), "header gaps must pass clicks through to the desktop");
  assert.ok(!sel.includes(".calendar-view"), "calendar-view padding must pass clicks through to the desktop");
  assert.ok(sel.includes(".cal-cell"), "calendar day cells must stay interactive");
  assert.ok(sel.includes(".bubble"), "bubbles must stay interactive");
  assert.ok(sel.includes("input"), "the search input must stay in the clickable set");
  assert.ok(rendererJs.includes('from "./click-through.js"'), "the renderer must use the click-through module");
});

test("calendar backdrop: the grid uses the existing bubble fill, no new setting", () => {
  const view = stylesCss.slice(stylesCss.indexOf(".calendar-view {"), stylesCss.indexOf("}", stylesCss.indexOf(".calendar-view {")));
  assert.ok(view.includes("background: var(--bubble-fill)"), "the calendar view must take the bubble fill as its backdrop");
  assert.ok(view.includes("border-radius: var(--corner-radius, 32px)"), "the calendar backdrop must keep the rounded look");
  assert.ok(view.includes("border: 1.5px solid var(--bubble-border-user, var(--bubble-border))"), "the calendar backdrop must carry the bubble border");
  assert.ok(!rendererJs.includes("calendarBackdrop") && !rendererJs.includes("calBackdrop"), "no new backdrop setting may exist");
});

test("White is a pickable color swatch, but never an accent", () => {
  assert.ok(rendererJs.includes('{ value: "#ffffff", label: "White" }'), "White must be in COLOR_SWATCHES");
  const accent = rendererJs.slice(rendererJs.indexOf("const ACCENT_SWATCHES"), rendererJs.indexOf("let accentSettingValue"));
  assert.ok(!accent.includes("#ffffff"), "a white accent would be invisible on the light fills");
  const color = rendererJs.slice(rendererJs.indexOf("const COLOR_SWATCHES"), rendererJs.indexOf("async function saveBubbleOptions"));
  assert.ok(color.includes('#ffffff'), "White must be in the color list feeding the four pickers");
});

test("preset themes: Studio, Dark, Light set the existing settings in one tap", () => {
  /* The preset table lives in the shared theme-icons.js (main,
     renderer, and tests read the same one); the renderer imports it
     as THEME_PRESETS. */
  const themeIconsJs = fs.readFileSync(path.join(__dirname, "..", "theme-icons.js"), "utf8");
  assert.ok(themeIconsJs.includes('{ id: "studio", label: "Studio", appearance: "glass", bgColor: "#a44a24", accent: "#a44a24", icon: null }'), "Studio preset missing or wrong");
  assert.ok(themeIconsJs.includes('{ id: "dark", label: "Dark", appearance: "shaded", bgColor: "#2b2118", accent: "#a44a24", icon: null }'), "Dark preset missing or wrong");
  assert.ok(themeIconsJs.includes('{ id: "light", label: "Light", appearance: "glass", bgColor: "#ffffff", accent: "#a44a24", icon: null }'), "Light preset missing or wrong");
  assert.ok(rendererJs.includes('import { THEMES as THEME_PRESETS, themeTextColors } from "../theme-icons.js"'), "renderer must import the shared preset table");
  assert.ok(settingsHtml.includes('id="presetBtns"'), "preset buttons missing from the Appearance tab");
  assert.ok(rendererJs.includes("buildPresetButtons();"), "preset buttons must be built at startup");
  const apply = rendererJs.slice(rendererJs.indexOf("async function applyPreset"), rendererJs.indexOf("/* ---------- bubble appearance ---------- */"));
  assert.ok(apply.includes("setAppearance(p.appearance)"), "a preset must set the look through the existing setting");
  assert.ok(apply.includes("setAccent(p.accent)"), "a preset must set the accent through the existing setting");
  assert.ok(apply.includes("saveBubbleOptions()"), "a preset must persist the background through the existing setting");
  /* v0.1.14: a preset sets the theme's contrast-checked ink
     explicitly (not auto-null) and owns the transparency. */
  assert.ok(apply.includes("bubbleOptions.textColor = colors ? colors.ink : null"), "a preset must set the theme's contrast-checked ink");
  assert.ok(apply.includes("transparencySetting = 50;"), "a preset must own the transparency setting");
  /* Every preset color comes from the existing palette — nothing invented. */
  for (const hex of ["#a44a24", "#2b2118", "#ffffff"]) {
    assert.ok(rendererJs.includes(hex), hex + " must already be in the swatch palette");
  }
});

/* ---------- touch: Pointer Events, one path ---------- */

test("no drag listeners remain: no pointermove/pointerup/pointercancel drag path", () => {
  /* v0.1.16: the drag listeners are gone. The only pointerdown
     listener left is the Create event menu's outside-click close;
     it must not start a move. */
  assert.ok(!rendererJs.includes('addEventListener("pointermove"'), "no pointermove drag listener");
  assert.ok(!rendererJs.includes('addEventListener("pointerup"'), "no pointerup drag listener");
  assert.ok(!rendererJs.includes('addEventListener("pointercancel"'), "no pointercancel drag listener");
  assert.ok(!rendererJs.includes('addEventListener("lostpointercapture"'), "no lost-capture drag listener");
  assert.ok(!rendererJs.includes('addEventListener("mousedown"'), "no mousedown drag listener");
  assert.ok(!rendererJs.includes('addEventListener("mouseup"'), "no mouseup drag listener");
  assert.ok(rendererJs.includes('e.target.closest("#createEventMenu")'), "the one pointerdown listener left must be the Create menu close");
});

test("touch-action: manipulation on interactive elements, pan-y on scroll containers, none on the header", () => {
  assert.ok(/button, input, select, a\s*\{\s*touch-action: manipulation;/.test(stylesCss), "buttons/inputs get manipulation (no tap delay)");
  for (const sel of [".bubble-tree", ".calendar-view", ".settings-body"]) {
    const rule = ruleBody(stylesCss, sel);
    assert.ok(rule && /touch-action:\s*pan-y/.test(rule), `${sel} scrolls natively (pan-y)`);
  }
  const header = ruleBody(stylesCss, ".bubble-header");
  assert.ok(header && /touch-action:\s*none/.test(header), "header never scrolls");
  assert.ok(stylesCss.includes("-webkit-touch-callout: none"), "no long-press callout");
});

test("eye button has a fingertip-sized hit area with the same visual size", () => {
  const rule = ruleBody(stylesCss, ".eye-btn");
  assert.ok(rule && /width:\s*34px/.test(rule) && /height:\s*34px/.test(rule), "eye hit area is 34px");
  assert.ok(rule && /padding:\s*6px/.test(rule), "eye padding grows the hit area");
  assert.ok(rule && /margin:\s*-5px -6px -6px -4px/.test(rule), "negative margins keep the layout footprint at 22px");
});

test("tray single-click is the touch summon path (no new summon needed)", () => {
  assert.ok(mainJs.includes('tray.on("click"'), "tray click handler exists");
  assert.ok(mainJs.includes("requestToggle()"), "tray click toggles the panel");
});
