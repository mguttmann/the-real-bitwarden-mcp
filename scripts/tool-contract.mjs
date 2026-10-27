// Tool contract rule, shared by the tests and the smoke scripts.
//
// tests/fixtures/tool-contract.json is the frozen v0.1.1 production
// baseline. tests/fixtures/tool-contract-added.json records every optional
// parameter added since then, per config and tool (a placeholder tool in
// one config has no properties, so the configs are listed separately).
// The rule, per config:
//   - tool names identical to the baseline (none added, removed or renamed),
//   - required lists identical to the baseline,
//   - property names a superset of the baseline: every baseline property is
//     still there, and every extra property is recorded in the added list.
// The expected tools/list surface is therefore baseline + added, exactly.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIGS = ["selfhostCloud", "selfhostCloudBws"];

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Reads the baseline and the added list from <repoDir>/tests/fixtures. */
export function loadContractFixtures(repoDir) {
  const read = (file) => JSON.parse(readFileSync(join(repoDir, "tests", "fixtures", file), "utf8"));
  return {
    baseline: read("tool-contract.json"),
    added: read("tool-contract-added.json").added,
  };
}

/** Baseline entries with the recorded additions merged in (sorted). */
export function expectedContract(baselineEntries, added) {
  return baselineEntries.map((t) => ({
    name: t.name,
    required: t.required,
    properties: [...new Set([...t.properties, ...(added[t.name] ?? [])])].sort(),
  }));
}

/**
 * Violations of the contract rule for one config. Empty when `actual`
 * (name, required, properties per tool) satisfies the rule.
 */
export function contractViolations(actual, baselineEntries, added) {
  const out = [];
  const actualByName = new Map(actual.map((t) => [t.name, t]));
  const baseByName = new Map(baselineEntries.map((t) => [t.name, t]));
  for (const name of Object.keys(added)) {
    if (!baseByName.has(name)) out.push(`added list names a tool not in the baseline: ${name}`);
  }
  for (const t of actual) {
    if (!baseByName.has(t.name)) out.push(`tool not in the baseline: ${t.name}`);
  }
  for (const base of baselineEntries) {
    const t = actualByName.get(base.name);
    if (!t) {
      out.push(`tool missing: ${base.name}`);
      continue;
    }
    const req = [...t.required].sort();
    if (JSON.stringify(req) !== JSON.stringify([...base.required].sort())) {
      out.push(`${base.name}: required changed from [${base.required}] to [${t.required}]`);
    }
    const props = new Set(t.properties);
    for (const p of base.properties) {
      if (!props.has(p)) out.push(`${base.name}: baseline property removed: ${p}`);
    }
    const recorded = new Set(added[base.name] ?? []);
    for (const p of recorded) {
      if (base.properties.includes(p))
        out.push(`${base.name}: added property already in baseline: ${p}`);
      else if (!props.has(p)) out.push(`${base.name}: recorded added property missing: ${p}`);
    }
    for (const p of t.properties) {
      if (!base.properties.includes(p) && !recorded.has(p)) {
        out.push(`${base.name}: property not recorded in tool-contract-added.json: ${p}`);
      }
    }
  }
  return out;
}

/** Sorted contract view of a stdio-probe.mjs summary. */
export function probeAsContract(probe) {
  return probe.tools
    .map((t) => ({ name: t.name, required: t.required, properties: t.props }))
    .sort(byName);
}
