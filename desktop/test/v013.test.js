"use strict";
/* v0.1.13: rename Sideshow → Shift Shift, companion browser
   extension (loopback server + pairing), in-place patch updates
   (electron-updater). v0.1.14: white default theme + white static
   icon, theme icons shrunk to 256, installer seeds the updater
   cache so patch updates can diff. Static checks for the pieces
   that need Electron to run live; the live behavior is verified
   headlessly in the smoke run. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DESKTOP = path.resolve(__dirname, "..");
const REPO = path.resolve(DESKTOP, "..");
const read = (p) => fs.readFileSync(p, "utf8");
const pkg = JSON.parse(read(path.join(DESKTOP, "package.json")));
const mainJs = read(path.join(DESKTOP, "main.js"));
const preloadJs = read(path.join(DESKTOP, "preload.js"));
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));
const settingsHtml = read(path.join(DESKTOP, "renderer", "settings.html"));
const indexHtml = read(path.join(DESKTOP, "renderer", "index.html"));
const nsi = read(path.join(DESKTOP, "installer.nsi"));
const helpHtml = read(path.join(REPO, "docs", "index.html"));
const packJs = read(path.join(DESKTOP, "scripts", "pack.js"));

/* ---------- Part 1: rename ---------- */

test("package.json: Shift Shift 0.1.14, new appId, GitHub publish config", () => {
  assert.equal(pkg.version, "0.1.14");
  assert.equal(pkg.build.productName, "Shift Shift");
  assert.equal(pkg.build.appId, "com.firedarts.shiftshift");
  assert.equal(pkg.name, "shift-shift-desktop");
  assert.equal(pkg.build.publish.provider, "github");
  assert.equal(pkg.build.publish.owner, "Kmberry1989");
  assert.equal(pkg.build.publish.repo, "sideshow");
  assert.equal(pkg.build.nsis.shortcutName, "Shift Shift");
  assert.equal(pkg.build.nsis.differentialPackage, true);
});

test("installer.nsi: Shift Shift names, 0.1.14, old Sideshow install removed, updater cache seeded", () => {
  assert.ok(nsi.includes('Name "Shift Shift"'), "NSIS Name");
  assert.ok(nsi.includes('OutFile "dist/Shift Shift Setup 0.1.14.exe"'), "NSIS OutFile");
  assert.ok(nsi.includes('"DisplayVersion" "0.1.14"'), "NSIS DisplayVersion");
  assert.ok(nsi.includes("$LOCALAPPDATA\\Programs\\Shift Shift"), "install dir");
  assert.ok(nsi.includes('RMDir /r "$LOCALAPPDATA\\Programs\\Sideshow"'), "old install removed on upgrade");
  assert.ok(!nsi.includes('Name "Sideshow"'), "no old app name left");
  /* v0.1.14: the installer must seed electron-updater's differential
     cache, or the first patch update is a full download (stock NSIS
     behavior our hand-written script was missing). */
  assert.ok(nsi.includes('CreateDirectory "$LOCALAPPDATA\\shift-shift-desktop-updater"'), "updater cache dir created");
  assert.ok(nsi.includes('CopyFiles /SILENT "$EXEPATH" "$LOCALAPPDATA\\shift-shift-desktop-updater\\installer.exe"'), "running installer copied to updater cache as installer.exe");
});

test("user-visible strings say Shift Shift (tray, settings title, OAuth page)", () => {
  assert.ok(mainJs.includes('tray.setToolTip("Shift Shift")'), "tray tooltip");
  assert.ok(mainJs.includes('{ label: "Show Shift Shift"'), "tray menu");
  assert.ok(mainJs.includes('title: "Shift Shift Settings"'), "settings window title");
  assert.ok(mainJs.includes("<p>Return to Shift Shift.</p>"), "OAuth success page");
  assert.ok(indexHtml.includes("<title>Shift Shift</title>"), "bubble title");
  assert.ok(settingsHtml.includes("<title>Shift Shift Settings</title>"), "settings title");
  assert.ok(helpHtml.includes("Shift Shift v0.1.14"), "help page version");
  assert.ok(!helpHtml.includes("Sideshow v0.1.12"), "no stale version in help");
});

test("pack.js names the app from package.json (productName + appId)", () => {
  assert.ok(packJs.includes("pkg.build.productName"), "packager name follows productName");
  assert.ok(packJs.includes("appBundleId: pkg.build.appId"), "packager bundle id follows appId");
  assert.ok(!packJs.includes('name: "Sideshow"'), "no hardcoded old name");
});

