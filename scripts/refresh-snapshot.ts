import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function main(): Promise<void> {
  // Import the compiled or source module via tsx so we get the actual exported array.
  const opsModulePath = resolve(process.cwd(), "src/tools/generated/operations.ts");
  const mod = await import(pathToFileURL(opsModulePath).href);
  const ops = mod.OPERATIONS as Array<{ toolName: string }>;
  const names = ops.map((o) => o.toolName).sort();
  const out = resolve(process.cwd(), "src/tools/generated/snapshot.json");
  await writeFile(out, JSON.stringify({ toolNames: names }, null, 2) + "\n", "utf8");
  process.stderr.write(`Wrote ${out} with ${names.length} tool names.\n`);
}

main().catch((err) => {
  process.stderr.write(`refresh-snapshot failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
