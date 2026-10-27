#!/usr/bin/env bash
# Build the release assets of the current checkout into <outDir>
# (default: <repo>/release, git-ignored):
#
#   the-real-bitwarden-mcp-<version>.tgz           npm pack of a clean build
#   the-real-bitwarden-mcp-<version>.tgz.cdx.json  CycloneDX SBOM (npm sbom)
#                                                  of the runtime dependency
#                                                  tree installed from the
#                                                  lockfile
#   SHA256SUMS                                     over both files
#
# Expects `npm ci` to have run. Used by .github/workflows/release.yml; runs
# the same way locally on Linux (needs sha256sum), for example in
# node:24.22.1-bookworm-slim.
#
# The SBOM lists what `npm ci --omit=dev --ignore-scripts` installs on the
# build platform, so of the optional @bitwarden/sdk-napi-* binaries it
# contains only the one for that platform. Its timestamp is
# SOURCE_DATE_EPOCH when set, otherwise the commit time of HEAD.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO/release}"
cd "$REPO"

if [[ -e "$OUT" && -n "$(ls -A "$OUT")" ]]; then
  echo "error: $OUT is not empty" >&2
  exit 1
fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

# 1. Clean build, so no stale file from an earlier build is packed.
rm -rf -- "$REPO/dist"
npm run build

# 2. npm tarball. --ignore-scripts: the build above is the one that ships.
tarball="$(npm pack --ignore-scripts --pack-destination "$OUT" --json | node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  console.log(JSON.parse(s)[0].filename);
});')"

# 3. SBOM of the runtime tree, installed from the lockfile in a scratch dir.
STAGE="$(mktemp -d)"
trap 'rm -rf -- "$STAGE"' EXIT
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
delete pkg.scripts;
fs.writeFileSync(process.argv[1], JSON.stringify(pkg, null, 2) + "\n");
' "$STAGE/package.json"
cp package-lock.json "$STAGE/package-lock.json"
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
# npm sbom fails on the dev packages that were not installed.
node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
delete pkg.devDependencies;
fs.writeFileSync(process.argv[1], JSON.stringify(pkg, null, 2) + "\n");
' "$STAGE/package.json"
epoch="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}"
(cd "$STAGE" && npm sbom --sbom-format cyclonedx --sbom-type library) |
  node -e '
let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const sbom = JSON.parse(s);
  if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components)) {
    throw new Error("npm sbom did not return a CycloneDX document");
  }
  // npm names the root component after the scratch dir.
  sbom.metadata.component.name = process.argv[1];
  sbom.metadata.timestamp = new Date(Number(process.argv[2]) * 1000).toISOString();
  process.stdout.write(JSON.stringify(sbom, null, 2) + "\n");
});' "$(node -p 'require("./package.json").name')" "$epoch" >"$OUT/$tarball.cdx.json"

# 4. Checksums.
(cd "$OUT" && sha256sum -- "$tarball" "$tarball.cdx.json" >SHA256SUMS && cat SHA256SUMS)
