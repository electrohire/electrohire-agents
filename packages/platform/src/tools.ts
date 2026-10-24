/**
 * C-02 tool logic: cost estimator, scoping checklist, timeline calculator.
 * The estimator computes from the mirrored content document (the website's
 * own tables) — never from numbers hardcoded here. The checklist and
 * timeline tools are new in C1 and follow the same honesty standard: ranges
 * with assumptions, drivers named, no confidence figures (SG-3), and no
 * bare number anywhere — EstimateResponse REQUIRES range + assumptions,
 * and the frozen schema test proves a bare number fails validation.
 */
import { z } from "zod";
import type { ContentDoc } from "./content.ts";

export const Range = z.object({
  low: z.number(),
  high: z.number(),
  currency: z.literal("USD"),
});

export const EstimateResponse = z.object({
  range: Range,
  assumptions: z.array(z.string()).min(1),
  drivers: z.array(z.object({ label: z.string(), upTo: z.number() })),
  timelineWeeks: z.object({ low: z.number(), high: z.number() }),
});

export type Estimate = z.infer<typeof EstimateResponse>;

export const EstimatorInput = z.object({
  needs: z.array(z.string()).min(1, "Pick at least one need"),
  productType: z.string().default("other"),
  stage: z.string().default("sketch"),
  units: z.string().default("proto"),
});

const round250 = (n: number) => Math.round(n / 250) * 250;

export function estimateCost(doc: ContentDoc, rawInput: unknown): Estimate {
  const input = EstimatorInput.parse(rawInput);
  const costs = doc.estimator.costs;
  for (const need of input.needs) {
    if (!costs[need]) throw new Error(`Unknown need: ${need}`);
  }
  const typeMult = doc.estimator.typeMultipliers[input.productType] ?? 1;
  const stageMult = doc.estimator.stageMultipliers[input.stage] ?? 1;
  const mult = typeMult * stageMult;
  let low = 0, high = 0;
  const rows = input.needs.map((id) => {
    const c = costs[id];
    low += c.low * mult; high += c.high * mult;
    return { label: c.label, upTo: round250(c.high * mult) };
  });
  if (input.units === doc.estimator.largeRun.unitsValue) {
    low += doc.estimator.largeRun.low; high += doc.estimator.largeRun.high;
    rows.push({ label: doc.estimator.largeRun.label, upTo: doc.estimator.largeRun.high });
  }
  rows.sort((a, b) => b.upTo - a.upTo);
  const t = doc.estimator.timeline;
  const result: Estimate = {
    range: { low: round250(low), high: round250(high), currency: "USD" },
    assumptions: [
      ...doc.estimator.assumptions,
      `Multipliers applied from the website's estimator model: product type ×${typeMult}, stage ×${stageMult}.`,
      "A human engineer reviews any scoped quote before money moves — this is a planning estimate, not a quote.",
    ],
    drivers: rows.slice(0, 3),
    timelineWeeks: {
      low: Math.round(t.baseLow + input.needs.length * t.perNeedLow),
      high: Math.round(t.baseHigh + input.needs.length * t.perNeedHigh),
    },
  };
  // The response must validate against the honesty schema before it leaves.
  return EstimateResponse.parse(result);
}

export const ScopingInput = z.object({
  productType: z.string().default("other"),
  needs: z.array(z.string()).min(1, "Pick at least one need"),
});

