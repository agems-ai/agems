-- Per-execution cost attribution: provider/model/in-out token split.
-- CreditLedger already stores this for billing; AgentExecution duplicates it
-- so dashboards can slice spend by model without joining ledger.

ALTER TABLE "agent_executions" ADD COLUMN "provider" TEXT;
ALTER TABLE "agent_executions" ADD COLUMN "model" TEXT;
ALTER TABLE "agent_executions" ADD COLUMN "input_tokens" INTEGER;
ALTER TABLE "agent_executions" ADD COLUMN "output_tokens" INTEGER;
ALTER TABLE "agent_executions" ADD COLUMN "cached_input_tokens" INTEGER;

CREATE INDEX "agent_executions_provider_model_idx" ON "agent_executions"("provider", "model");
