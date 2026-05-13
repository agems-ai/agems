-- Platform Budgets: org-wide limits (hourly/daily/monthly) that override per-agent limits.
-- Also extends agent_budgets with nullable daily/hourly limit columns.

-- Budget scope enum for incidents
CREATE TYPE "BudgetScope" AS ENUM ('HOURLY', 'DAILY', 'MONTHLY');

-- Extend agent_budgets: add nullable daily/hourly limits
-- (monthly already exists; now three windows live in one table)
ALTER TABLE "agent_budgets"
  ADD COLUMN "daily_limit_usd"  DOUBLE PRECISION,
  ADD COLUMN "hourly_limit_usd" DOUBLE PRECISION;

-- Migrate any existing per-agent daily/hourly limits from agents.llm_config JSON
-- into the new agent_budgets columns (only for agents that already have a budget row).
UPDATE "agent_budgets" ab
SET
  "daily_limit_usd"  = COALESCE(ab."daily_limit_usd",
    NULLIF((a."llm_config"->>'dailyBudgetUsd')::text, '')::double precision),
  "hourly_limit_usd" = COALESCE(ab."hourly_limit_usd",
    NULLIF((a."llm_config"->>'hourlyBudgetUsd')::text, '')::double precision)
FROM "agents" a
WHERE ab."agent_id" = a."id";

-- Platform budgets: one row per org, hourly/daily/monthly all nullable
CREATE TABLE "platform_budgets" (
    "id"                   TEXT             NOT NULL,
    "org_id"               TEXT             NOT NULL,
    "hourly_limit_usd"     DOUBLE PRECISION,
    "daily_limit_usd"      DOUBLE PRECISION,
    "monthly_limit_usd"    DOUBLE PRECISION,
    "current_spend_usd"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "period_start"         TIMESTAMP(3)     NOT NULL,
    "period_end"           TIMESTAMP(3)     NOT NULL,
    "soft_alert_percent"   INTEGER          NOT NULL DEFAULT 80,
    "hard_stop_enabled"    BOOLEAN          NOT NULL DEFAULT true,
    "alert_sent"           BOOLEAN          NOT NULL DEFAULT false,
    "hard_stop_triggered"  BOOLEAN          NOT NULL DEFAULT false,
    "metadata"             JSONB,
    "created_at"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "platform_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_budgets_org_id_key"  ON "platform_budgets"("org_id");
CREATE INDEX        "platform_budgets_org_id_idx"  ON "platform_budgets"("org_id");

ALTER TABLE "platform_budgets"
  ADD CONSTRAINT "platform_budgets_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Platform budget incidents (hourly/daily/monthly scope)
CREATE TABLE "platform_budget_incidents" (
    "id"                  TEXT                 NOT NULL,
    "platform_budget_id"  TEXT                 NOT NULL,
    "type"                "BudgetIncidentType" NOT NULL,
    "scope"               "BudgetScope"        NOT NULL,
    "message"             TEXT                 NOT NULL,
    "spend_usd"           DOUBLE PRECISION     NOT NULL,
    "limit_usd"           DOUBLE PRECISION     NOT NULL,
    "created_at"          TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_budget_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_budget_incidents_platform_budget_id_idx"
  ON "platform_budget_incidents"("platform_budget_id");

ALTER TABLE "platform_budget_incidents"
  ADD CONSTRAINT "platform_budget_incidents_platform_budget_id_fkey"
  FOREIGN KEY ("platform_budget_id") REFERENCES "platform_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
