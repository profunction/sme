const fs = require("node:fs");
const base = require("../package.json").build;
const development = process.argv.includes("--development");
const localPreview = process.argv.includes("--local-preview");
if (localPreview && !development)
  throw Error(
    "Local preview is only available in an explicitly unsigned development build",
  );
if (process.argv.includes("--mac") && !development)
  throw Error(
    "macOS production distribution requires a separate signing and notarization workflow",
  );
const policy = {
  license_public_key: process.env.NIGHTBREW_RELEASE_PUBLIC_KEY || "",
  license_url: process.env.NIGHTBREW_RELEASE_LICENSE_URL || "",
  publisher_name: process.env.NIGHTBREW_SIGNING_PUBLISHER || "",
  update_url: process.env.NIGHTBREW_RELEASE_UPDATE_URL || "",
  development_unsigned: development,
  local_preview: localPreview,
};
function https(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}
if (
  !development &&
  (!https(policy.license_url) ||
    !https(policy.update_url) ||
    !policy.publisher_name ||
    Buffer.from(policy.license_public_key, "base64url").length !== 32)
)
  throw Error(
    "Production release requires a trusted public key, HTTPS license/update URLs and exact signing publisher",
  );
if (!development && (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD))
  throw Error(
    "Production release requires a code signing certificate and password through secure CI bindings",
  );
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync("build/release-policy.json", JSON.stringify(policy, null, 2));
const config = {
  ...base,
  forceCodeSigning: !development,
  mac: { ...base.mac, identity: null },
  win: {
    ...base.win,
    target: "nsis",
    verifyUpdateCodeSignature: true,
    ...(development ? {} : { publisherName: [policy.publisher_name] }),
  },
  artifactName: localPreview
    ? "NightBrew-LOCAL-PREVIEW-${version}-${arch}.${ext}"
    : development
      ? "NightBrew-DEV-UNSIGNED-${version}-${arch}.${ext}"
      : "NightBrew-${version}-${arch}.${ext}",
  publish: development
    ? null
    : [{ provider: "generic", url: policy.update_url }],
};
fs.writeFileSync(
  "build/electron-release.json",
  JSON.stringify(config, null, 2),
);
