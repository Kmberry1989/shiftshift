"use strict";
/* Shift Shift release publisher (v0.1.13).
   The Windows installer is built by the custom makensis flow
   (electron-builder --win --dir + installer.nsi), so electron-builder
   never generates the update metadata itself. This script does the
   part electron-builder would have done, for the GitHub release:
     1. Builds the standalone .blockmap for the installer (the
        differential-update map electron-updater downloads). Every
        release must publish it, or the NEXT update cannot download
        differentially — the updater fetches the old version's
        .blockmap from the old release's assets.
     2. Writes latest.yml (version, file, sha512, size) — the file
        electron-updater reads to find the update.
     3. With --publish, creates the GitHub release (tag v<version>)
        and uploads installer + .blockmap + latest.yml (+ zips).
   Dry-run by default: builds the artifacts in dist/ and prints the
   exact `gh release create` command, but uploads nothing.
   The published installer name uses dots ("Shift Shift.Setup.0.1.13.exe"),
   matching the v0.1.12 asset naming ("Sideshow.Setup.0.1.12.exe");
   the makensis output ("Shift Shift Setup 0.1.13.exe", spaces) is
   copied to that name — content identical, so the blockmap stays
   valid. Usage (from desktop/):
     node scripts/publish-release.js [--installer <path>] [--publish] [--zips <a.zip,b.zip>] */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const pkg = require("../package.json");

function computeFileHash(file) {
  const data = fs.readFileSync(file);
  return {
    sha512: crypto.createHash("sha512").update(data).digest("base64"),
    size: data.length,
  };
}

/* latest.yml, the exact shape electron-updater's GitHub provider
   reads: version, files[] (url/sha512/size), path, sha512,
   releaseDate. `fileName` is the published asset name. */
function buildLatestYml({ version, fileName, sha512, size, releaseDate }) {
  return (
    "version: " + version + "\n" +
    "files:\n" +
    "  - url: " + fileName + "\n" +
    "    sha512: " + sha512 + "\n" +
    "    size: " + size + "\n" +
    "path: " + fileName + "\n" +
    "sha512: " + sha512 + "\n" +
    "releaseDate: '" + (releaseDate || new Date().toISOString()) + "'\n"
  );
}

/* The published installer name: dots, no spaces. */
function publishedInstallerName(version) {
  return "Shift Shift.Setup." + version + ".exe";
}

/* Build the standalone .blockmap for the installer, exactly as
   electron-builder's NsisTarget does (gzip-compressed blockmap,
   "<file>.blockmap"). Returns the blockmap path. */
async function buildBlockmap(installerPath) {
  const { buildBlockMap } = require("app-builder-lib/out/targets/blockmap/blockmap");
  const blockmapPath = installerPath + ".blockmap";
  await buildBlockMap(installerPath, "gzip", blockmapPath);
  return blockmapPath;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  const doPublish = args.indexOf("--publish") >= 0;
  const version = pkg.version;
  const productName = pkg.build.productName;
  const installerPath = getArg("--installer") || path.join("dist", productName + " Setup " + version + ".exe");
  if (!fs.existsSync(installerPath)) {
    throw new Error("installer not found: " + installerPath + " — build it first (npm run dist:win-native)");
  }
  const publishedName = publishedInstallerName(version);
  const publishedPath = path.join(path.dirname(installerPath), publishedName);
  if (path.resolve(publishedPath) !== path.resolve(installerPath)) {
    fs.copyFileSync(installerPath, publishedPath);
  }
  const blockmapPath = await buildBlockmap(publishedPath);
  const publishedBlockmap = publishedPath + ".blockmap";
  if (path.resolve(blockmapPath) !== path.resolve(publishedBlockmap)) {
    fs.renameSync(blockmapPath, publishedBlockmap);
  }
  const { sha512, size } = computeFileHash(publishedPath);
  const yml = buildLatestYml({ version, fileName: publishedName, sha512, size });
  const ymlPath = path.join(path.dirname(installerPath), "latest.yml");
  fs.writeFileSync(ymlPath, yml, "utf8");

  const zips = (getArg("--zips") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const assets = [publishedPath, publishedBlockmap, ymlPath].concat(zips);
  console.log("version: " + version);
  console.log("installer: " + publishedPath + " (" + size + " bytes, sha512 " + sha512.slice(0, 16) + "…)");
  console.log("blockmap: " + publishedBlockmap);
  console.log("latest.yml: " + ymlPath);
  console.log("assets: " + assets.join(", "));
  if (!doPublish) {
    console.log("dry run — nothing uploaded. To publish:");
    console.log(
      "  gh release create v" + version + " " + assets.map((a) => '"' + a + '"').join(" ") +
      ' --title "v' + version + '" --notes "Shift Shift v' + version + '"',
    );
    return;
  }
  execFileSync("gh", [
    "release", "create", "v" + version,
    ...assets,
    "--title", "v" + version,
    "--notes", "Shift Shift v" + version,
  ], { stdio: "inherit" });
  console.log("published v" + version);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message || err); process.exit(1); });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeFileHash, buildLatestYml, publishedInstallerName, buildBlockmap };
}
