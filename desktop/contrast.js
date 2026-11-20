"use strict";
/* WCAG contrast helpers (v0.1.14) — the theme auto-contrast rule.

   Picking a theme must make its text readable with no hand-fixing:
   the text ink, the soft ink, and the accent used as text are all
   checked against the theme background with a real WCAG contrast
   ratio (AA, 4.5:1 for text). The old brightness heuristic
   (0.299r + 0.587g + 0.114b > 140) picked the right ink most of the
   time but could not see the failures: Studio's accent IS its
   background (1.00:1), Dark's terracotta on brown is 2.69:1, Purple
   is 3.97:1, and the soft ink on Studio is 2.88:1.

   Pure module (no Electron, no Node-only APIs) so the main process,
   the renderer bundle, and the tests all use the same math. */

const MIN_RATIO = 4.5; /* WCAG AA for normal text */

function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim();
  if (h.charAt(0) === "#") h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.substr(0, 2), 16),
    g: parseInt(h.substr(2, 2), 16),
    b: parseInt(h.substr(4, 2), 16),
  };
}

function toHex(rgb) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + c(rgb.r) + c(rgb.g) + c(rgb.b);
}

/* Relative luminance, WCAG 2.x: linearize each sRGB channel, then
   L = 0.2126R + 0.7152G + 0.0722B. Null for an unparsable color. */
function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/* WCAG contrast ratio (L1 + 0.05) / (L2 + 0.05), lighter over
   darker. Null when either color is unparsable. */
function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  if (l1 == null || l2 == null) return null;
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/* Linear mix of two hex colors: t = 0 is `a`, t = 1 is `b`. */
function mixHex(a, b, t) {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  return toHex({
    r: ra.r + (rb.r - ra.r) * t,
    g: ra.g + (rb.g - ra.g) * t,
    b: ra.b + (rb.b - ra.b) * t,
  });
}

/* Lighten or darken `fg` (preserving its hue) just enough that it
   reads on `bg` at minRatio. Tries both directions and keeps the
   smaller change; when fg already passes it is returned untouched.
   When neither pure white nor pure black can reach the ratio (only
   possible for a background in the narrow luminance band around
   0.18), returns the direction with the higher ratio. */
function adjustForContrast(fg, bg, minRatio) {
  const min = minRatio || MIN_RATIO;
  const start = contrastRatio(fg, bg);
  if (start == null) return fg;
  if (start >= min) return fg;
  /* Smallest t toward `target` that reaches the ratio, or null. */
  const reach = (target) => {
    if (contrastRatio(target, bg) < min) return null;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(mixHex(fg, target, mid), bg) >= min) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  const toWhite = reach("#ffffff");
  const toBlack = reach("#000000");
  if (toWhite == null && toBlack == null) {
    /* Neither extreme reaches it: take the better extreme. */
    return contrastRatio("#ffffff", bg) >= contrastRatio("#000000", bg) ? "#ffffff" : "#000000";
  }
  if (toWhite == null) return mixHex(fg, "#000000", toBlack);
  if (toBlack == null) return mixHex(fg, "#ffffff", toWhite);
  return toWhite <= toBlack
    ? mixHex(fg, "#ffffff", toWhite)
    : mixHex(fg, "#000000", toBlack);
}

/* `fg` adjusted until it reads on EVERY background in `bgs`
   (the settings surfaces: chip pill + surface). Re-checks all of
   them after each step; the backgrounds in one color scheme are
   all light or all dark, so one direction serves them all. */
function adjustForBackgrounds(fg, bgs, minRatio) {
  const min = minRatio || MIN_RATIO;
  let cur = fg;
  for (let i = 0; i < 5; i++) {
    let worst = null;
    let worstRatio = Infinity;
    for (const bg of bgs) {
      const r = contrastRatio(cur, bg);
      if (r != null && r < worstRatio) { worstRatio = r; worst = bg; }
    }
    if (worst == null || worstRatio >= min) return cur;
    const next = adjustForContrast(cur, worst, min);
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

/* Best of the two ink candidates for `bg` (light first, dark
   second), adjusted only when neither reaches the ratio. The
   candidates are the app's existing ink pair, so the usual result
   is exactly the old ink — the adjustment only fires on the
   mid-tone backgrounds where both candidates fail. */
function bestInkFor(bg, light, dark, minRatio) {
  const min = minRatio || MIN_RATIO;
  const rl = contrastRatio(light, bg);
  const rd = contrastRatio(dark, bg);
  if (rl == null || rd == null) return null;
  const best = rl >= rd ? light : dark;
  if (Math.max(rl, rd) >= min) return best;
  return adjustForContrast(best, bg, min);
}

/* Ink + soft ink for a background, both contrast-checked. */
function textColorsFor(bg) {
  const ink = bestInkFor(bg, "#f2e9df", "#2b2118");
  const soft = bestInkFor(bg, "#c4b3a1", "#5d4f42");
  if (ink == null || soft == null) return null;
  return { ink, soft };
}

/* A theme accent used as text on its own background, adjusted
   until it reads. Unchanged when it already passes. */
function accentTextFor(accent, bg) {
  return adjustForContrast(accent, bg);
}

/* Ink that sits ON an accent fill (the solid .btn, copy
   confirmation). White or dark, whichever reads better; pure black
   only when neither does (bright purple/pink accents) — black on
   any accent white fails on always passes, so this never returns
   an unreadable pair. */
function accentInkFor(accent) {
  const rw = contrastRatio("#ffffff", accent);
  const rd = contrastRatio("#1d1712", accent);
  if (rw == null || rd == null) return "#ffffff";
  const best = rw >= rd ? "#ffffff" : "#1d1712";
  if (Math.max(rw, rd) >= MIN_RATIO) return best;
  return "#000000";
}

/* An accent used as text on the settings surfaces (chip pill +
   surface), adjusted until it reads on all of them. */
function accentOnSurfacesFor(accent, surfaces) {
  if (!Array.isArray(surfaces) || !surfaces.length) return accent;
  return adjustForBackgrounds(accent, surfaces);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MIN_RATIO,
    hexToRgb,
    toHex,
    relativeLuminance,
    contrastRatio,
    mixHex,
    adjustForContrast,
    adjustForBackgrounds,
    bestInkFor,
    textColorsFor,
    accentTextFor,
    accentInkFor,
    accentOnSurfacesFor,
  };
}
