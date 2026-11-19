"use strict";
/* Icon test: the Shift Shift app icon (Arrows S) must exist in every
   platform format the build config points at, and each file must parse.
   The bug this guards: the v0.1.13 darwin pack warned "Could not find
   icon assets/icon with extension .icon" — which turned out to be the
   optional Apple Icon Composer format, not the .icns — but a missing
   .icns/.ico would silently ship the default Electron icon. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf-8"));

function pngSize(buf) {
  assert.deepEqual(buf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function icnsTypes(buf) {
  assert.equal(buf.subarray(0, 4).toString("ascii"), "icns", "not an icns file");
  const types = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const type = buf.subarray(off, off + 4).toString("ascii");
    const len = buf.readUInt32BE(off + 4);
    assert.ok(len >= 8 && off + len <= buf.length, `bad icns element ${type} len ${len}`);
    types.push(type);
    off += len;
  }
  return types;
}

test("app icon PNG master exists and is 1024x1024", () => {
  const buf = fs.readFileSync(path.join(DESKTOP, "assets", "icon.png"));
  assert.ok(buf.length > 10000, "icon.png suspiciously small");
  assert.deepEqual(pngSize(buf), { width: 1024, height: 1024 });
});

test("Windows ICO exists and holds 5 sizes (16/24/32/48/256)", () => {
  const buf = fs.readFileSync(path.join(DESKTOP, "assets", "icon.ico"));
  assert.equal(buf.readUInt16LE(0), 0, "ico reserved field");
  assert.equal(buf.readUInt16LE(2), 1, "ico type field (must be 1 = icon)");
  const count = buf.readUInt16LE(4);
  assert.equal(count, 5, `expected 5 ico images, got ${count}`);
  const widths = [];
  for (let i = 0; i < count; i++) {
    const w = buf[6 + i * 16] || 256;
    widths.push(w);
  }
  assert.deepEqual(widths.sort((a, b) => a - b), [16, 24, 32, 48, 256]);
});

test("macOS ICNS exists and holds all 7 required elements", () => {
  const buf = fs.readFileSync(path.join(DESKTOP, "assets", "icon.icns"));
  const types = icnsTypes(buf);
  for (const t of ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10"]) {
    assert.ok(types.includes(t), `icns missing element ${t}`);
  }
});

test("build config icon paths point at existing files", () => {
  const build = pkg.build || {};
  for (const key of ["mac", "win", "linux"]) {
    const icon = build[key] && build[key].icon;
    assert.ok(icon, `build.${key}.icon not set`);
    assert.ok(fs.existsSync(path.join(DESKTOP, icon)), `build.${key}.icon ${icon} does not exist`);
  }
});
