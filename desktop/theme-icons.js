"use strict";
const { textColorsFor, accentTextFor } = require("./contrast.js");
/* Shift Shift color themes — the canonical theme table (v0.1.13,
   default changed to White in v0.1.14).

   One entry per theme. Picking one in Settings > Appearance sets
   the bubble look, background, accent, text ink, and transparency
   together (v0.1.14: the theme owns every readability-relevant
   appearance setting — see themeTextColors) AND swaps the runtime
   icon to that theme's Shift² variant.
   The three original presets (Studio, Dark, Light) have icon: null —
   they keep the static app icon (white Shift², assets/icon.png).
   The eight neon themes each point at a 256x256 PNG in assets/icons/,
   cropped from Kyle's uploaded Shift² tiles (1024 masters kept at
   icon-options/theme-masters-1024/; the tray only ever shows them
   at 16–32 px, so 256 is plenty).

   This module is pure (no Electron, no Node-only APIs) so the main
   process, the renderer bundle, and the tests all read the same
   table. Bubble background tints are the neon color mixed 12% over
   #101010, so the dark glass stays readable. */
const THEMES = [
  { id: "studio", label: "Studio", appearance: "glass", bgColor: "#a44a24", accent: "#a44a24", icon: null },
  { id: "dark", label: "Dark", appearance: "shaded", bgColor: "#2b2118", accent: "#a44a24", icon: null },
  { id: "light", label: "Light", appearance: "glass", bgColor: "#ffffff", accent: "#a44a24", icon: null },
  { id: "white", label: "White", appearance: "glass", bgColor: "#2d2d2d", accent: "#ffffff", icon: "theme-white.png" },
  { id: "amber", label: "Amber", appearance: "glass", bgColor: "#2a2310", accent: "#ebaf14", icon: "theme-amber.png" },
  { id: "orange", label: "Orange", appearance: "glass", bgColor: "#2c1b11", accent: "#f66f16", icon: "theme-orange.png" },
  { id: "blue", label: "Blue", appearance: "glass", bgColor: "#14232a", accent: "#32abe8", icon: "theme-blue.png" },
  { id: "green", label: "Green", appearance: "glass", bgColor: "#1e2913", accent: "#81e227", icon: "theme-green.png" },
  { id: "purple", label: "Purple", appearance: "glass", bgColor: "#23162a", accent: "#ad46ea", icon: "theme-purple.png" },
  { id: "pink", label: "Pink", appearance: "glass", bgColor: "#2c1622", accent: "#f843a3", icon: "theme-pink.png" },
  { id: "cyan", label: "Cyan", appearance: "glass", bgColor: "#10292a", accent: "#0ee2e5", icon: "theme-cyan.png" },
];

/* Fresh install: White (v0.1.14) — the white Shift² tile, so the
   tray icon matches the dock/exe icon from the first launch. */
const DEFAULT_THEME = "white";

function themeById(id) {
  return THEMES.find((t) => t.id === id) || null;
}

/* Icon filename for a theme id, or null when the theme keeps the
   static app icon (Studio, Dark, Light, or an unknown id). */
function themeIconFile(id) {
  const t = themeById(id);
  return t && t.icon ? t.icon : null;
}

/* Contrast-checked text colors for a theme (v0.1.14 auto-contrast):
   the text ink + soft ink for the theme background, and the theme
   accent adjusted until it reads as text on that background.
   The raw accent is unchanged everywhere else (borders, fills,
   scrollbar, tray icon) — only its use as text is adjusted. The
   three values are what applyPreset stores/applies; the tests
   assert every theme passes 4.5:1 on all three. */
function themeTextColors(theme) {
  if (!theme || !theme.bgColor || !theme.accent) return null;
  const text = textColorsFor(theme.bgColor);
  if (!text) return null;
  return {
    ink: text.ink,
    soft: text.soft,
    accentText: accentTextFor(theme.accent, theme.bgColor),
  };
}

module.exports = { THEMES, DEFAULT_THEME, themeById, themeIconFile, themeTextColors };