const NEED_CHECKLIST: Record<string, { group: string; title: string; why: string }[]> = {
  pcb: [
    { group: "Decisions", title: "Board size, layer count, and mounting constraints", why: "These bound the layout before anyone starts drawing it." },
    { group: "Documents", title: "Schematic requirements and the parts you have already chosen", why: "Chosen parts fix footprints and availability risk early." },
  ],
  firmware: [
    { group: "Decisions", title: "Target microcontroller and how updates ship", why: "The update path (wired, OTA, none) changes the architecture, not just the code." },
    { group: "Documents", title: "Behaviour spec: what the device must do, state by state", why: "Firmware is priced on behaviour, not on feature names." },
  ],
  wireless: [
    { group: "Decisions", title: "Radio, band, and target markets", why: "Radio choice and markets decide the compliance route and antenna design." },
    { group: "Documents", title: "Range, battery-life, and environment targets", why: "These three numbers trade against each other; the checklist forces them into the open." },
  ],
  battery: [
    { group: "Decisions", title: "Cell chemistry, charge source, and runtime target", why: "Chemistry drives safety, shipping, and enclosure decisions." },
  ],
  enclosure: [
    { group: "Decisions", title: "Environment rating and how the product is held, mounted, or worn", why: "Mechanical constraints are cheapest before the board is final." },
  ],
  app: [
    { group: "Decisions", title: "Accounts, data, and which platform ships first", why: "An app scope without an account/data decision is not scoped yet." },
  ],
  compliance: [
    { group: "Compliance", title: "Target markets and the approvals they require (CE/FCC/safety)", why: "The approvals electronics need to be sold differ by market; booking labs late is the classic delay." },
    { group: "Documents", title: "Test plan and pre-compliance budget", why: "Lab time is booked, not improvised — the plan names it up front." },
  ],
};

export function scopingChecklist(rawInput: unknown) {
  const input = ScopingInput.parse(rawInput);
  const groups = new Map<string, { title: string; why: string }[]>();
  const add = (group: string, title: string, why: string) => {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ title, why });
  };
  add("Decisions", "What the product must do, in testable plain sentences", "Every later number — cost, timeline, matching — is only as good as this list.");
  add("Decisions", "What is deliberately out of scope for the first version", "Naming the 'later' list now is what keeps the first version shippable.");
  add("Documents", "Budget range and the date the product must exist by", "Engineers bid seriously against a range and a date, not against 'ASAP'.");
  for (const need of input.needs) {
    for (const item of NEED_CHECKLIST[need] ?? []) add(item.group, item.title, item.why);
  }
  add("Compliance", "Whether any regulated market or safety category applies", "If it does, compliance preparation joins the plan from week one, not as a surprise at the end.");
  return {
    productType: input.productType,
    groups: [...groups.entries()].map(([name, items]) => ({ name, items })),
    assumptions: [
      "Checklist generated from the product type and needs picked — it is the starting list a scoping conversation works through, not a substitute for one.",
      "Items are decisions and documents to have ready before design spend, in the order a project usually needs them.",
    ],
  };
}

export const TimelineInput = z.object({
  needs: z.array(z.string()).min(1, "Pick at least one need"),
  stage: z.string().default("sketch"),
});

export function timelineCalculator(doc: ContentDoc, rawInput: unknown) {
  const input = TimelineInput.parse(rawInput);
  const t = doc.estimator.timeline;
  const scoping = input.stage === "idea" ? { low: 2, high: 3 } : input.stage === "existing" ? { low: 1, high: 1 } : { low: 1, high: 2 };
  const design = { low: Math.round(t.baseLow + input.needs.length * t.perNeedLow), high: Math.round(t.baseHigh + input.needs.length * t.perNeedHigh) };
  const compliance = input.needs.includes("compliance") ? { low: 3, high: 6 } : { low: 1, high: 3 };
  const stages = [
    { name: "Scoping & requirements", weeks: scoping, note: "Ellie's analysis and the decisions on the scoping checklist." },
    { name: "Design & prototyping", weeks: design, note: "The website estimator's own timeline model for the needs picked." },
    { name: "Compliance preparation", weeks: compliance, note: "Preparation runs alongside design where it can; lab waiting time is counted, not hidden." },
    { name: "Manufacturing readiness", weeks: { low: 2, high: 5 }, note: "Design-for-manufacture check and parts-availability confirmation." },
  ];
  return {
    stages,
    totalWeeks: {
      low: stages.reduce((s, x) => s + x.weeks.low, 0),
      high: stages.reduce((s, x) => s + x.weeks.high, 0),
    },
    assumptions: [
      "Stage ranges assume the waiting time (parts, labs, factories) is counted inside the stages that wait — not added later as a surprise.",
      "Stages overlap in real projects; the total is the sum of stage ranges, so it is a planning bound, not a promised date.",
      "A named engineer confirms any timeline before it is relied on for a launch.",
    ],
  };
}
