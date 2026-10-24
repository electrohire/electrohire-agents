// FROZEN C1 API battery (LOCAL ONLY). Written before the C1 build.
// Run against locally served Workers (wrangler dev / miniflare):
//   API_URL=http://127.0.0.1:8787 node --test tests/frozen/c1-api.test.mjs
// Assertions are frozen: never weaken one to pass — log a draft defect instead.
import { test } from "node:test";
import assert from "node:assert/strict";

const API = process.env.API_URL || "http://127.0.0.1:8787";
const j = async (path, init) => {
  const r = await fetch(API + path, init);
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};
const post = (path, data) => j(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });

test("C-02 health still serves", async () => {
  const { status, body } = await j("/v1/health");
  assert.equal(status, 200); assert.equal(body.status, "ok");
});

test("C-01/C-02 site content: fees + entity facts equal the website source", async () => {
  const { status, body } = await j("/v1/content");
  assert.equal(status, 200);
  assert.equal(body.fees.clientFeePct, 10);
  assert.equal(body.fees.freelancerFeePct, 5);
  assert.equal(body.fees.sparksPerBid, 5);
  assert.equal(body.fees.example.clientPays, 1100);
  assert.equal(body.fees.example.engineerReceives, 950);
  const names = body.entities.map((e) => e.name).sort();
  assert.deepEqual(names, ["ElectroHire Inc", "ElectroHire Ltd"]);
  const inc = body.entities.find((e) => e.name === "ElectroHire Inc");
  assert.equal(inc.address.addressCountry, "US"); assert.equal(inc.foundingDate, "2025");
  const ltd = body.entities.find((e) => e.name === "ElectroHire Ltd");
  assert.equal(ltd.address.addressCountry, "GB"); assert.equal(ltd.foundingDate, "2023");
  assert.equal(body.contentVersion, 1);
  assert.ok(body.source, "response names its content source");
});

test("C-01 pod presentation carries NO pricing (deliberate absence mirrored)", async () => {
  const { status, body } = await j("/v1/pricing");
  assert.equal(status, 200);
  assert.equal(body.fees.clientFeePct, 10);
  assert.ok(body.pods, "pod presentation present");
  assert.ok(Array.isArray(body.pods.audience) && body.pods.audience.length === 3);
  assert.ok(Array.isArray(body.pods.included) && body.pods.included.length >= 5);
  const podJson = JSON.stringify(body.pods);
  assert.ok(!/"price"|"amount"|£|\$\s?\d/.test(podJson), `pod presentation must contain no price, got: ${podJson}`);
  assert.ok(body.ukHub && body.ukHub.tiers.length >= 3, "UK Hub tiers present");
  const flat = JSON.stringify(body.ukHub);
  assert.ok(flat.includes("Startup Pro") && flat.includes("49"), "UK Hub £49 Startup Pro tier present");
  assert.ok(flat.includes("Day Pass") && flat.includes("9"), "UK Hub £9 Day Pass present");
});

test("C-02 FAQ endpoint: all pages, filterable", async () => {
  const all = await j("/v1/faq");
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 29, `expected >=29 FAQs, got ${all.body.total}`);
  const pods = await j("/v1/faq?page=pods");
  assert.equal(pods.body.total, 5);
  assert.ok(pods.body.faqs.every((f) => f.q && f.a));
});

test("C-02 service pages endpoint lists the six categories", async () => {
  const { status, body } = await j("/v1/content/services");
  assert.equal(status, 200);
  assert.equal(body.categories.length, 6);
  assert.ok(body.categories.some((c) => c.name === "PCB design"));
  assert.ok(Array.isArray(body.pages) && body.pages.length >= 7);
});

test("C-02 blog endpoint is ABSENT (not a fake empty one) until Phase B", async () => {
  const { status } = await j("/v1/blog");
  assert.equal(status, 404);
  const spec = await j("/openapi.json");
  assert.ok(!Object.keys(spec.body.paths).some((p) => p.includes("blog")), "OpenAPI must not advertise a blog path");
});

test("C-02 OpenAPI 3.1 at stable path lists read + tool endpoints", async () => {
  const { status, body } = await j("/openapi.json");
  assert.equal(status, 200);
  assert.ok(body.openapi.startsWith("3.1"));
  for (const p of ["/v1/content", "/v1/content/services", "/v1/faq", "/v1/pricing",
    "/v1/tools/cost-estimator", "/v1/tools/scoping-checklist", "/v1/tools/timeline-calculator"])
    assert.ok(body.paths[p], `OpenAPI missing ${p}`);
  const est = JSON.stringify(body.components.schemas.EstimateResponse || {});
  assert.ok(est.includes('"range"') && est.includes('"assumptions"'), "EstimateResponse schema must require range + assumptions");
});

test("C-02 cost estimator returns range + assumptions matching the website model", async () => {
  const { status, body } = await post("/v1/tools/cost-estimator", { needs: ["pcb", "firmware"], productType: "sensor", stage: "sketch", units: "proto" });
  assert.equal(status, 200);
  assert.equal(body.range.low, 10000); assert.equal(body.range.high, 30000);
  assert.equal(body.range.currency, "USD");
  assert.ok(Array.isArray(body.assumptions) && body.assumptions.length >= 2);
  assert.ok(Array.isArray(body.drivers) && body.drivers.length >= 1);
  assert.ok(body.timelineWeeks && body.timelineWeeks.low >= 1 && body.timelineWeeks.high > body.timelineWeeks.low);
  assert.ok(!/confidence/i.test(JSON.stringify(body)), "SG-3: no confidence figure");
});

test("C-02 estimator rejects an empty need list (no bare number, no fake estimate)", async () => {
  const { status } = await post("/v1/tools/cost-estimator", { needs: [], productType: "sensor", stage: "sketch", units: "proto" });
  assert.ok(status === 400 || status === 422, `expected 4xx, got ${status}`);
});

test("C-02 scoping checklist returns grouped items + assumptions", async () => {
  const { status, body } = await post("/v1/tools/scoping-checklist", { productType: "sensor", needs: ["pcb", "wireless"] });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.groups) && body.groups.length >= 2);
  const items = body.groups.flatMap((g) => g.items);
  assert.ok(items.length >= 5 && items.every((i) => i.title && i.why));
  assert.ok(Array.isArray(body.assumptions) && body.assumptions.length >= 1);
});

test("C-02 timeline calculator returns stage ranges + total range + assumptions", async () => {
  const { status, body } = await post("/v1/tools/timeline-calculator", { needs: ["pcb", "firmware", "compliance"], stage: "idea" });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.stages) && body.stages.length >= 3);
  assert.ok(body.totalWeeks.low >= 1 && body.totalWeeks.high > body.totalWeeks.low);
  assert.ok(body.stages.every((s) => s.weeks && s.weeks.high >= s.weeks.low));
  assert.ok(Array.isArray(body.assumptions) && body.assumptions.length >= 1);
});

test("C-05 metadata headers: responses carry no payload echo of secrets; unknown route 404", async () => {
  const { status } = await j("/v1/does-not-exist");
  assert.equal(status, 404);
});
