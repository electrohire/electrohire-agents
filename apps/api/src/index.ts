import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

/**
 * ElectroHire public API — SCAFFOLD.
 *
 * This worker currently exposes a single health endpoint. It exists to prove
 * the wiring (Hono + Zod schemas generating an OpenAPI 3.1 document) for the
 * real API described in docs/architecture.md. It is not yet the production API.
 *
 * Keep API_VERSION in sync with this package's package.json version.
 */
export const API_VERSION = "0.1.0";

const app = new OpenAPIHono();

const HealthResponse = z
  .object({
    status: z.literal("ok"),
    version: z.string(),
  })
  .openapi("HealthResponse");

const healthRoute = createRoute({
  method: "get",
  path: "/v1/health",
  tags: ["System"],
  summary: "Service health",
  description: "Returns the API status and the deployed component version.",
  responses: {
    200: {
      description: "The API is up.",
      content: {
        "application/json": {
          schema: HealthResponse,
        },
      },
    },
  },
});

app.openapi(healthRoute, (c) =>
  c.json({ status: "ok" as const, version: API_VERSION }, 200),
);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "ElectroHire API",
    version: API_VERSION,
    description:
      "Public API for ElectroHire, the AI-powered electronics engineering marketplace. Scaffold build: only the health endpoint is implemented.",
  },
});

export default app;