test("help page documents the extension and in-place updates", () => {
  assert.ok(helpHtml.includes("Browser extension"), "help covers the extension");
  assert.ok(helpHtml.includes("Shift Shift Fill"), "help names the extension");
  assert.ok(helpHtml.includes("Check for updates"), "help covers update checks");
  assert.ok(helpHtml.includes("Only the changed parts download"), "help explains differential updates");
});

/* ---------- userData migration (rename survival) ---------- */

const { migrateLegacyUserData, legacyUserDataDir, MIGRATED_FILES } = require("../migrate-userdata.js");

function tmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shift-shift-migrate-"));
  return root;
}

test("migration copies the settings + token from the old userData dir", () => {
  const root = tmpTree();
  const legacy = path.join(root, "sideshow-desktop");
  const current = path.join(root, "shift-shift-desktop");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "sideshow-settings.json"), '{"sound":false}');
  fs.writeFileSync(path.join(legacy, "sideshow-token.json"), '{"v":1}');
  const res = migrateLegacyUserData(current, root);
  assert.deepEqual(res.migrated.sort(), ["sideshow-settings.json", "sideshow-token.json"]);
  assert.equal(fs.readFileSync(path.join(current, "sideshow-settings.json"), "utf8"), '{"sound":false}');
  assert.equal(fs.readFileSync(path.join(current, "sideshow-token.json"), "utf8"), '{"v":1}');
  fs.rmSync(root, { recursive: true, force: true });
});

test("migration never overwrites, and is a no-op with no legacy dir", () => {
  const root = tmpTree();
  const legacy = path.join(root, "sideshow-desktop");
  const current = path.join(root, "shift-shift-desktop");
  fs.mkdirSync(legacy, { recursive: true });
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(legacy, "sideshow-settings.json"), '{"sound":false}');
  fs.writeFileSync(path.join(current, "sideshow-settings.json"), '{"sound":true}');
  const res = migrateLegacyUserData(current, root);
  assert.deepEqual(res.migrated, []);
  assert.equal(fs.readFileSync(path.join(current, "sideshow-settings.json"), "utf8"), '{"sound":true}');
  const res2 = migrateLegacyUserData(path.join(root, "shift-shift-desktop"), path.join(root, "no-such-appdata"));
  assert.deepEqual(res2.migrated, []);
  assert.equal(legacyUserDataDir(root), path.join(root, "sideshow-desktop"));
  assert.ok(MIGRATED_FILES.indexOf("sideshow-token.json") >= 0, "token migrates");
  assert.ok(MIGRATED_FILES.indexOf("firebase-config.json") >= 0, "userData config migrates");
  fs.rmSync(root, { recursive: true, force: true });
});

/* ---------- Part 2: extension wiring ---------- */

test("main wires the extension server + pairing IPC", () => {
  assert.ok(mainJs.includes('require("./extension-server.js")'), "main requires the server module");
  assert.ok(mainJs.includes("startExtensionServer()"), "server starts on launch");
  assert.ok(mainJs.includes("stopExtensionServer()"), "server stops on quit");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:events-full"'), "renderer pushes the full list");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-extension-token"'), "pairing code IPC");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:get-extension-status"'), "extension status IPC");
  assert.ok(mainJs.includes("extensionEventsPayload()"), "cache-file fallback for the server");
  assert.ok(preloadJs.includes('getExtensionToken: () => ipcRenderer.invoke("sideshow:get-extension-token")'), "preload exposes the token");
  assert.ok(preloadJs.includes('eventsFull: (list) => ipcRenderer.invoke("sideshow:events-full", list)'), "preload exposes events-full");
  assert.ok(rendererJs.includes("window.sideshow.eventsFull(full)"), "renderer sends the full merged list");
  assert.ok(settingsHtml.includes('id="extensionBtn"'), "settings has the pairing-code button");
  assert.ok(settingsHtml.includes('id="extensionCodeRow"'), "settings has the code row");
  assert.ok(rendererJs.includes('window.sideshow.getExtensionToken()'), "renderer fetches the code");
});

test("extension manifest is MV3 for Chrome + Edge, loopback + Facebook/Wix hosts", () => {
  const manifest = JSON.parse(read(path.join(REPO, "extension", "manifest.json")));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Shift Shift Fill");
  assert.equal(manifest.version, "0.1.14");
  assert.ok(manifest.host_permissions.indexOf("http://127.0.0.1:53683/*") >= 0, "loopback host");
  assert.ok(manifest.content_scripts[0].matches.indexOf("https://www.facebook.com/*") >= 0, "Facebook content script");
  assert.ok(manifest.content_scripts[0].js.indexOf("fill.js") >= 0, "fill logic ships with the content script");
  assert.ok(fs.existsSync(path.join(REPO, "extension", "README.md")), "extension README exists");
  assert.ok(fs.existsSync(path.join(REPO, "extension", "test-page.html")), "extension test page exists");
});

