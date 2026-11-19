"use strict";
/* Write app-update.yml into the Windows unpacked build.
   electron-builder normally writes this file itself when it creates
   an installer artifact — but the Shift Shift installer is built by
   the custom makensis step (electron-builder --win --dir + makensis),
   so no artifact event ever fires and the file never appears.
   Without it, electron-updater has no feed to check: in production
   it reads process.resourcesPath/app-update.yml for the provider.
   This script writes exactly what electron-builder would have
   written (publish config from package.json + updaterCacheDirName,
   which is the sanitized package name, lowercased, + "-updater").
   Run after `electron-builder --win --dir`, before makensis:
     node scripts/write-update-config.js
   The installer then carries the file into the install dir. */
const fs = require("fs");
const path = require("path");

const pkg = require("../package.json");

/* Same rule as app-builder-lib AppInfo.updaterCacheDirName:
   sanitized package name, lowercased, + "-updater". The name here
   is already filename-safe ("shift-shift-desktop"). */
function updaterCacheDirName(packageName) {
  return String(packageName).replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase() + "-updater";
}

function buildUpdateYml(publish, packageName) {
  const config = {
    provider: publish.provider,
    owner: publish.owner,
    repo: publish.repo,
    updaterCacheDirName: updaterCacheDirName(packageName),
  };
  const { serializeToYaml } = require("builder-util");
  return serializeToYaml(config);
}

function main() {
  const outDir = path.join("dist", "win-unpacked", "resources");
  const outPath = path.join(outDir, "app-update.yml");
  if (!fs.existsSync(outDir)) {
    throw new Error("unpacked resources dir not found: " + outDir + " — run electron-builder --win --dir first");
  }
  const yml = buildUpdateYml(pkg.build.publish, pkg.name);
  fs.writeFileSync(outPath, yml, "utf8");
  console.log("wrote " + outPath + ":\n" + yml);
}

if (require.main === module) {
  main();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildUpdateYml, updaterCacheDirName };
}
