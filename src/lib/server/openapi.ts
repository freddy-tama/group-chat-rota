// OpenAPI 3.1 description of the public API, served at /api/openapi.json for the backend test suite.

const err = { $ref: "#/components/schemas/Error" };
const json = (schema: object) => ({ "application/json": { schema } });
const res = (description: string, schema?: object) => (schema ? { description, content: json(schema) } : { description });
const errors = (...codes: number[]) =>
  Object.fromEntries(
    codes.map((c) => [
      String(c),
      res(
        {
          401: "No session, or the token is invalid or forged",
          403: "A staff share link was used on a manager endpoint",
          404: "Not found, or belongs to another workspace",
          409: "The week is published (locked)",
          422: "Validation failed",
        }[c] ?? "Error",
        err,
      ),
    ]),
  );
const idParam = (name: string, description: string) => ({ name, in: "path", required: true, schema: { type: "string" }, description });

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Group Chat Rota API",
    version: "1.0.0",
    description:
      "Paste a staff group chat; each message becomes a quoted constraint the manager confirms; a deterministic solver builds the week's rota. " +
      "Start with POST /api/demo (no sign-up) to get a token and a freshly seeded demo workspace (Corner Café, week of Mon 19 Oct 2026, Europe/London). " +
      "Send the token as `Authorization: Bearer <token>`. Only confirmed constraints reach the solver.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" }, details: { type: "array", items: { type: "object" } } } } },
      },
      Session: {
        type: "object",
        required: ["token", "workspaceId", "weekId"],
        properties: { token: { type: "string" }, workspaceId: { type: "string" }, weekId: { type: "string" } },
      },
      Credentials: {
        type: "object",
        required: ["email", "password"],
        properties: { email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 } },
      },
      Constraint: {
        type: "object",
        properties: {
          id: { type: "string" },
          messageId: { type: ["string", "null"] },
          staffId: { type: ["string", "null"] },
          kind: { type: "string", enum: ["unavailable", "available", "prefer", "prefer_not", "max_shifts", "max_hours", "unknown"] },
          dateFrom: { type: ["string", "null"], format: "date" },
          dateTo: { type: ["string", "null"], format: "date" },
          timeFrom: { type: ["string", "null"], example: "16:00" },
          timeTo: { type: ["string", "null"] },
          daily: { type: "boolean" },
          shiftLabel: { type: ["string", "null"] },
          value: { type: ["number", "null"] },
          quote: { type: "string", description: "Exact words from the chat message" },
          status: { type: "string", enum: ["proposed", "confirmed", "rejected", "ask"] },
          origin: { type: "string", enum: ["seed", "ai-replay", "ai-live", "manager"] },
          checks: { type: "array", items: { type: "object", properties: { name: { type: "string" }, ok: { type: "boolean" }, detail: { type: "string" } } } },
          askReason: { type: ["string", "null"] },
          draftReply: { type: ["string", "null"] },
        },
      },
      Solution: {
        type: "object",
        required: ["assignments", "uncovered", "coverage", "violations", "rulePack"],
        properties: {
          assignments: { type: "array", items: { type: "object", properties: { shiftId: { type: "string" }, staffId: { type: "string" }, pinned: { type: "boolean" } } } },
          uncovered: {
            type: "array",
            items: {
              type: "object",
              properties: {
                shiftId: { type: "string" },
                role: { type: "string" },
                withoutRole: { type: "integer" },
                blockers: {
                  type: "array",
                  items: { type: "object", properties: { staffId: { type: "string" }, reason: { type: "string", enum: ["unavailable", "overlap", "per_day", "rest", "max_hours", "max_shifts"] }, detail: { type: "string" }, quote: { type: "string" }, hours: { type: "number" } } },
                },
              },
            },
          },
          coverage: { type: "object", properties: { covered: { type: "integer" }, total: { type: "integer" } } },
          totals: { type: "array", items: { type: "object", properties: { staffId: { type: "string" }, hours: { type: "number" }, shifts: { type: "integer" }, minRestHours: { type: ["number", "null"] } } } },
          violations: { type: "array", description: "From an independent checker; always empty for solver output", items: { type: "object" } },
          rulePack: { type: "object", properties: { name: { type: "string" }, version: { type: "integer" }, minRestHours: { type: "number" } } },
          solvedInMs: { type: "number" },
        },
      },
    },
  },
  security: [{ bearer: [] }],
  paths: {
    "/api/health": { get: { summary: "Health check", security: [], responses: { 200: res("OK") } } },
    "/api/demo": {
      post: { summary: "Start a demo: fresh seeded workspace, no sign-up", security: [], responses: { 201: res("Demo session", { $ref: "#/components/schemas/Session" }) } },
    },
    "/api/auth/register": {
      post: {
        summary: "Create an account (starts with a copy of the sample café)",
        security: [],
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/Credentials" }) },
        responses: { 201: res("Created", { $ref: "#/components/schemas/Session" }), 409: res("Email taken", err), ...errors(422) },
      },
    },
    "/api/auth/login": {
      post: {
        summary: "Sign in",
        security: [],
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/Credentials" }) },
        responses: { 200: res("Signed in"), 401: res("Wrong email or password", err), ...errors(422) },
      },
    },
    "/api/auth/logout": { post: { summary: "Sign out (clears the cookie)", responses: { 204: res("Signed out") } } },
    "/api/me": { get: { summary: "The signed-in user and their workspaces", responses: { 200: res("OK"), ...errors(401, 403) } } },
    "/api/workspaces": {
      get: { summary: "List my workspaces", responses: { 200: res("OK"), ...errors(401, 403) } },
      post: {
        summary: "Create a workspace from the sample café template",
        requestBody: { required: true, content: json({ type: "object", required: ["name"], properties: { name: { type: "string", minLength: 1 } } }) },
        responses: { 201: res("Created"), ...errors(401, 403, 422) },
      },
    },
    "/api/workspaces/{id}": {
      parameters: [idParam("id", "Workspace id")],
      get: { summary: "One workspace and its weeks", responses: { 200: res("OK"), ...errors(401, 403, 404) } },
      delete: { summary: "Delete the workspace and everything in it", responses: { 204: res("Deleted"), ...errors(401, 403, 404) } },
    },
    "/api/weeks/{id}": {
      parameters: [idParam("id", "Week id")],
      get: { summary: "The week: staff, shifts, chat messages, constraints and the current solution", responses: { 200: res("OK"), ...errors(401, 403, 404) } },
    },
    "/api/weeks/{id}/messages": {
      parameters: [idParam("id", "Week id")],
      post: {
        summary: "Paste chat messages. Each becomes proposed constraints with quotes and checks, or an Ask item. Nothing reaches the solver until confirmed.",
        requestBody: {
          required: true,
          content: json({
            type: "object",
            required: ["text", "consent"],
            properties: {
              text: { type: "string", example: "[18/10/2026, 21:30:02] Ana: actually I can do sat close now" },
              consent: { type: "boolean", const: true, description: "The team agreed to have messages processed" },
              dateOrder: { type: "string", enum: ["dmy", "mdy"] },
            },
          }),
        },
        responses: { 201: res("Read and proposed"), ...errors(401, 403, 404, 409, 422) },
      },
    },
    "/api/weeks/{id}/solve": {
      parameters: [idParam("id", "Week id")],
      post: { summary: "Solve from confirmed constraints only", responses: { 200: res("Solution", { $ref: "#/components/schemas/Solution" }), ...errors(401, 403, 404, 409) } },
    },
    "/api/weeks/{id}/confirm-all": {
      parameters: [idParam("id", "Week id")],
      post: {
        summary: "Confirm every complete proposed constraint (or only the ids given)",
        requestBody: { content: json({ type: "object", properties: { ids: { type: "array", items: { type: "string" } } } }) },
        responses: { 200: res("Confirmed and re-solved"), ...errors(401, 403, 404, 409, 422) },
      },
    },
    "/api/weeks/{id}/shifts/{shiftId}/why": {
      parameters: [idParam("id", "Week id"), idParam("shiftId", "Shift id")],
      get: { summary: "Why this person is on this shift, and the rule that stops each other person", responses: { 200: res("OK"), ...errors(401, 403, 404) } },
    },
    "/api/constraints/{id}": {
      parameters: [idParam("id", "Constraint id")],
      patch: {
        summary: "Edit a constraint (inline edit). It still needs confirming.",
        requestBody: { required: true, content: json({ $ref: "#/components/schemas/Constraint" }) },
        responses: { 200: res("Updated"), ...errors(401, 403, 404, 409, 422) },
      },
    },
    "/api/constraints/{id}/confirm": {
      parameters: [idParam("id", "Constraint id")],
      post: { summary: "Confirm: the constraint now counts and the week re-solves", responses: { 200: res("Confirmed"), ...errors(401, 403, 404, 409, 422) } },
    },
    "/api/constraints/{id}/reject": {
      parameters: [idParam("id", "Constraint id")],
      post: { summary: "Reject: the constraint never counts", responses: { 200: res("Rejected"), ...errors(401, 403, 404, 409) } },
    },
    "/api/staff/{id}": {
      parameters: [idParam("id", "Staff id")],
      patch: {
        summary: "Edit a staff member",
        requestBody: { required: true, content: json({ type: "object", properties: { name: { type: "string" }, maxHours: { type: "number", minimum: 0, maximum: 80 }, maxShifts: { type: ["integer", "null"] }, roles: { type: "array", items: { type: "string" } } } }) },
        responses: { 200: res("Updated"), ...errors(401, 403, 404, 422) },
      },
    },
    "/api/parse-chat": {
      post: {
        summary: "Stateless: how a pasted chat is read (app, date order, timestamps) before any AI runs",
        security: [],
        requestBody: { required: true, content: json({ type: "object", required: ["text"], properties: { text: { type: "string" }, timezone: { type: "string", default: "Europe/London" }, dateOrder: { type: "string", enum: ["dmy", "mdy"] } } }) },
        responses: { 200: res("Parsed"), ...errors(422) },
      },
    },
  },
} as const;
