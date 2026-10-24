// FROZEN C-03 battery (LOCAL ONLY): MCP over Streamable HTTP, raw JSON-RPC
// harness (harness 1 of 2; harness 2 is the official SDK client in
// tests/mcp-sdk-harness.mjs). Written before the build.
import { test } from "node:test";
import assert from "node:assert/strict";

const MCP = process.env.MCP_URL || "http://127.0.0.1:8788";
let id = 0;
async function rpc(method, params = {}) {
  const r = await fetch(MCP + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const text = await r.text();
  const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
  return { status: r.status, msg: JSON.parse(dataLine ? dataLine.slice(5) : text) };
}
async function callTool(name, args = {}) {
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "frozen-raw-harness", version: "1" } });
  const { msg } = await rpc("tools/call", { name, arguments: args });
  assert.ok(!msg.error, `tool ${name} errored: ${JSON.stringify(msg.error)}`);
  return JSON.parse(msg.result.content[0].text);
}

test("C-03 initialize + tools/list discovery works unconfigured", async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "frozen-raw-harness", version: "1" } });
  assert.equal(init.status, 200);
  assert.ok(init.msg.result.serverInfo.name.includes("electrohire"));
  const { msg } = await rpc("tools/list");
  const names = msg.result.tools.map((t) => t.name);
  for (const n of ["electrohire_get_site_content", "electrohire_get_faq", "electrohire_get_pricing",
    "electrohire_estimate_cost", "electrohire_scoping_checklist", "electrohire_timeline_calculator", "electrohire_site_search"])
    assert.ok(names.includes(n), `missing tool ${n}; have ${names}`);
});

test("C-03 content tools mirror C-02 (same fees, same no-pod-pricing)", async () => {
  const pricing = await callTool("electrohire_get_pricing");
  assert.equal(pricing.fees.clientFeePct, 10);
  assert.ok(!/"price"|£/.test(JSON.stringify(pricing.pods)), "MCP pod presentation must also carry no pricing");
  const faq = await callTool("electrohire_get_faq", { page: "pods" });
  assert.equal(faq.total, 5);
});

test("C-03 estimator tool returns range + assumptions, no confidence figure", async () => {
  const est = await callTool("electrohire_estimate_cost", { needs: ["pcb", "firmware"], productType: "sensor", stage: "sketch", units: "proto" });
  assert.equal(est.range.low, 10000); assert.equal(est.range.high, 30000);
  assert.ok(est.assumptions.length >= 2);
  assert.ok(!/confidence/i.test(JSON.stringify(est)));
});

test("C-03 site search returns real content (placeholder is gone)", async () => {
  const res = await callTool("electrohire_site_search", { query: "pod" });
  assert.ok(!res.scaffold, "search must not return the scaffold placeholder");
  assert.ok(res.results.length >= 1);
});
