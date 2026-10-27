export type ContractEntry = { name: string; required: string[]; properties: string[] };
export type Baseline = Record<"selfhostCloud" | "selfhostCloudBws", ContractEntry[]>;
export type Added = Record<string, string[]>;
export type AddedByConfig = Record<"selfhostCloud" | "selfhostCloudBws", Added>;
export const CONFIGS: readonly ["selfhostCloud", "selfhostCloudBws"];
export function loadContractFixtures(repoDir: string): { baseline: Baseline; added: AddedByConfig };
export function expectedContract(baselineEntries: ContractEntry[], added: Added): ContractEntry[];
export function contractViolations(
  actual: ContractEntry[],
  baselineEntries: ContractEntry[],
  added: Added,
): string[];
export function probeAsContract(probe: {
  tools: { name: string; required: string[]; props: string[] }[];
}): ContractEntry[];
