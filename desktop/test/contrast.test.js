"use strict";
/* Theme auto-contrast test (v0.1.14): picking a theme must make
   its text readable with no hand-fixing. Every theme's ink, soft
   ink, and accent-as-text are checked at WCAG AA 4.5:1 against
   the theme background, the ink on an accent fill is checked
   against the accent, and the accent-as-text is checked against
   the settings surfaces (chip pill + surface) in both color
   schemes. Also guards the wiring: the renderer derives the
   --accent-text / --accent-on-surface variables, the CSS uses
   them for accent-as-text, and applyPreset owns the theme's
   appearance settings. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const { THEMES, themeTextColors } = require("../theme-icons.js");
const {
  MIN_RATIO,
  contrastRatio,
  adjustForContrast,
  bestInkFor,
  textColorsFor,
  accentTextFor,
  accentInkFor,
  accentOnSurfacesFor,
} = require("../contrast.js");

const rendererJs = fs.readFileSync(path.join(DESKTOP, "renderer", "renderer.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(DESKTOP, "renderer", "styles.css"), "utf8");

/* The settings surfaces, from styles.css :root (light) and the
   prefers-color-scheme: dark block. */
const CHIP_LIGHT = "#efe7db";
const SURFACE_LIGHT = "#ffffff";
const CHIP_DARK = "#3a2d21";
const SURFACE_DARK = "#2a211a";

test("contrast math: black on white is 21, same color is 1", () => {
  assert.equal(MIN_RATIO, 4.5);
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
  assert.equal(contrastRatio("#a44a24", "#a44a24"), 1);
  assert.equal(contrastRatio("not-a-color", "#ffffff"), null);
  assert.equal(contrastRatio("#ffffff", "nope"), null);
});

