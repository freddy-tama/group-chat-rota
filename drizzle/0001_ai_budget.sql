CREATE TABLE "ai_budget" (
	"bucket" text PRIMARY KEY NOT NULL,
	"live_calls" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL
);
