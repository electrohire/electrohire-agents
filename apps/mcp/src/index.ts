import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

/**
 * ElectroHire remote MCP server — SCAFFOLD.
 *
 * Exposes exactly one read-only example tool whose result is a clearly marked
 * placeholder. It proves the wiring (official MCP SDK, streamable HTTP
 * transport, stateless per-request servers on Workers) for the real tool set
 * described in docs/architecture.md. Nothing here returns real ElectroHire
 * data yet.
 *
 * Keep MCP_SERVER_VERSION in sync with this package's package.json version.
 */
export const MCP_SERVER_VERSION = "0.1.0";

function createServer(): McpServer {
  const server = new McpServer({
    name: "electrohire",
    version: MCP_SERVER_VERSION,
  });

  server.registerTool(
    "electrohire_site_search",
    {
      title: "Search ElectroHire (placeholder)",
      description:
        "SCAFFOLD PLACEHOLDER. Intended to search public ElectroHire site content. " +
        "Currently returns an empty, clearly marked placeholder result — real " +
        "search is not implemented yet.",
      inputSchema: {
        query: z.string().min(1).describe("What to search ElectroHire for."),
      },
    },
    async ({ query }) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            scaffold: true,
            note: "Placeholder result: ElectroHire site search is not implemented yet. Do not present these as real search results.",
            query,
            results: [],
          }),
        },
      ],
    }),
  );

  return server;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", version: MCP_SERVER_VERSION });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    // Stateless mode: a fresh server + transport per request, which is the
    // pattern that fits Workers' request lifecycle.
    const server = createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
