// C-03 harness 2 of 2 (LOCAL ONLY): the OFFICIAL MCP SDK client
// (@modelcontextprotocol/sdk) over Streamable HTTP — an independent client
// implementation from the raw JSON-RPC harness in tests/frozen/c1-mcp.test.mjs.
//   MCP_URL=http://127.0.0.1:8788 node tests/mcp-sdk-harness.mjs
import { Client } from "../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StreamableHTTPClientTransport } from "../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js";

const base = process.env.MCP_URL || "http://127.0.0.1:8788";
const client = new Client({ name: "c1-sdk-harness", version: "1.0.0" }, { capabilities: {} });
await client.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp")));
console.log("connected; server:", JSON.stringify(client.getServerVersion()));

const tools = await client.listTools();
const names = tools.tools.map((t) => t.name);
console.log("tools/list:", names.join(", "));
for (const n of ["electrohire_get_site_content", "electrohire_get_faq", "electrohire_get_pricing", "electrohire_estimate_cost", "electrohire_scoping_checklist", "electrohire_timeline_calculator", "electrohire_site_search"])
  if (!names.includes(n)) throw new Error(`missing tool ${n}`);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name} errored: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};
const pricing = await call("electrohire_get_pricing");
console.log("pricing.fees.clientFeePct:", pricing.fees.clientFeePct);
if (pricing.fees.clientFeePct !== 10) throw new Error("fees mismatch");
const est = await call("electrohire_estimate_cost", { needs: ["pcb", "firmware"], productType: "sensor", stage: "sketch", units: "proto" });
console.log("estimate range:", JSON.stringify(est.range), "assumptions:", est.assumptions.length);
if (est.range.low !== 10000 || est.range.high !== 30000) throw new Error("estimate mismatch");
await client.close();
console.log("SDK HARNESS PASS");
