"use strict";
/* v0.1.16: dragging disabled (Kyle's call — the scale issue
   persisted through two fixes), the extension fill rebuilt to the
   live Facebook form (comboboxes + portal clicks, wait-and-verify
   at each step), and the repo rename finished (sideshow →
   shiftshift) in the publish config, HELP_URL, and help links.
   The drag-removal behavior assertions live in
   test/no-drag.test.js; the Facebook fill behavior assertions live
   in test/extension-fill.test.js. This file pins the version,
   the repo name, and the new fill wiring. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const pkg = JSON.parse(read(path.join(DESKTOP, "package.json")));
const mainJs = read(path.join(DESKTOP, "main.js"));
const helpHtml = read(path.join(REPO, "docs", "index.html"));
const fillJs = read(path.join(REPO, "extension", "fill.js"));
const contentJs = read(path.join(REPO, "extension", "content.js"));
const writeUpdateConfigJs = read(path.join(DESKTOP, "scripts", "write-update-config.js"));

test("version 0.1.16 everywhere it is pinned", () => {
  assert.equal(pkg.version, "0.1.16");
  assert.ok(helpHtml.includes("Shift Shift v0.1.16"), "help page must say v0.1.16");
});

test("publish config and HELP_URL point at the renamed repo shiftshift", () => {
  assert.equal(pkg.build.publish.owner, "Kmberry1989");
  assert.equal(pkg.build.publish.repo, "shiftshift");
  assert.ok(mainJs.includes('const HELP_URL = "https://kmberry1989.github.io/shiftshift/"'), "HELP_URL must be the shiftshift Pages URL");
  assert.ok(!mainJs.includes("github.io/sideshow"), "no old repo name in the help URL");
  assert.ok(writeUpdateConfigJs.includes("publish.repo"), "the update config must take the repo from the publish config");
  assert.ok(helpHtml.includes("Kmberry1989/shiftshift"), "help page must link the renamed repo");
  assert.ok(!helpHtml.includes("github.io/sideshow"), "help page must not link the old Pages URL");
  assert.ok(!helpHtml.includes("Kmberry1989/sideshow"), "help page must not link the old repo");
});

test("the extension fill is the Facebook combobox driver, not the mock-DOM setter", () => {
  const fill = require("../../extension/fill.js");
  assert.equal(typeof fill.fillFacebookForm, "function", "fill.js must export the async Facebook driver");
  assert.ok(fillJs.includes("pickCalendarDay"), "dates must be picked by clicking gridcells");
  assert.ok(fillJs.includes("gridcell"), "the calendar picker must look for gridcells");
  assert.ok(fillJs.includes("optionsInOpenListbox"), "portal options must be picked from the open listbox");
  assert.ok(!fillJs.includes('getAttribute("aria-expanded")'), "aria-expanded must never be read — it lies when a popup closes on its own");
  assert.ok(fillJs.includes("locationStuck"), "a location must verify it stuck, not just typed text");
  assert.ok(contentJs.includes("fillFacebookForm"), "the content script must drive the Facebook fill");
  assert.ok(contentJs.includes("MAX_ATTEMPTS = 3"), "the content script must retry the whole pass up to 3 times");
  assert.ok(!contentJs.includes("MutationObserver"), "the old settle observer is gone with the callback retry loop");
});

test("dragging stays disabled: the drag module and its IPC are gone", () => {
  assert.ok(!fs.existsSync(path.join(DESKTOP, "renderer", "drag.js")), "renderer/drag.js must not exist");
  for (const ch of ["sideshow:drag-start", "sideshow:drag-move", "sideshow:drag-end"]) {
    assert.ok(!mainJs.includes(ch), "main must not handle " + ch);
  }
  assert.ok(helpHtml.includes("dragging is disabled"), "help page must say dragging is disabled");
});
