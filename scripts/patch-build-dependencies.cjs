// Backport the MIT-licensed minimatch author's security bounds; retain original
// licenses and APIs. See patches/ for upstream provenance and exact checksums.
// Old version numbers remain visible to scanners: do not claim npm audit is clean.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const manifest = require("../patches/minimatch-backport.json");
const digest = (content) => createHash("sha256").update(content).digest("hex");

function patchSource(source, checksums) {
  if (digest(source) === checksums.after_sha256) return source;
  if (digest(source) !== checksums.before_sha256)
    throw Error("Unexpected minimatch source; review upstream before building");
  const output = source
    .replace(
      "    firstPhasePreProcess(globParts) {\n",
      "    firstPhasePreProcess(globParts) {\n        const { braceExpandMax = 100_000 } = this.options;\n",
    )
    .replace(
      "                        p2 === '..') {",
      "                        p2 === '..' ||\n                        globParts.length >= braceExpandMax) {",
    )
    .replace(
      "    secondPhasePreProcess(globParts) {\n",
      "    secondPhasePreProcess(globParts) {\n        if (globParts.length > 1000) return globParts;\n",
    );
  if (digest(output) !== checksums.after_sha256)
    throw Error("Minimatch backport checksum mismatch");
  return output;
}

function apply() {
  const patch = fs.readFileSync(path.join(root, "patches/minimatch-77a0f5c-upstream.patch"));
  if (digest(patch) !== manifest.upstream_patch_sha256)
    throw Error("Upstream minimatch patch provenance checksum mismatch");
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json")));
  let patched = 0;
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location.endsWith("/minimatch")) continue;
    const directory = path.join(root, location);
    // npm --omit=dev legitimately excludes build tools.
    if (!fs.existsSync(directory)) {
      if (entry.dev) continue;
      throw Error("Required minimatch dependency is missing");
    }
    const actual = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
    if (actual.version !== entry.version)
      throw Error("Minimatch version differs from the reviewed lockfile");
    const checksums = manifest.versions[entry.version];
    if (!checksums) {
      if (!["3.1.5", "5.1.9"].includes(entry.version))
        throw Error("Unreviewed minimatch version; review this security backport");
      const legacy = fs.readFileSync(path.join(directory, "minimatch.js"), "utf8");
      if (/firstPhasePreProcess|secondPhasePreProcess/.test(legacy))
        throw Error("Unexpected preprocessing in legacy minimatch");
      continue;
    }
    for (const [mode, hashes] of Object.entries(checksums)) {
      const filename = path.join(directory, "dist", mode, "index.js");
      const source = fs.readFileSync(filename, "utf8");
      const output = patchSource(source, hashes);
      if (output !== source) fs.writeFileSync(filename, output);
      patched++;
    }
  }
  return patched;
}

if (require.main === module) {
  console.log(`Verified minimatch preprocessing security backport (${apply()} modules). Scanner findings remain version-based.`);
}
module.exports = { apply, patchSource, manifest, digest };
