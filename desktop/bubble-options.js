"use strict";
/* Bubble options — every user-settable bubble appearance + text
   choice in one object, persisted in sideshow-settings.json as
   `settings.bubble`. Pure module (no Electron): main normalizes and
   stores it, the renderer applies it, tests import it directly.

   Defaults are the current look, so the core works fully with
   everything at defaults and no option is mandatory.

   scale         80–150 (%) — scales the whole bubble tree; default 100.
   font          system | mono | rounded | georgia | palatino |
                 verdana | tahoma | trebuchet | courier | arial |
                 helvetica | times | segoe | futura | garamond |
                 franklin | baskerville | impact | andale (system
                 fonts only, each with a cross-platform fallback
                 stack). Default mono — the bubble text is already
                 mono type, so that is the current look, not a new
                 choice. "serif" was removed in v0.1.14 (identical
                 stack to Georgia); a saved "serif" loads as Georgia.
   weight        regular | medium | bold — base weight of bubble text.
   borderColor   null = the current per-look outline, or a hex color.
   shadowOn      true — a subtle shadow under the bubble.
   shadowStrength 0–100 — shadow intensity; default 40 (subtle).
   bgColor       null = white / the current look, or a hex color.
                 The color tints the bubble: the glass tint for Liquid
                 Glass, the shaded fill for Shaded, a faint tint for
                 Transparent. Text ink is auto-computed from it so a
                 dark background still reads (see readableInkFor).
   cornerStyle   smooth | right (angle).
   cornerRadius  0–32 px of rounding for the Smooth style; default 32,
                 which renders as the current pill (the radius clamps
                 to half the bubble height). 0 = sharp. Right angle
                 ignores the amount (always 90°).
   align         left | right | middle | center — how the branch
                 bubbles align in the tree. Default left (current).
                 Left/Right hug one edge; Center centers each bubble;
                 Middle centers the branch column as a block while the
                 bubbles stay left-aligned inside it.
   pulse         true — the bubble gently pulses like a cloud.
   textColor     null = the current ink, or a hex color. An explicit
                 text color wins over the auto ink from bgColor.
   fieldStyles   per field (n/d/t/p/a/h/l): { italic, underline,
                 bold, color }. Defaults: normal, except Name bold =
                 true — the event title is already bold, so that is
                 the current look, not an added bold.
   scrollbar     slim | standard — the tree scrollbar's width.
                 Default slim.
   scrollbarColor null = the accent color (the current look), or a
                 hex color for the thumb alone. Changing the accent
                 no longer recolors the scrollbar once a color is
                 picked. The track is transparent either way.
   scrollbarShape pill | square — the thumb's corners. Default pill
                 (fully round, the current look). "rounded" was
                 removed in v0.1.14 (identical to Pill on Slim); a
                 saved "rounded" loads as Pill.
   iconColor     null = the theme ink (the current look), or a hex
                 color for the header icons (gear, magnifier, close).
   separation    bullets | lines | spacing — how entries are set
                 apart in the tree. Default bullets (a small dot
                 before each event); lines puts a thin rule between
                 entries; spacing adds breathing room instead. */

const FIELD_KEYS = ["n", "d", "t", "p", "a", "h", "l"];
const FIELD_LABELS = {
  n: "Name",
  d: "Date",
  t: "Time",
  p: "Price",
  a: "Ages",
  h: "Host",
  l: "Location",
};
const FIELD_TITLES = {
  n: "Event name",
  d: "Date",
  t: "Time range",
  p: "Price",
  a: "Ages",
  h: "Host",
  l: "Location",
};

const { textColorsFor } = require("./contrast.js");

