/**
 * E-01 — the versioned intake question set, as data.
 *
 * ALIGNED 2026-10-25 to production's AGREED set (copy audit): the
 * project-intake flow extracted verbatim in QUESTION-SET.md
 * (hidden_files/next-phase-2026-10-25) from EllieChatAssistant-BE
 * services/llm/schema/project_intake + workflow_determiner.py's ask
 * order: project_stage → details → services_needed → start_date →
 * end_date → currency → budget → per-service detail areas →
 * required_tools → preferred_tools → expected_deliverables →
 * unknowns → design_risks → extra_information. Field prompts keep
 * production's phrasing where production has phrasing; slug values are
 * production's exact tokens (project_stage: IDEATION,
 * DEFINING_SCOPE_OF_WORK, READY_FOR_DEVELOPMENT, UNDER_DEVELOPMENT,
 * PRODUCTION, UPDATES_NEEDED; services: SYSTEM_ARCHITECTURE,
 * HARDWARE_DESIGN, FIRMWARE, INTEGRATION).
 *
 * Facts-pass adaptations (production wording vs the beta's published
 * facts — the beta's own content source wins; each adaptation noted):
 *  A1. Stage slugs: the project-intake tokens above win over the
 *      customer-onboarding slugs (early-tech/mvp/field-trials/
 *      scaling) — the analyst flow is what spec 002 governs.
 *  A2. Production's internal budget sanity ranges (typical fixed
 *      2,500–5,000 USD; hourly 50–250 USD/hr) are NOT carried
 *      anywhere: production itself forbids quoting them to users,
 *      and beta figures come only from the beta content source.
 *  A3. Production asks timeline+budget in ONE bundled message (with
 *      an emoji). The beta's stepped machine asks start_date,
 *      end_date, currency and budget as consecutive fields — the
 *      bundle preserved as a block; the emoji is dropped under the
 *      plain-language rule.
 *  A4. The onboarding flows (customer / freelancer / supplier) are
 *      NOT merged in: they are profile onboarding (Phase M), not
 *      spec 002's analyst intake. Production has no phrasing for
 *      first_name/last_name/email (they arrive from the account);
 *      the beta likewise takes identity from the session/account
 *      and invents no identity questions.
 *  A5. Production's team_size-in-individual-tail inconsistency is
 *      an onboarding matter and is not inherited.
 *  A6. Currency: production treats "$" as USD. The beta keeps the
 *      currency field in production's position with USD the
 *      expected value; no FX conversion is ported in Phase E.
 *  A7. No analyst question touches fees, Sparks, or verification,
 *      and production's knowledge figures (customer +10% /
 *      freelancer −5%, 5 Sparks a bid, $2 verification, PayPal
 *      payouts) were NOT ported into any prompt — beta facts live
 *      in the beta content source (C-01 mirror) only.
 *
 * The website repo carries specs/002-ellie-platform/question-set.md,
 * generated from the vendored copy of this set (question-set.json
 * beside this file); the battery diffs the two so the asked questions
 * cannot silently drift from the versioned document.
 */
export const QUESTION_SET_VERSION = "1.0.0";

export interface QuestionField {
  id: string;
  prompt: string;
  type: "text" | "textarea" | "choice" | "multi";
  required: boolean;
  category: "project" | "stage" | "constraints" | "budget" | "timeline" | "compliance";
  choices?: string[];
}

