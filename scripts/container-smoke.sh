#!/usr/bin/env bash
# Container smoke test of the production start path.
#
# 1. Copies the working tree (tracked and untracked, not ignored files) to a
#    scratch dir and builds it in the gateway image with the gateway commands:
#    npm ci --no-audit --no-fund && npm run build
# 2. Starts `node --env-file=<env> dist/index.js` with --network none and
#    fake credentials, for protocol revisions 2025-06-18, 2025-11-25 and
#    2026-07-28, in two configs: selfhost+cloud and selfhost+cloud+BWS.
# 3. Prints tool count and negotiated revision per run and fails if
#    tools/list breaks the tool contract (scripts/tool-contract.mjs: the
#    baseline in tests/fixtures/tool-contract.json plus the recorded
#    additions in tests/fixtures/tool-contract-added.json).
#
# Environment (all optional):
#   DOCKER           docker CLI to use (default: docker). DOCKER_HOST and
#                    DOCKER_CONFIG are honoured by the CLI as usual, e.g.
#                    DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
#   DOCKER_RUN_ARGS  extra arguments for every `docker run` (e.g. --platform)
#   NODE_IMAGE       image (default: node:24.22.1-bookworm-slim)
#   SMOKE_WORKDIR    scratch dir, must be mountable by the docker daemon
#                    (default: <repo>/tmp/container-smoke, git-ignored)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER="${DOCKER:-docker}"
NODE_IMAGE="${NODE_IMAGE:-node:24.22.1-bookworm-slim}"
WORK="${SMOKE_WORKDIR:-$REPO/tmp/container-smoke}"
VERSIONS=(2025-06-18 2025-11-25 2026-07-28)
# shellcheck disable=SC2206 # word splitting of extra args is intended
EXTRA=(${DOCKER_RUN_ARGS:-})

if [[ -z "$WORK" || "$WORK" == "/" ]]; then
  echo "SMOKE_WORKDIR must not be empty or /" >&2
  exit 1
fi
APP="$WORK/app"
rm -rf -- "$APP"
mkdir -p "$APP"

echo "== copying working tree to $APP"
(cd "$REPO" && git ls-files -z --cached --others --exclude-standard | xargs -0 tar -cf - --) |
  tar -xf - -C "$APP"

# Fake credentials only. Hosts use the reserved .invalid TLD and the
# container has no network, so nothing can be reached.
cat >"$APP/.env" <<'EOF'
BITWARDEN_SELFHOST_API_BASE=https://vault.example.invalid/api
BITWARDEN_SELFHOST_IDENTITY_URL=https://vault.example.invalid/identity
BITWARDEN_SELFHOST_CLIENT_ID=organization.FAKE-CLIENT-ID
BITWARDEN_SELFHOST_CLIENT_SECRET=FAKE-SECRET-1
BITWARDEN_CLOUD_API_BASE=https://api.example.invalid
BITWARDEN_CLOUD_IDENTITY_URL=https://identity.example.invalid
BITWARDEN_CLOUD_CLIENT_ID=organization.FAKE-CLIENT-ID
BITWARDEN_CLOUD_CLIENT_SECRET=FAKE-SECRET-2
BITWARDEN_CONFIRM_WRITES=true
LOG_LEVEL=warn
EOF
cp "$APP/.env" "$APP/.env.bws"
echo "BWS_ACCESS_TOKEN=0.FAKE-UUID-1.FAKE-SECRET-3:FAKE-KEY-1" >>"$APP/.env.bws"

run() {
  "$DOCKER" run --rm ${EXTRA[@]+"${EXTRA[@]}"} -v "$APP:/app" -w /app "$@"
}

echo "== build in $NODE_IMAGE (gateway commands)"
run "$NODE_IMAGE" sh -c 'node --version && npm --version && npm ci --no-audit --no-fund && npm run build'

mkdir -p "$APP/.smoke-out"
for cfg in selfhostCloud selfhostCloudBws; do
  envfile=/app/.env
  [[ "$cfg" == selfhostCloudBws ]] && envfile=/app/.env.bws
  for v in "${VERSIONS[@]}"; do
    out="$APP/.smoke-out/$cfg-$v.json"
    if ! run --network none "$NODE_IMAGE" node scripts/stdio-probe.mjs /app "$v" "$envfile" >"$out"; then
      echo "FAIL: probe $cfg $v" >&2
      exit 1
    fi
  done
done

echo "== results"
run --network none "$NODE_IMAGE" node --input-type=module -e '
import { readFileSync } from "node:fs";
import { loadContractFixtures, contractViolations, probeAsContract } from "/app/scripts/tool-contract.mjs";
const { baseline, added } = loadContractFixtures("/app");
let ok = true;
for (const cfg of ["selfhostCloud", "selfhostCloudBws"]) {
  for (const v of process.argv.slice(1)) {
    const p = JSON.parse(readFileSync(`.smoke-out/${cfg}-${v}.json`, "utf8"));
    const violations = contractViolations(probeAsContract(p), baseline[cfg], added[cfg]);
    const match = violations.length === 0;
    ok &&= match;
    console.log(
      `${cfg.padEnd(16)} requested=${v} negotiated=${p.protocolVersion} ` +
        `server=${p.serverInfo?.name}@${p.serverInfo?.version} tools=${p.count} ` +
        `contract=${match ? "ok" : "MISMATCH"}`,
    );
    for (const line of violations) console.log(`  ${line}`);
  }
}
process.exit(ok ? 0 : 1);
' "${VERSIONS[@]}"
echo "== probe outputs: $APP/.smoke-out"
