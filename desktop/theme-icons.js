"use strict";
/* Shift Shift color themes — the canonical theme table (v0.1.13).

   One entry per theme. Picking one in Settings > Appearance sets the
   bubble look, background, and accent together (text ink back to
   auto) AND swaps the runtime icon to that theme's Shift² variant.
   The three original presets (Studio, Dark, Light) have icon: null —
   they keep the static app icon (orange Shift², assets/icon.png).
   The eight neon themes each point at a 1024x1024 PNG master in
   assets/icons/, cropped from Kyle's uploaded Shift² tiles.

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

/* Fresh install: Studio — the terracotta glass the bubble has always
   shipped with, on the static orange icon. */
const DEFAULT_THEME = "studio";

function themeById(id) {
  return THEMES.find((t) => t.id === id) || null;
}

/* Icon filename for a theme id, or null when the theme keeps the
   static app icon (Studio, Dark, Light, or an unknown id). */
function themeIconFile(id) {
  const t = themeById(id);
  return t && t.icon ? t.icon : null;
}

module.exports = { THEMES, DEFAULT_THEME, themeById, themeIconFile };