/* ---------- Part 3: in-place updates ---------- */

test("electron-updater wired: launch check, tray + settings manual check", () => {
  assert.ok(pkg.dependencies["electron-updater"], "electron-updater dependency");
  assert.ok(mainJs.includes('require("electron-updater")'), "main requires electron-updater");
  assert.ok(mainJs.includes("autoUpdater.autoDownload = true"), "auto-download on");
  assert.ok(mainJs.includes("autoUpdater.autoInstallOnAppQuit = true"), "install on quit");
  assert.ok(mainJs.includes('autoUpdater.on("update-downloaded"'), "downloaded notification");
  assert.ok(mainJs.includes("autoUpdater.quitAndInstall()"), "restart-to-install on click");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:check-for-updates"'), "manual check IPC");
  assert.ok(mainJs.includes('if (!app.isPackaged) return;'), "updater skipped unpackaged");
  assert.ok(mainJs.includes('{ label: "Check for updates"'), "tray manual check");
  assert.ok(mainJs.includes("setTimeout(() => { checkForUpdates(); }, 30000)"), "launch check after 30 s");
  assert.ok(preloadJs.includes('checkForUpdates: () => ipcRenderer.invoke("sideshow:check-for-updates")'), "preload exposes the check");
  assert.ok(settingsHtml.includes('id="checkUpdatesBtn"'), "settings has the check button");
  assert.ok(rendererJs.includes("window.sideshow.checkForUpdates()"), "renderer runs the check");
});

/* ---------- publish script helpers ---------- */

const { computeFileHash, buildLatestYml, publishedInstallerName, buildBlockmap } = require("../scripts/publish-release.js");

test("publish helpers: latest.yml shape, published name, file hash", () => {
  assert.equal(publishedInstallerName("0.1.14"), "Shift.Shift.Setup.0.1.14.exe");
  const yml = buildLatestYml({
    version: "0.1.14",
    fileName: "Shift.Shift.Setup.0.1.14.exe",
    sha512: "abc123==",
    size: 12345,
    releaseDate: "2026-11-19T00:00:00.000Z",
  });
  assert.ok(yml.includes("version: 0.1.14"), "yml version");
  assert.ok(yml.includes("url: Shift.Shift.Setup.0.1.14.exe"), "yml file url");
  assert.ok(yml.includes("sha512: abc123=="), "yml sha512");
  assert.ok(yml.includes("size: 12345"), "yml size");
  assert.ok(yml.includes("path: Shift.Shift.Setup.0.1.14.exe"), "yml path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shift-shift-publish-"));
  const file = path.join(dir, "x.bin");
  fs.writeFileSync(file, "hello");
  const { sha512, size } = computeFileHash(file);
  assert.equal(size, 5);
  assert.equal(sha512.length, 88, "base64 sha512 is 88 chars");
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------- app-update.yml (updater feed config) ---------- */

const { buildUpdateYml, updaterCacheDirName } = require("../scripts/write-update-config.js");

test("app-update.yml builder: GitHub provider + updater cache dir name", () => {
  assert.equal(updaterCacheDirName("shift-shift-desktop"), "shift-shift-desktop-updater");
  const yml = buildUpdateYml({ provider: "github", owner: "Kmberry1989", repo: "sideshow" }, "shift-shift-desktop");
  assert.ok(yml.includes("provider: github"), "yml provider");
  assert.ok(yml.includes("owner: Kmberry1989"), "yml owner");
  assert.ok(yml.includes("repo: sideshow"), "yml repo");
  assert.ok(yml.includes("updaterCacheDirName: shift-shift-desktop-updater"), "yml cache dir name");
});

test("publish helpers: blockmap builds for a file and parses back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shift-shift-blockmap-"));
  const file = path.join(dir, "fake-installer.exe");
  fs.writeFileSync(file, Buffer.alloc(200000, 7));
  const blockmapPath = await buildBlockmap(file);
  assert.ok(fs.existsSync(blockmapPath), "blockmap file written");
  assert.ok(fs.statSync(blockmapPath).size > 0, "blockmap non-empty");
  const zlib = require("node:zlib");
  const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(blockmapPath)).toString("utf8"));
  assert.equal(parsed.version, "2", "blockmap version 2");
  assert.ok(Array.isArray(parsed.files), "blockmap has a files array");
  assert.ok(parsed.files.length > 0 && parsed.files[0].checksums.length > 0, "blockmap has chunk checksums");
  fs.rmSync(dir, { recursive: true, force: true });
});
