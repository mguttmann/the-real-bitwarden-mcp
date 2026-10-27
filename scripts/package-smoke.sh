#!/usr/bin/env bash
# Package smoke test: installs the packed tarball the way the production
# gateway does and starts it from node_modules.
#
# 1. npm pack of the built tree (run `npm ci && npm run build` first).
# 2. A scratch project depending on the tarball: `npm install` writes the
#    lockfile, then `npm ci --omit=dev --ignore-scripts` installs from it.
# 3. scripts/stdio-probe.mjs starts
#    `node --env-file=<env> node_modules/the-real-bitwarden-mcp/dist/index.js`
#    with fake credentials (.invalid hosts, a format-valid fake
#    BWS_ACCESS_TOKEN; no tool is called, nothing is contacted).
# 4. Fails if tools/list differs from tests/fixtures/tool-contract.json
#    (selfhostCloudBws) or, unless REQUIRE_SDK=0, if the server logs that the
#    Secrets Manager SDK could not be loaded.
#
# Environment (all optional):
#   SMOKE_WORKDIR  scratch dir (default: a new mktemp -d dir)
#   REQUIRE_SDK    1 (default) fails when the SDK native binary does not
#                  load; 0 for platforms without a binary (linux/arm64)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${SMOKE_WORKDIR:-$(mktemp -d)}"
REQUIRE_SDK="${REQUIRE_SDK:-1}"
# 2026-07-28 is left out: stdio-probe.mjs probes that revision with the SDK
# client (@modelcontextprotocol/client), a dev dependency that the
# production install does not have. The tool list does not depend on the
# protocol version; tests/protocol-versions.test.ts covers 2026-07-28.
VERSIONS=(2025-06-18 2025-11-25)

if [[ -z "$WORK" || "$WORK" == "/" ]]; then
  echo "SMOKE_WORKDIR must not be empty or /" >&2
  exit 1
fi
mkdir -p "$WORK/app"
echo "== node $(node --version), npm $(npm --version), $(uname -sm)"

echo "== npm pack"
tarball="$(cd "$REPO" && npm pack --silent --pack-destination "$WORK" | tail -n 1)"
echo "$tarball"

echo "== gateway-style install in $WORK/app"
cat >"$WORK/app/package.json" <<EOF
{
  "name": "package-smoke",
  "private": true,
  "dependencies": { "the-real-bitwarden-mcp": "file:../$tarball" }
}
EOF
(cd "$WORK/app" && npm install --ignore-scripts --no-audit --no-fund &&
  rm -rf node_modules && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

# Fake credentials only; the .invalid hosts never resolve.
cat >"$WORK/app/server.env" <<'EOF'
BITWARDEN_SELFHOST_API_BASE=https://vault.example.invalid/api
BITWARDEN_SELFHOST_IDENTITY_URL=https://vault.example.invalid/identity
BITWARDEN_SELFHOST_CLIENT_ID=organization.FAKE-CLIENT-ID
BITWARDEN_SELFHOST_CLIENT_SECRET=FAKE-SECRET-1
BITWARDEN_CLOUD_API_BASE=https://api.example.invalid
BITWARDEN_CLOUD_IDENTITY_URL=https://identity.example.invalid
BITWARDEN_CLOUD_CLIENT_ID=organization.FAKE-CLIENT-ID
BITWARDEN_CLOUD_CLIENT_SECRET=FAKE-SECRET-2
BWS_ACCESS_TOKEN=0.FAKE-UUID-1.FAKE-SECRET-3:FAKE-KEY-1
LOG_LEVEL=warn
EOF

pkgdir="$WORK/app/node_modules/the-real-bitwarden-mcp"
for v in "${VERSIONS[@]}"; do
  node "$REPO/scripts/stdio-probe.mjs" "$pkgdir" "$v" "$WORK/app/server.env" >"$WORK/probe-$v.json"
done

echo "== results"
# shellcheck disable=SC2016 # JavaScript template literals, not shell
node --input-type=module -e '
import { readFileSync } from "node:fs";
const [repo, work, requireSdk, ...versions] = process.argv.slice(1);
const contract = JSON.parse(readFileSync(`${repo}/tests/fixtures/tool-contract.json`, "utf8"));
const expected = JSON.stringify(contract.selfhostCloudBws);
let ok = true;
for (const v of versions) {
  const p = JSON.parse(readFileSync(`${work}/probe-${v}.json`, "utf8"));
  const actual = JSON.stringify(
    p.tools
      .map((t) => ({ name: t.name, required: t.required, properties: t.props }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  );
  const match = actual === expected && p.count === contract.selfhostCloudBws.length;
  const sdkFailed = /sm-sdk: failed to load|module_not_found|binary_not_available/.test(p.stderrTail);
  ok &&= match && !(sdkFailed && requireSdk !== "0");
  console.log(
    `requested=${v} negotiated=${p.protocolVersion} server=${p.serverInfo?.name}@${p.serverInfo?.version} ` +
      `tools=${p.count}/${contract.selfhostCloudBws.length} contract=${match ? "ok" : "MISMATCH"} ` +
      `sdk=${sdkFailed ? "NOT LOADED" : "loaded"}`,
  );
  if (sdkFailed) console.log(p.stderrTail);
}
process.exit(ok ? 0 : 1);
' "$REPO" "$WORK" "$REQUIRE_SDK" "${VERSIONS[@]}"
