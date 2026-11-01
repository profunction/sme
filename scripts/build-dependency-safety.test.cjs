const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { apply, patchSource, manifest } = require("./patch-build-dependencies.cjs");

test("official preprocessing backport is idempotent and rejects unknown sources", () => {
  assert.equal(apply(), 4);
  assert.equal(apply(), 4);
  assert.throws(() => patchSource("unexpected source", manifest.versions["10.2.6"].commonjs), /Unexpected/);
});

for (const location of ["minimatch", "@electron/universal/node_modules/minimatch"]) {
  for (const mode of ["commonjs", "esm"]) {
  test(`${location} ${mode}: adversarial expansion is bounded and matching remains compatible`, () => {
    // The exploit runs in an owned child with an external timeout so a regression
    // cannot hang the entire build/test runner indefinitely.
    const code = `
      (async () => {
      const assert = require('node:assert/strict');
      const { Minimatch } = ${mode === "commonjs" ? `require(${JSON.stringify(location)})` : `await import(${JSON.stringify(pathToFileURL(path.join(__dirname, "../node_modules", location, "dist/esm/index.js")).href)})`};
      const large = new Minimatch(Array(30).fill('**/../a/b').join('/'), { optimizationLevel: 2, braceExpandMax: 64 });
      assert.equal(large.set.length, 64);
      const small = new Minimatch('**/../a/b/**/../c/d', { optimizationLevel: 2 });
      assert.equal(small.set.length, 4);
      assert.equal(small.match('../a/b/../c/d'), true);
      assert.equal(small.match('x/a/b/y/c/d'), true);
      const dedupe = new Minimatch('{x,*}/{0..999}', { optimizationLevel: 2 });
      assert.equal(dedupe.set.length, 2000);
      assert.equal(dedupe.match('x/5'), true);
      assert.equal(dedupe.match('y/999'), true);
      assert.equal(dedupe.match('.y/5'), false);
      })().catch(error => { console.error(error); process.exit(1); });
    `;
    const child = spawnSync(process.execPath, ["-e", code], { cwd: path.join(__dirname, ".."), timeout: 5000, encoding: "utf8" });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
  });
  }
}

test("electron-builder keeps the configured file inclusion/exclusion behavior", () => {
  const { FileMatcher } = require("app-builder-lib/out/fileMatcher");
  const root = path.resolve(__dirname, "..");
  const matcher = new FileMatcher(root, "unused-output", value => value,
    ["desktop/**/*.cjs", "!desktop/**/*.test.cjs"]);
  const filter = matcher.createFilter();
  assert.equal(filter(path.join(root, "desktop/main.cjs"), fs.statSync(path.join(root, "desktop/main.cjs"))), true);
  assert.equal(filter(path.join(root, "desktop/backend.test.cjs"), fs.statSync(path.join(root, "desktop/backend.test.cjs"))), false);
  assert.equal(filter(path.join(root, "package.json"), fs.statSync(path.join(root, "package.json"))), false);
});

test("legacy callable minimatch consumers still create a usable ASAR archive", async () => {
  const asar = require("@electron/asar");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nightbrew-asar-safety-"));
  try {
    const source = path.join(temporary, "source");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "main.js"), "module.exports = 1;\n");
    fs.writeFileSync(path.join(source, "notice.txt"), "license fixture\n");
    const archive = path.join(temporary, "app.asar");
    await asar.createPackageWithOptions(source, archive, { unpack: "*.txt" });
    assert.equal(asar.extractFile(archive, "main.js").toString(), "module.exports = 1;\n");
    assert.equal(fs.readFileSync(path.join(archive + ".unpacked", "notice.txt"), "utf8"), "license fixture\n");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
