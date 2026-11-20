"use strict";
/* v0.1.15 static checks (no Electron needed): version bump, the
   drag freeze + pointer capture (see drag.test.js for the behavior
   assertions), the click-through leaf selector (see
   click-through.test.js), and the Create event shortcut button. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const pkg = JSON.parse(read(path.join(DESKTOP, "package.json")));
const mainJs = read(path.join(DESKTOP, "main.js"));
const preloadJs = read(path.join(DESKTOP, "preload.js"));
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));
const indexHtml = read(path.join(DESKTOP, "renderer", "index.html"));
const nsi = read(path.join(DESKTOP, "installer.nsi"));
const helpHtml = read(path.join(REPO, "docs", "index.html"));

const FACEBOOK_CREATE_URL = "https://www.facebook.com/events/create";
/* The studio's Wix site (www.firedartsstudio.com) metaSiteId, from
   the site's public page source; the new-event dashboard page is
   /dashboard/{metaSiteId}/events/new per Wix's Events Dashboard
   Navigation contract. */
const WIX_NEW_EVENT_URL = "https://manage.wix.com/dashboard/cf57070b-8114-45e4-95b1-7242bf48c467/events/new";

test("package.json, installer.nsi, and docs all say 0.1.15", () => {
  assert.equal(pkg.version, "0.1.15");
  assert.ok(nsi.includes('OutFile "dist/Shift Shift Setup 0.1.15.exe"'), "installer OutFile must be 0.1.15");
  assert.ok(nsi.includes('"DisplayVersion" "0.1.15"'), "installer DisplayVersion must be 0.1.15");
  assert.ok(helpHtml.includes("Shift Shift v0.1.15"), "the help page must say v0.1.15");
});

test("Create event: the header has the button and a two-choice menu", () => {
  assert.ok(indexHtml.includes('id="createEventBtn"'), "the header must have the Create event button");
  assert.ok(indexHtml.includes('id="createEventMenu"'), "the header must have the Create event menu");
  assert.ok(indexHtml.includes('data-target="facebook"'), "the menu must have a Facebook choice");
  assert.ok(indexHtml.includes('data-target="wix"'), "the menu must have a Wix choice");
  assert.ok(indexHtml.includes("Facebook</span>"), "the Facebook choice must be labelled Facebook");
  assert.ok(indexHtml.includes("Wix</span>"), "the Wix choice must be labelled Wix");
  assert.ok(helpHtml.includes("create-event button"), "the help page must describe the Create event button");
});

test("Create event: the two URLs opened are exactly the create-event pages", () => {
  assert.ok(rendererJs.includes('facebook: "' + FACEBOOK_CREATE_URL + '"'), "the Facebook target must be the create-event page");
  assert.ok(rendererJs.includes('wix: "' + WIX_NEW_EVENT_URL + '"'), "the Wix target must be the studio's new-event dashboard page");
  /* The menu opens the URL through the preload bridge, never by
     navigating the bubble itself. */
  assert.ok(rendererJs.includes("window.sideshow.openExternal(url)"), "the menu must open the URL through openExternal");
  assert.ok(preloadJs.includes('openExternal: (url) => ipcRenderer.invoke("sideshow:open-external", url)'), "the preload must expose openExternal");
});

test("Create event: main only opens the two allowlisted URLs, nothing else", () => {
  assert.ok(mainJs.includes('"' + FACEBOOK_CREATE_URL + '"'), "the allowlist must contain the Facebook URL");
  assert.ok(mainJs.includes('"' + WIX_NEW_EVENT_URL + '"'), "the allowlist must contain the Wix URL");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:open-external"'), "main must handle open-external");
  assert.ok(mainJs.includes("if (typeof url !== \"string\" || !CREATE_EVENT_URLS.has(url)) return false;"), "a URL outside the allowlist must be refused");
});

test("Create event: the menu closes on Escape, outside pointerdown, and panel hide", () => {
  assert.ok(rendererJs.includes('if (e.key === "Escape") closeCreateMenu();'), "Escape must close the menu");
  assert.ok(rendererJs.includes('e.target.closest("#createEventMenu")'), "a pointerdown outside the menu must close it");
  assert.ok(rendererJs.includes('if (createEventMenu) createEventMenu.hidden = true;'), "hiding the panel must close the menu");
});
