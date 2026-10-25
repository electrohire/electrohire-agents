/**
 * E-01 — the versioned intake question set, as data.
 *
 * The website repo will carry specs/002-ellie-platform/question-set.md as
 * the human-readable document; that document is GENERATED from the
 * vendored copy of this set (question-set.json, beside this file) — the
 * JSON is the source the engine runs, and the battery
 * (tests/frozen/ellie.test.mjs) diffs the engine's set against it, so the
 * asked questions can never silently drift from the versioned document.
 */
export const QUESTION_SET_VERSION = "1.0.0";

export interface QuestionField {
  id: string;
  prompt: string;
  type: "text" | "textarea" | "choice";
  required: boolean;
  category: "project" | "stage" | "constraints" | "budget" | "timeline" | "compliance";
  choices?: string[];
}

export const QUESTION_SET: QuestionField[] = [
  { id: "project_description", category: "project", type: "textarea", required: true, prompt: "What are you building? Describe the product and what it must do, in plain words." },
  { id: "project_type", category: "project", type: "text", required: true, prompt: "Which project type fits best — for example a consumer sensor device, a motor controller, or firmware for an existing board?" },
  { id: "stage", category: "stage", type: "choice", required: true, choices: ["idea", "sketch", "prototype", "existing", "production"], prompt: "What stage is the project at — idea, sketch, prototype, existing product, or production?" },
  { id: "constraints", category: "constraints", type: "textarea", required: true, prompt: "What constraints matter most — size, power, environment, cost, or parts you have already chosen?" },
  { id: "budget_posture", category: "budget", type: "text", required: true, prompt: "What is your budget posture — a range you want to stay inside, or a target you want us to test?" },
  { id: "timeline", category: "timeline", type: "text", required: true, prompt: "When must this exist, and what drives that date?" },
  { id: "compliance_context", category: "compliance", type: "textarea", required: true, prompt: "Where will this be sold or used, and do any approvals or handling rules apply (for example FCC/CE, or controlled information)?" },
];

export interface StarterPrompt { label: string; prompt: string; projectType: string }

/** E-01: contextual starter prompts tied to real project types — intake
 * never opens on a blank box alone. */
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