test("adjustForContrast leaves a passing color untouched, fixes a failing one", () => {
  assert.equal(adjustForContrast("#a44a24", "#ffffff"), "#a44a24"); /* 5.86:1 already */
  assert.equal(adjustForContrast("#ffffff", "#2d2d2d"), "#ffffff"); /* 13.77:1 already */
  /* Studio: the accent IS the background (1.00:1) — it must move. */
  const fixed = adjustForContrast("#a44a24", "#a44a24");
  assert.notEqual(fixed, "#a44a24");
  assert.ok(contrastRatio(fixed, "#a44a24") >= 4.5, "adjusted Studio accent must read on Studio bg");
  /* Purple: 3.97:1, just under — a small lightening fixes it. */
  const purple = adjustForContrast("#ad46ea", "#23162a");
  assert.notEqual(purple, "#ad46ea");
  assert.ok(contrastRatio(purple, "#23162a") >= 4.5, "adjusted Purple accent must read");
  /* The fix keeps the hue: lightened purple stays purple. */
  assert.ok(/^#[0-9a-f]{6}$/.test(purple), "adjusted color must be a hex color");
});

test("textColorsFor picks the readable ink pair for a background", () => {
  assert.deepEqual(textColorsFor("#ffffff"), { ink: "#2b2118", soft: "#5d4f42" });
  assert.deepEqual(textColorsFor("#2b2118"), { ink: "#f2e9df", soft: "#c4b3a1" });
  assert.equal(textColorsFor("not-a-color"), null);
  assert.equal(bestInkFor("#ffffff", "#f2e9df", "#2b2118"), "#2b2118");
  assert.equal(bestInkFor("#000000", "#f2e9df", "#2b2118"), "#f2e9df");
});

test("accentInkFor: ink on an accent fill always reads, even on bright purple/pink", () => {
  for (const accent of ["#a44a24", "#ffffff", "#ebaf14", "#f66f16", "#32abe8", "#81e227", "#ad46ea", "#f843a3", "#0ee2e5"]) {
    const ink = accentInkFor(accent);
    assert.ok(
      contrastRatio(ink, accent) >= 4.5,
      `accent ink ${ink} must read on accent ${accent} (${contrastRatio(ink, accent).toFixed(2)}:1)`
    );
  }
  /* Bright purple/pink: neither white nor the dark ink reaches
     4.5:1, so the fallback is pure black. */
  assert.equal(accentInkFor("#ad46ea"), "#000000");
  assert.equal(accentInkFor("#a44a24"), "#ffffff");
  assert.equal(accentInkFor("#ffffff"), "#1d1712");
});

test("every theme passes 4.5:1 on ink, soft ink, and accent-as-text", () => {
  assert.equal(THEMES.length, 11, "contrast must cover all 11 themes");
  for (const t of THEMES) {
    const c = themeTextColors(t);
    assert.ok(c, `${t.id} must have theme text colors`);
    for (const [name, fg] of [["ink", c.ink], ["soft", c.soft], ["accentText", c.accentText]]) {
      const r = contrastRatio(fg, t.bgColor);
      assert.ok(
        r >= 4.5,
        `${t.id} ${name} ${fg} must read on ${t.bgColor} (got ${r.toFixed(2)}:1)`
      );
    }
    /* The raw accent is only adjusted when it fails — most themes
       keep their exact neon accent as text. */
    if (["studio", "dark", "purple"].includes(t.id)) {
      assert.notEqual(c.accentText, t.accent, `${t.id} accent must be adjusted to read`);
    } else {
      assert.equal(c.accentText, t.accent, `${t.id} accent already reads, must stay exact`);
    }
  }
});

test("every theme accent reads on the settings surfaces, light and dark", () => {
  for (const t of THEMES) {
    for (const [scheme, surfaces] of [
      ["light", [CHIP_LIGHT, SURFACE_LIGHT]],
      ["dark", [CHIP_DARK, SURFACE_DARK]],
    ]) {
      const onSurface = accentOnSurfacesFor(t.accent, surfaces);
      for (const bg of surfaces) {
        const r = contrastRatio(onSurface, bg);
        assert.ok(
          r >= 4.5,
          `${t.id} accent ${onSurface} must read on ${scheme} surface ${bg} (got ${r.toFixed(2)}:1)`
        );
      }
    }
  }
  /* The failing case from Kyle's photo: white accent on the pale
     tan pill (1.24:1) must darken until it reads. */
  const fixed = accentOnSurfacesFor("#ffffff", [CHIP_LIGHT, SURFACE_LIGHT]);
  assert.notEqual(fixed, "#ffffff");
  assert.ok(contrastRatio(fixed, CHIP_LIGHT) >= 4.5, "white accent must read on the light chip pill");
  assert.ok(contrastRatio(fixed, SURFACE_LIGHT) >= 4.5, "white accent must read on the light surface");
});

test("renderer derives the contrast variables and the theme owns its appearance settings", () => {
  assert.ok(rendererJs.includes('themeTextColors } from "../theme-icons.js"'), "renderer must import themeTextColors");
  assert.ok(rendererJs.includes('accentTextFor(accentSettingValue, bubbleOptions.bgColor)'), "renderer must derive --accent-text from accent + background");
  assert.ok(rendererJs.includes('accentInkFor(hex)'), "renderer must derive --accent-ink by contrast");
  assert.ok(rendererJs.includes('accentOnSurfacesFor(hex, surfaces)'), "renderer must derive --accent-on-surface from the settings surfaces");
  assert.ok(rendererJs.includes('setProperty("--accent-text"'), "renderer must set --accent-text");
  assert.ok(rendererJs.includes('setProperty("--accent-on-surface"'), "renderer must set --accent-on-surface");
  assert.ok(rendererJs.includes("function applyPreset(p)"), "renderer must have applyPreset");
  assert.ok(rendererJs.includes("bubbleOptions.textColor = colors ? colors.ink : null"), "applyPreset must set the theme's contrast-checked ink");
  assert.ok(rendererJs.includes("transparencySetting = 50;"), "applyPreset must own the transparency setting");
  assert.ok(rendererJs.includes("applyAccentText();"), "a background change must refresh the accent-as-text color");
});

test("CSS uses the contrast variables for accent-as-text, never the raw accent", () => {
  for (const rule of [
    ".bubble-header button.active { border-color: var(--accent); color: var(--accent-text, var(--accent)); }",
    ".pin-btn.pinned { color: var(--accent-text, var(--accent)); }",
    ".settings-tab.active { color: var(--accent-on-surface, var(--accent-text, var(--accent))); background: var(--chip); }",
    ".btn.plain.active { border-color: var(--accent); color: var(--accent-on-surface, var(--accent-text, var(--accent))); }",
    ".field-toggle.active { border-color: var(--accent); color: var(--accent-on-surface, var(--accent-text, var(--accent))); background: var(--chip); }",
    ".setting-btn.listening { border-color: var(--accent); color: var(--accent-on-surface, var(--accent-text, var(--accent))); }",
  ]) {
    assert.ok(stylesCss.includes(rule), "styles must use the contrast variable: " + rule);
  }
  /* The Next up countdown and the week-today head sit on the
     bubble fill, so they take the bubble-background variant. */
  assert.ok(stylesCss.includes("color: var(--accent-text, var(--accent));"), "bubble accent-as-text must use --accent-text");
  /* Decorative uses keep the raw accent (borders, fills, thumb). */
  assert.ok(stylesCss.includes("border-color: var(--accent);"), "borders keep the raw accent");
  assert.ok(stylesCss.includes("background: var(--accent);"), "fills keep the raw accent");
});

test("settings window softening: softer ink, outlined tab labels, lighter label weight", () => {
  assert.ok(stylesCss.includes(".settings-view { --ink: #4a3f35; }"), "settings must use a softer ink in the light scheme");
  assert.ok(stylesCss.includes("text-shadow: 0 1px 2px rgba(29, 23, 18, 0.28)"), "tab labels must carry a soft outline shadow");
  assert.ok(
    stylesCss.includes(".setting-label { font-size: 11px; font-weight: 600;"),
    "setting labels must be semibold, not heavy bold"
  );
  assert.ok(
    stylesCss.includes("font-size: 11px; font-weight: 600; text-transform: uppercase;"),
    "event edit labels must be semibold, not heavy bold"
  );
});

test("header controls follow the theme: search bar + header buttons use the bubble ink chains", () => {
  /* The header sits on the theme fill, so its text, placeholder,
     icons, and borders must take the same contrast-checked ink the
     bubbles use — never the static root palette (dark ink on a dark
     theme fill is unreadable, and a tan line is not the bubble's
     border). The per-theme 4.5:1 test above is what makes these
     chains read; this test pins the wiring. */
  for (const rule of [
    ".bubble-header button:hover { color: var(--icon-color-user, var(--bubble-ink-user, var(--bubble-ink-auto, var(--ink)))); transform: scale(1.08); }",
    "color: var(--icon-color-user, var(--bubble-ink-soft-user, var(--bubble-ink-soft-auto, var(--ink-soft))));",
    "color: var(--bubble-ink-user, var(--bubble-ink-auto, var(--ink)));",
    ".search-box input::placeholder { color: var(--bubble-ink-soft-user, var(--bubble-ink-soft-auto, var(--ink-soft))); }",
    "border: 1px solid var(--bubble-border, var(--line));",
  ]) {
    assert.ok(stylesCss.includes(rule), "header must derive from the theme ink: " + rule);
  }
  /* The search input must not keep the static dark ink. */
  const inputBlock = /\.search-box input \{[^}]*\}/.exec(stylesCss);
  assert.ok(inputBlock, "search input rule must exist");
  assert.ok(!inputBlock[0].includes("color: var(--ink);"), "search input must not use the static --ink");
});
