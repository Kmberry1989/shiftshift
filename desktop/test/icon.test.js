"use strict";
/* Icon test: the Shift Shift app icon (orange Shift²) must exist in
   every platform format the build config points at, and each file
   must parse. The bug this guards: the v0.1.13 darwin pack warned
   "Could not find icon assets/icon with extension .icon" — which
   turned out to be the optional Apple Icon Composer format, not the
   .icns — but a missing .icns/.ico would silently ship the default
   Electron icon. The eight theme icons (assets/icons/theme-*.png)
   are the same Shift² tile in each neon color, cropped from Kyle's
   uploads with transparent rounded corners. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const DESKTOP = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf-8"));
const { THEMES } = require("../theme-icons.js");

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

test("static app icon is the orange Shift² theme master", () => {
  const icon = fs.readFileSync(path.join(DESKTOP, "assets", "icon.png"));
  const orange = fs.readFileSync(path.join(DESKTOP, "assets", "icons", "theme-orange.png"));
  assert.deepEqual(icon, orange, "icon.png must be byte-identical to theme-orange.png");
});

/* Minimal PNG decode (8-bit RGBA only): inflate IDAT and reverse the
   per-row filters, so the corner-transparency check reads real
   pixels instead of trusting the header. */
function pngPixels(buf) {
  assert.deepEqual(buf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "not a PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  assert.equal(bitDepth, 8, "expected 8-bit PNG");
  assert.equal(colorType, 6, "expected RGBA PNG (color type 6)");
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("ascii");
    if (type === "IDAT") idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const px = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const v = row[i];
      let r;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`unknown PNG filter ${filter}`);
      out[i] = r & 0xff;
    }
    prev = Buffer.from(out);
  }
  return { width, height, px };
}

function alphaAt(p, x, y) {
  return p.px[(y * p.width + x) * 4 + 3];
}

test("all 8 theme icons exist, are 1024x1024 RGBA, corners transparent", () => {
  const neon = THEMES.filter((t) => t.icon);
  assert.equal(neon.length, 8, `expected 8 neon themes, got ${neon.length}`);
  for (const t of neon) {
    const buf = fs.readFileSync(path.join(DESKTOP, "assets", "icons", t.icon));
    assert.ok(buf.length > 10000, `${t.icon} suspiciously small`);
    const p = pngPixels(buf);
    assert.deepEqual({ width: p.width, height: p.height }, { width: 1024, height: 1024 }, `${t.icon} must be 1024x1024`);
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) {
      assert.equal(alphaAt(p, x, y), 0, `${t.icon} corner (${x},${y}) must be transparent`);
    }
    assert.equal(alphaAt(p, 512, 512), 255, `${t.icon} center must be opaque`);
  }
});
