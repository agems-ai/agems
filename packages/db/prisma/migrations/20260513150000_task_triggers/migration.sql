-- Task triggers: external events that fire an existing Task by slug + signature.
-- Multi-tenant isolation via org_id. slug is globally unique (URL-resolvable).

CREATE TYPE "TriggerKind" AS ENUM ('WEBHOOK', 'GMAIL', 'N8N');
CREATE TYPE "TriggerAuthKind" AS ENUM ('HMAC', 'BEARER', 'NONE');

CREATE TABLE "task_triggers" (
  "id"               TEXT PRIMARY KEY,
  "org_id"           TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "task_id"          TEXT NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "slug"             TEXT NOT NULL UNIQUE,
  "kind"             "TriggerKind" NOT NULL DEFAULT 'WEBHOOK',
  "auth_kind"        "TriggerAuthKind" NOT NULL DEFAULT 'HMAC',
  "auth_secret_enc"  TEXT,
  "signature_header" TEXT,
  "enabled"          BOOLEAN NOT NULL DEFAULT true,
  "last_fired_at"    TIMESTAMP(3),
  "firing_count"     INTEGER NOT NULL DEFAULT 0,
  "metadata"         JSONB,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL
);

CREATE INDEX "task_triggers_org_id_idx" ON "task_triggers"("org_id");
CREATE INDEX "task_triggers_task_id_idx" ON "task_triggers"("task_id");
