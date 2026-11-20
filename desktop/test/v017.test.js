"use strict";
/* v0.1.17: sign-in for the wrong-browser case (Kyle's pick: both
   fixes). Google always shows the account chooser
   (prompt=select_account, kept alongside consent), and the sign-in
   flow has a "Copy sign-in link" control that copies the exact
   authorization URL the app generated, so the user can paste it
   into whichever browser/profile holds the right account. The
   loopback redirect lands in the app no matter which browser
   completes the flow; the PKCE verifier never leaves main. This
   file pins the version and the new sign-in wiring. */
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
const settingsHtml = read(path.join(DESKTOP, "renderer", "settings.html"));
const rendererJs = read(path.join(DESKTOP, "renderer", "renderer.js"));
const helpHtml = read(path.join(REPO, "docs", "index.html"));
const nsi = read(path.join(DESKTOP, "installer.nsi"));

test("version 0.1.17 everywhere it is pinned", () => {
  assert.equal(pkg.version, "0.1.17");
  assert.ok(helpHtml.includes("Shift Shift v0.1.17"), "help page must say v0.1.17");
  assert.ok(nsi.includes('OutFile "dist/Shift Shift Setup 0.1.17.exe"'), "installer OutFile must be 0.1.17");
  assert.ok(nsi.includes('"DisplayVersion" "0.1.17"'), "installer DisplayVersion must be 0.1.17");
});

test("the auth URL is built by the pure google-auth module", () => {
  const { buildGoogleAuthUrl } = require("../google-auth.js");
  const url = new URL(buildGoogleAuthUrl({
    clientId: "c",
    redirectUri: "http://127.0.0.1:53682/callback",
    state: "s",
    challenge: "h",
  }));
  assert.equal(url.searchParams.get("prompt"), "consent select_account");
  assert.ok(mainJs.includes('require("./google-auth.js")'), "main must use the google-auth module");
  assert.ok(mainJs.includes("buildGoogleAuthUrl"), "main must build the URL via the module");
  assert.ok(!mainJs.includes('prompt: "consent"'), "the bare consent-only prompt must be gone");
  assert.ok(!mainJs.includes("o/oauth2/v2/auth?\" + params"), "the inline URL build must be gone");
});

test("main stores the generated URL and exposes the copy IPC", () => {
  assert.ok(mainJs.includes("authUrlStore.set(authUrl)"), "main must store the generated URL for the attempt");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:copy-sign-in-link"'), "main must handle the copy IPC");
  assert.ok(mainJs.includes("copySignInLink(authUrlStore, clipboard)"), "the copy handler must read the stored URL");
  assert.ok(mainJs.includes('ipcMain.handle("sideshow:sign-in-active"'), "main must report whether a sign-in is active");
  assert.ok(mainJs.includes('"sideshow:auth-started"'), "main must announce the flow starting");
  assert.ok(mainJs.includes('"sideshow:auth-ended"'), "main must announce the flow ending");
  assert.ok(mainJs.includes("authUrlStore.clear()"), "the stored URL must clear when the attempt ends");
});

test("preload exposes the copy control and the flow events", () => {
  assert.ok(preloadJs.includes('copySignInLink: () => ipcRenderer.invoke("sideshow:copy-sign-in-link")'), "preload must expose copySignInLink");
  assert.ok(preloadJs.includes('signInActive: () => ipcRenderer.invoke("sideshow:sign-in-active")'), "preload must expose signInActive");
  assert.ok(preloadJs.includes('onAuthStarted: (fn) => ipcRenderer.on("sideshow:auth-started"'), "preload must expose onAuthStarted");
  assert.ok(preloadJs.includes('onAuthEnded: (fn) => ipcRenderer.on("sideshow:auth-ended"'), "preload must expose onAuthEnded");
});

test("the settings window has the copy control and the renderer wires it", () => {
  assert.ok(settingsHtml.includes('id="copySignInLinkBtn"'), "settings must have the copy button");
  assert.ok(settingsHtml.includes("Copy sign-in link"), "the button must say Copy sign-in link");
  assert.ok(rendererJs.includes("copySignInLinkBtn"), "the renderer must wire the copy button");
  assert.ok(rendererJs.includes("window.sideshow.copySignInLink()"), "the button must call the preload copy");
  assert.ok(rendererJs.includes("window.sideshow.signInActive()"), "the renderer must check for a mid-flow settings open");
  assert.ok(rendererJs.includes("window.sideshow.onAuthStarted"), "the renderer must listen for the flow starting");
  assert.ok(rendererJs.includes("window.sideshow.onAuthEnded"), "the renderer must listen for the flow ending");
  assert.ok(helpHtml.includes("Copy sign-in link"), "the help page must document the copy control");
});

test("the sign-in flow is otherwise unchanged", () => {
  assert.ok(mainJs.includes("const OAUTH_PORT = 53682"), "loopback port stays 53682");
  assert.ok(mainJs.includes("await revokeRefreshToken()"), "the revoke-before-open behavior stays");
  assert.ok(mainJs.includes("stopOAuthServer()"), "the OAuth server still stops on callback");
});
