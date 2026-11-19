"use strict";
/* Shift Shift userData migration (v0.1.13 rename).
   The npm package name changed from "sideshow-desktop" to
   "shift-shift-desktop", and Electron's userData directory follows
   the package name (appData/<name>). The settings, the encrypted
   sign-in token, the reminders, and the cached events live there —
   without a migration the rename would silently drop the sign-in
   and every setting on first launch of the renamed app. On startup,
   before anything reads settings, copy each known file from the
   legacy directory (appData/sideshow-desktop) into the new one
   when the new one does not already have it. Never deletes, never
   overwrites, and one file failing never blocks the rest. */
const fs = require("fs");
const path = require("path");

const LEGACY_NAME = "sideshow-desktop";
const MIGRATED_FILES = [
  "sideshow-settings.json",
  "sideshow-token.json",
  "sideshow-reminders.json",
  "sideshow-events-cache.json",
  "firebase-config.json",
];

function legacyUserDataDir(appDataDir) {
  return path.join(appDataDir, LEGACY_NAME);
}

function migrateLegacyUserData(userDataDir, appDataDir, fsImpl) {
  const f = fsImpl || fs;
  const legacyDir = legacyUserDataDir(appDataDir);
  if (path.resolve(legacyDir) === path.resolve(userDataDir)) return { migrated: [], legacyDir };
  const migrated = [];
  for (const name of MIGRATED_FILES) {
    const dest = path.join(userDataDir, name);
    const src = path.join(legacyDir, name);
    try {
      if (f.existsSync(dest)) continue;
      if (!f.existsSync(src)) continue;
      f.mkdirSync(userDataDir, { recursive: true });
      f.copyFileSync(src, dest);
      migrated.push(name);
    } catch (e) { /* one file failing never blocks the rest */ }
  }
  return { migrated, legacyDir };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { migrateLegacyUserData, legacyUserDataDir, MIGRATED_FILES, LEGACY_NAME };
}
