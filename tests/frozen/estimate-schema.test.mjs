// FROZEN C-02 schema proof (LOCAL ONLY): a bare-number estimate MUST fail
// validation against the estimate schema the API publishes.
// Imports the same Zod schema module the API uses (Node type-stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EstimateResponse } from "../../packages/platform/src/tools.ts";

test("bare number estimate fails schema validation", () => {
  assert.equal(EstimateResponse.safeParse(12000).success, false);
  assert.equal(EstimateResponse.safeParse({ estimate: 12000 }).success, false);
  assert.equal(EstimateResponse.safeParse({ range: { low: 1, high: 2, currency: "USD" } }).success, false, "range without assumptions must fail");
  assert.equal(EstimateResponse.safeParse({ assumptions: ["x"] }).success, false, "assumptions without range must fail");
});

test("range + assumptions passes", () => {
  const ok = EstimateResponse.safeParse({
    range: { low: 10000, high: 30000, currency: "USD" },
    assumptions: ["Typical complexity for the product type picked."],
    drivers: [{ label: "Firmware", upTo: 18000 }],
    timelineWeeks: { low: 7, high: 14 },
  });
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues ?? ""));
});