const FONTS = {
  system: '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
  georgia: 'Georgia, "Times New Roman", "Noto Serif", serif',
  palatino: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
  verdana: 'Verdana, Geneva, "Segoe UI", sans-serif',
  tahoma: 'Tahoma, Geneva, Verdana, sans-serif',
  trebuchet: '"Trebuchet MS", "Segoe UI", Verdana, sans-serif',
  courier: '"Courier New", Courier, ui-monospace, monospace',
  /* v0.1.14: ten more system fonts. Every stack ends in a generic
     family and falls back across Windows/Mac, so a missing family
     never renders broken — e.g. Segoe UI (Windows) falls back to
     Helvetica Neue/Arial on Mac, Futura falls back to Century
     Gothic on Windows. */
  arial: 'Arial, Helvetica, "Segoe UI", sans-serif',
  helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, "Noto Serif", serif',
  segoe: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
  futura: 'Futura, "Century Gothic", "Segoe UI", sans-serif',
  garamond: 'Garamond, "EB Garamond", "Times New Roman", serif',
  franklin: '"Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif',
  baskerville: 'Baskerville, "Times New Roman", serif',
  impact: 'Impact, "Arial Black", sans-serif',
  andale: '"Andale Mono", "SF Mono", Consolas, monospace',
};
const FONT_LABELS = { system: "System", mono: "Mono", rounded: "Rounded", georgia: "Georgia", palatino: "Palatino", verdana: "Verdana", tahoma: "Tahoma", trebuchet: "Trebuchet", courier: "Courier", arial: "Arial", helvetica: "Helvetica", times: "Times", segoe: "Segoe", futura: "Futura", garamond: "Garamond", franklin: "Franklin", baskerville: "Baskerville", impact: "Impact", andale: "Andale" };
const FONT_CYCLE = ["mono", "system", "rounded", "georgia", "palatino", "verdana", "tahoma", "trebuchet", "courier", "arial", "helvetica", "times", "segoe", "futura", "garamond", "franklin", "baskerville", "impact", "andale"];

const WEIGHTS = { regular: 400, medium: 500, bold: 700 };
const WEIGHT_LABELS = { regular: "Regular", medium: "Medium", bold: "Bold" };
const WEIGHT_CYCLE = ["regular", "medium", "bold"];

const CORNER_STYLES = ["smooth", "right"];
const CORNER_LABELS = { smooth: "Smooth", right: "Right angle" };
const CORNER_CYCLE = ["smooth", "right"];

const ALIGNS = ["left", "right", "middle", "center"];
const ALIGN_LABELS = { left: "Left", right: "Right", middle: "Middle", center: "Center" };
const ALIGN_CYCLE = ["left", "right", "middle", "center"];

const SCROLLBARS = ["slim", "standard"];
const SCROLLBAR_LABELS = { slim: "Slim", standard: "Standard" };
const SCROLLBAR_CYCLE = ["slim", "standard"];

/* Thumb corner shape: pill is fully round (the current look),
   square is sharp. "rounded" was removed in v0.1.14 — it rendered
   identically to Pill on Slim, so it was a duplicate. */
const SCROLLBAR_SHAPES = ["pill", "square"];
const SCROLLBAR_SHAPE_LABELS = { pill: "Pill", square: "Square" };
const SCROLLBAR_SHAPE_CYCLE = ["pill", "square"];
const SCROLLBAR_SHAPE_RADIUS = { pill: "999px", square: "0" };

const SEPARATIONS = ["bullets", "lines", "spacing"];
const SEPARATION_LABELS = { bullets: "Bullets", lines: "Lines", spacing: "Spacing" };
const SEPARATION_CYCLE = ["bullets", "lines", "spacing"];

const BUBBLE_OPTION_DEFAULTS = {
  scale: 100,
  font: "mono",
  weight: "regular",
  borderColor: null,
  shadowOn: true,
  shadowStrength: 40,
  bgColor: null,
  cornerStyle: "smooth",
  cornerRadius: 32,
  align: "left",
  pulse: true,
  textColor: null,
  fieldStyles: {},
  scrollbar: "slim",
  scrollbarColor: null,
  scrollbarShape: "pill",
  iconColor: null,
  separation: "bullets",
};

/* The current look per field: normal, except the event title (Name)
   is already bold, so its bold default is true. */
function defaultFieldStyle(key) {
  return { italic: false, underline: false, bold: key === "n", color: null };
}

function isHex(v) {
  return typeof v === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);
}

