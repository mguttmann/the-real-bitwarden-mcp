export type JSONSchema = Record<string, unknown>;

export type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: true;
};

type ToolContent =
  { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
};

type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

/** The upstream write a tool would send for a given input (shown in the confirm preview). */
export type PlannedRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** Human-readable remarks, e.g. which fields are left out so the API keeps them. */
  notes?: string[];
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  annotations: ToolAnnotations;
  handler: ToolHandler;
  /**
   * Optional: compute the effective write for an input without sending it.
   * May issue read-only requests. Throws when the input cannot be applied.
   */
  plan?: (input: Record<string, unknown>) => Promise<PlannedRequest>;
};

export type Instance = "selfhost" | "cloud" | "sm";

export type ParameterDef = {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  schema: JSONSchema;
  description?: string;
};

export type OperationDef = {
  operationId: string;
  toolName: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  summary: string;
  description: string;
  tags: string[];
  parameters: ParameterDef[];
  requestBodySchema?: JSONSchema;
  requestBodyRequired?: boolean;
  responseSchema?: JSONSchema;
  isDestructive: boolean;
};