export const QUESTION_SET: QuestionField[] = [
  { id: "project_stage", category: "stage", type: "choice", required: true,
    choices: ["IDEATION", "DEFINING_SCOPE_OF_WORK", "READY_FOR_DEVELOPMENT", "UNDER_DEVELOPMENT", "PRODUCTION", "UPDATES_NEEDED"],
    prompt: "What stage is the project at right now?" },
  { id: "details", category: "project", type: "textarea", required: true,
    prompt: "What are you building? Tell me what it should do, who it's for, and where it will be used — in your own words." },
  { id: "services_needed", category: "project", type: "multi", required: true,
    choices: ["SYSTEM_ARCHITECTURE", "HARDWARE_DESIGN", "FIRMWARE", "INTEGRATION"],
    prompt: "Which of these services apply to your project — System Architecture, Hardware Design, Firmware, Integration? Name the ones you need; I won't assume any from the description." },
  { id: "start_date", category: "timeline", type: "text", required: true,
    prompt: "When are you hoping to start? A specific date if you have one — vague timing is fine too, and I'll record it as an open item rather than guess a date." },
  { id: "end_date", category: "timeline", type: "text", required: false,
    prompt: "And roughly when do you need to wrap up? Skip this if you only have a start date — I won't invent an end date." },
  { id: "currency", category: "budget", type: "choice", required: false,
    choices: ["USD", "EUR", "GBP", "INR", "other"],
    prompt: "What currency is the budget in? US dollars are the default." },
  { id: "budget", category: "budget", type: "text", required: true,
    prompt: "Do you have a rough budget in mind? Even a ballpark works." },
  { id: "constraints", category: "constraints", type: "textarea", required: true,
    prompt: "What constraints matter most — form factor, power, environment, thermal limits, or parts you've already chosen?" },
  { id: "compliance_requirements", category: "compliance", type: "textarea", required: false,
    prompt: "Do any compliance requirements or certifications apply — for example FCC, CE, or safety standards? 'None' or 'not sure' are fine answers." },
  { id: "required_tools", category: "project", type: "text", required: false,
    prompt: "Are there tools the engineer must know or use for this project?" },
  { id: "preferred_tools", category: "project", type: "text", required: false,
    prompt: "Any preferred tools, platforms, or toolchains?" },
  { id: "expected_deliverables", category: "project", type: "text", required: false,
    prompt: "What are the main project deliverables you'll need at the end? Things like schematics, BOM, manufacturing files, firmware binary, test reports." },
  { id: "unknowns", category: "project", type: "textarea", required: false,
    prompt: "Anything you're unsure about? 'I don't know yet' is a legitimate answer — those become open items for the engineer, not gaps I'll fill in." },
  { id: "design_risks", category: "project", type: "textarea", required: false,
    prompt: "Any design risks you're already aware of?" },
  { id: "extra_information", category: "project", type: "textarea", required: false,
    prompt: "Anything else that would help — team background, prior work, how you like to collaborate?" },
];

export interface StarterPrompt { label: string; prompt: string; projectType: string }

/** E-01: contextual starter prompts tied to real project types — intake
 * never opens on a blank box alone. (The panel's starter chips are
 * served from widget-config; these are the service-side defaults.) */
export const STARTER_PROMPTS: Record<string, StarterPrompt> = {
  "consumer-sensor": { label: "A consumer sensor device", projectType: "consumer sensor device", prompt: "I'm building a consumer sensor device. It should measure its environment, run a long time on a small battery, and connect to a phone app." },
  "motor-controller": { label: "A motor controller", projectType: "motor controller", prompt: "I'm building a motor controller for a small machine. It needs precise speed control, safety cut-offs, and a simple control interface." },
  "firmware-existing-board": { label: "Firmware for an existing board", projectType: "firmware for an existing board", prompt: "I have an existing board and need firmware for it. The hardware is fixed; the work is behaviour, updates, and reliability." },
  "iot-device": { label: "A connected (IoT) device", projectType: "iot device", prompt: "I'm building a connected device that reports data over Wi-Fi or cellular and needs over-the-air updates." },
};

export function starterPromptsFor(projectType?: string): StarterPrompt[] {
  if (projectType) {
    const hit = Object.values(STARTER_PROMPTS).find((s) => s.projectType === projectType);
    if (hit) return [hit, ...Object.values(STARTER_PROMPTS).filter((s) => s !== hit)];
  }
  return Object.values(STARTER_PROMPTS);
}
