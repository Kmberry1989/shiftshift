"use strict";
/* Theme table test: the canonical theme list in theme-icons.js —
   the same table main, the renderer bundle, and the tray icon swap
   all read. Guards: every theme maps to its bubble colors and its
   icon file (or null for the three original presets), ids are
   unique, and unknown ids never resolve to an icon. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const { THEMES, DEFAULT_THEME, themeById, themeIconFile } = require("../theme-icons.js");

const HEX = /^#[0-9a-f]{6}$/;
const APPEARANCES = ["glass", "shaded", "clear"];

test("theme table has 11 themes with unique ids", () => {
  assert.equal(THEMES.length, 11, `expected 11 themes, got ${THEMES.length}`);
  const ids = THEMES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "theme ids must be unique");
  assert.equal(DEFAULT_THEME, "studio");
  assert.ok(themeById(DEFAULT_THEME), "default theme must exist");
});

test("every theme has valid colors and appearance", () => {
  for (const t of THEMES) {
    assert.ok(typeof t.label === "string" && t.label.length > 0, `${t.id} needs a label`);
    assert.ok(APPEARANCES.includes(t.appearance), `${t.id} bad appearance ${t.appearance}`);
    assert.ok(HEX.test(t.bgColor), `${t.id} bad bgColor ${t.bgColor}`);
    assert.ok(HEX.test(t.accent), `${t.id} bad accent ${t.accent}`);
  }
});

test("the 8 neon themes map to their icon files; presets map to null", () => {
  const expected = {
    white: "theme-white.png",
    amber: "theme-amber.png",
    orange: "theme-orange.png",
    blue: "theme-blue.png",
    green: "theme-green.png",
    purple: "theme-purple.png",
    pink: "theme-pink.png",
    cyan: "theme-cyan.png",
  };
  for (const [id, file] of Object.entries(expected)) {
    assert.equal(themeIconFile(id), file, `${id} must map to ${file}`);
    assert.ok(
      fs.existsSync(path.join(DESKTOP, "assets", "icons", file)),
      `${id} icon file ${file} missing`
    );
  }
  for (const id of ["studio", "dark", "light"]) {
    assert.equal(themeIconFile(id), null, `${id} must keep the static app icon`);
  }
});

test("neon theme colors match the sampled glow colors", () => {
  const expected = {
    white: "#ffffff",
    amber: "#ebaf14",
    orange: "#f66f16",
    blue: "#32abe8",
    green: "#81e227",
    purple: "#ad46ea",
    pink: "#f843a3",
    cyan: "#0ee2e5",
  };
  for (const [id, accent] of Object.entries(expected)) {
    assert.equal(themeById(id).accent, accent, `${id} accent must be ${accent}`);
  }
});

test("unknown theme ids resolve to nothing", () => {
  assert.equal(themeById("nope"), null);
  assert.equal(themeById(""), null);
  assert.equal(themeById(undefined), null);
  assert.equal(themeIconFile("nope"), null);
});
