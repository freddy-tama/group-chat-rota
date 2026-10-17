import { pgTable, text, integer, real, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

// One workspace = one team (a café, a bar, a clinic). Every row below carries workspace_id, and
// every query is scoped by the signed-in owner, so one workspace can never read another's data.

export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash"), // null for Try-demo guests
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  managerName: text("manager_name").notNull().default("Manager"),
  dateOrder: text("date_order").notNull().default("dmy"), // default when a paste can't tell
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => [index("workspaces_owner_idx").on(t.ownerId), index("workspaces_expires_idx").on(t.expiresAt)]);

export const staff = pgTable("staff", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // stable per-workspace key ("st_ana"); the solver sorts and breaks ties by it
  name: text("name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  roles: jsonb("roles").$type<string[]>().notNull().default([]),
  maxHours: real("max_hours").notNull(),
  maxShifts: integer("max_shifts"),
  hourlyRate: real("hourly_rate"),
}, (t) => [uniqueIndex("staff_ws_key_idx").on(t.workspaceId, t.key)]);

export const rulePacks = pgTable("rule_packs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: integer("version").notNull(),
  effectiveFrom: text("effective_from").notNull(), // local date
  minRestHours: real("min_rest_hours").notNull(),
  maxHoursDefault: real("max_hours_default").notNull(),
  maxShiftsPerDay: integer("max_shifts_per_day").notNull().default(1),
  source: text("source"), // e.g. "EU Working Time Directive 2003/88/EC art. 3 (11 h daily rest)"
});

export const weeks = pgTable("weeks", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  weekStart: text("week_start").notNull(), // local date of the Monday
  status: text("status").notNull().default("draft"), // draft | published
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedSolution: jsonb("published_solution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("weeks_ws_idx").on(t.workspaceId)]);

export const shifts = pgTable("shifts", {
  id: text("id").primaryKey(),
  weekId: text("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // "sh_01"
  label: text("label").notNull(),
  role: text("role").notNull(),
  localDate: text("local_date").notNull(),
  startLocal: text("start_local").notNull(),
  endLocal: text("end_local").notNull(),
}, (t) => [uniqueIndex("shifts_week_key_idx").on(t.weekId, t.key)]);

export const pins = pgTable("pins", {
  id: text("id").primaryKey(),
  weekId: text("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
  shiftId: text("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
  staffId: text("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  weekId: text("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull(),
  seq: integer("seq").notNull(), // global order within the week
  author: text("author").notNull(),
  staffId: text("staff_id").references(() => staff.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  timestampBasis: text("timestamp_basis").notNull().default("parsed"), // parsed | assumed
  sourceApp: text("source_app").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("messages_week_idx").on(t.weekId)]);

/** A constraint is stored in local terms; instants are computed from the workspace zone when solving. */
export const constraints = pgTable("constraints", {
  id: text("id").primaryKey(),
  weekId: text("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
  messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }),
  staffId: text("staff_id").references(() => staff.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // unavailable | available | prefer | prefer_not | max_shifts | max_hours
  dateFrom: text("date_from"),
  dateTo: text("date_to"),
  timeFrom: text("time_from"),
  timeTo: text("time_to"),
  daily: boolean("daily").notNull().default(false), // the time window repeats on every day of the range
  shiftLabel: text("shift_label"),
  value: real("value"),
  quote: text("quote").notNull(),
  status: text("status").notNull(), // proposed | confirmed | rejected | ask
  origin: text("origin").notNull(), // seed | ai-replay | ai-live | manager
  confidence: text("confidence"),
  checks: jsonb("checks").$type<{ name: string; ok: boolean; detail: string }[]>().notNull().default([]),
  askReason: text("ask_reason"),
  draftReply: text("draft_reply"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [index("constraints_week_idx").on(t.weekId)]);

export const shareLinks = pgTable("share_links", {
  id: text("id").primaryKey(),
  weekId: text("week_id").notNull().references(() => weeks.id, { onDelete: "cascade" }),
  staffId: text("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  token: text("token").notNull(), // shown to the owner again later; lookups use the hash
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("share_token_idx").on(t.tokenHash)]);

export const fairnessHistory = pgTable("fairness_history", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  staffId: text("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  weeks: integer("weeks").notNull(),
  closes: integer("closes").notNull(),
  weekends: integer("weekends").notNull(),
  nights: integer("nights").notNull(),
});

/** Every model call (live or replayed), for rate limits and for recording replay fixtures. */
export const aiCalls = pgTable("ai_calls", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  fixtureKey: text("fixture_key").notNull(),
  mode: text("mode").notNull(), // replay | live | none
  model: text("model"),
  promptVersion: text("prompt_version").notNull(),
  output: jsonb("output"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ai_calls_ws_idx").on(t.workspaceId, t.createdAt)]);