function hexToRgb(hex) {
  if (!isHex(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return {
    r: parseInt(h.substr(0, 2), 16),
    g: parseInt(h.substr(2, 2), 16),
    b: parseInt(h.substr(4, 2), 16),
  };
}

function rgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + alpha + ")";
}

/* Readable ink for a background color, by real WCAG contrast
   (see contrast.js): the ink and its muted companion are each
   checked at 4.5:1, and adjusted (lightened/darkened, hue kept)
   when neither candidate reaches it. Dark text on a light
   background, light text on a dark one; soft is the muted
   companion for subtitles, key badges, and the expand mark.
   The usual results are the app's existing ink pair — the
   adjustment only fires on mid-tone backgrounds where both
   candidates fail (e.g. the Studio terracotta). */
function readableInkFor(hex) {
  if (!isHex(hex)) return null;
  return textColorsFor(hex);
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(+v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeFieldStyles(value) {
  const out = {};
  const src = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
  FIELD_KEYS.forEach((key) => {
    const f = src[key] && typeof src[key] === "object" ? src[key] : {};
    const d = defaultFieldStyle(key);
    out[key] = {
      italic: f.italic === true ? true : (f.italic === false ? false : d.italic),
      underline: f.underline === true ? true : (f.underline === false ? false : d.underline),
      bold: f.bold === true ? true : (f.bold === false ? false : d.bold),
      color: isHex(f.color) ? f.color : null,
    };
  });
  return out;
}

function normalizeBubbleOptions(value) {
  const src = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
  const d = BUBBLE_OPTION_DEFAULTS;
  return {
    scale: clampInt(src.scale, 80, 150, d.scale),
    /* v0.1.14 duplicate cuts: a saved "serif" font loads as
       Georgia (identical stack), a saved "rounded" thumb shape
       loads as Pill (identical render on Slim). */
    font: src.font === "serif" ? "georgia" : (FONTS[src.font] ? src.font : d.font),
    weight: WEIGHTS[src.weight] ? src.weight : d.weight,
    borderColor: isHex(src.borderColor) ? src.borderColor : null,
    shadowOn: src.shadowOn === false ? false : (src.shadowOn === true ? true : d.shadowOn),
    shadowStrength: clampInt(src.shadowStrength, 0, 100, d.shadowStrength),
    bgColor: isHex(src.bgColor) ? src.bgColor : null,
    cornerStyle: CORNER_STYLES.indexOf(src.cornerStyle) >= 0 ? src.cornerStyle : d.cornerStyle,
    cornerRadius: clampInt(src.cornerRadius, 0, 32, d.cornerRadius),
    align: ALIGNS.indexOf(src.align) >= 0 ? src.align : d.align,
    pulse: src.pulse === false ? false : (src.pulse === true ? true : d.pulse),
    textColor: isHex(src.textColor) ? src.textColor : null,
    fieldStyles: normalizeFieldStyles(src.fieldStyles),
    scrollbar: SCROLLBARS.indexOf(src.scrollbar) >= 0 ? src.scrollbar : d.scrollbar,
    scrollbarColor: isHex(src.scrollbarColor) ? src.scrollbarColor : null,
    scrollbarShape: src.scrollbarShape === "rounded" ? "pill" : (SCROLLBAR_SHAPES.indexOf(src.scrollbarShape) >= 0 ? src.scrollbarShape : d.scrollbarShape),
    iconColor: isHex(src.iconColor) ? src.iconColor : null,
    separation: SEPARATIONS.indexOf(src.separation) >= 0 ? src.separation : d.separation,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FIELD_KEYS,
    FIELD_LABELS,
    FIELD_TITLES,
    FONTS,
    FONT_LABELS,
    FONT_CYCLE,
    WEIGHTS,
    WEIGHT_LABELS,
    WEIGHT_CYCLE,
    CORNER_STYLES,
    CORNER_LABELS,
    CORNER_CYCLE,
    ALIGNS,
    ALIGN_LABELS,
    ALIGN_CYCLE,
    SCROLLBARS,
    SCROLLBAR_LABELS,
    SCROLLBAR_CYCLE,
    SCROLLBAR_SHAPES,
    SCROLLBAR_SHAPE_LABELS,
    SCROLLBAR_SHAPE_CYCLE,
    SCROLLBAR_SHAPE_RADIUS,
    SEPARATIONS,
    SEPARATION_LABELS,
    SEPARATION_CYCLE,
    BUBBLE_OPTION_DEFAULTS,
    defaultFieldStyle,
    isHex,
    hexToRgb,
    rgba,
    readableInkFor,
    normalizeBubbleOptions,
    normalizeFieldStyles,
  };
}
