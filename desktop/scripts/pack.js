"use strict";
/* Pack portable zips via the electron-packager API (not its CLI): the CLI
   cannot take hook functions, and the locale trim needs the afterExtract
   hook (scripts/after-extract.js). The .map exclusion rides on the `ignore`
   option, which the CLI does accept — but keeping both here keeps the whole
   trim in one place. Usage: node scripts/pack.js win32 darwin | linux
   (run from desktop/, so paths resolve against the app dir).
   Output dirs are "Shift Shift-<platform>-x64" under dist/; the darwin
   dir is renamed to "Shift Shift-mac-x64" before zipping (see the
   release notes) to match the published asset names. */
const packager = require("@electron/packager");
const afterExtract = require("./after-extract");
const pkg = require("../package.json");

async function main() {
  const platforms = process.argv.slice(2);
  if (platforms.length === 0) {
    throw new Error("usage: node scripts/pack.js <platform> [<platform> ...]");
  }
  for (const platform of platforms) {
    const out = await packager({
      dir: ".",
      name: pkg.build.productName,
      appBundleId: pkg.build.appId,
      platform,
      arch: "x64",
      out: "dist",
      overwrite: true,
      icon: "assets/icon",
      ignore: /\.map$/,
      afterExtract: [afterExtract],
    });
    console.log(`packed: ${out.join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
