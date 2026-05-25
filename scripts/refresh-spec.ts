import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import "dotenv/config";

const CANDIDATES = ["/swagger/v1/swagger.json", "/public/swagger/v1/swagger.json", "/swagger.json"];

async function fetchSpec(apiBase: string): Promise<{ url: string; spec: any }> {
  const errors: string[] = [];
  for (const path of CANDIDATES) {
    const url = apiBase.replace(/\/+$/, "") + path;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        errors.push(`${url} → ${res.status}`);
        continue;
      }
      const spec = await res.json();
      if (spec && typeof spec === "object" && "paths" in spec) return { url, spec };
      errors.push(`${url} → not a Swagger document`);
    } catch (e) {
      errors.push(`${url} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error("Could not locate a Swagger document. Tried:\n  " + errors.join("\n  "));
}

function filterToPublic(spec: any): any {
  const out = { ...spec, paths: {} as Record<string, unknown> };
  for (const [p, ops] of Object.entries(spec.paths ?? {})) {
    if (p.startsWith("/public/") || p === "/public" || p.startsWith("/public?")) {
      out.paths[p] = ops;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const apiBase = process.env.BITWARDEN_SELFHOST_API_BASE;
  if (!apiBase) {
    throw new Error("BITWARDEN_SELFHOST_API_BASE must be set to fetch the spec.");
  }
  const { url, spec } = await fetchSpec(apiBase);
  const filtered = filterToPublic(spec);
  const out = resolve(process.cwd(), "specs/public-api.spec.json");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(filtered, null, 2), "utf8");
  const pathCount = Object.keys(filtered.paths).length;
  process.stderr.write(`Pulled spec from ${url}\nWrote ${out} (${pathCount} /public paths)\n`);
}

main().catch((err) => {
  process.stderr.write(`refresh-spec failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
