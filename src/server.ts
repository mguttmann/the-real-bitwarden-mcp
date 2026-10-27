import { Server, type Tool } from "@modelcontextprotocol/server";
import type { Logger } from "pino";
import type { ToolRegistry } from "./tools/registry.js";
import { SERVER_VERSION } from "./version.js";
import { scrubClientText } from "./redact.js";

export function createMcpServer(registry: ToolRegistry, logger: Logger): Server {
  const server = new Server(
    { name: "the-real-bitwarden-mcp", version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler("tools/list", async () => ({
    tools: registry.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      // Hand-written JSON Schemas are passed through verbatim (no zod conversion).
      inputSchema: t.inputSchema as Tool["inputSchema"],
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler("tools/call", async (req) => {
    const tool = registry.getByName(req.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${req.params.name}`);
    }
    logger.debug({ tool: tool.name }, "tools/call");
    try {
      return await tool.handler(req.params.arguments ?? {});
    } catch (err) {
      logger.warn({ tool: tool.name, err }, "tool handler failed");
      return {
        content: [
          {
            type: "text",
            text: scrubClientText(err instanceof Error ? err.message : String(err)),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
