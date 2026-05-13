-- Curator lifecycle for skills (Hermes-style ACTIVE → STALE → ARCHIVED).
-- All columns nullable / defaulted — safe for existing rows.

CREATE TYPE "SkillState" AS ENUM ('ACTIVE', 'STALE', 'ARCHIVED');

ALTER TABLE "skills" ADD COLUMN "state" "SkillState" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "skills" ADD COLUMN "last_used_at" TIMESTAMP(3);
ALTER TABLE "skills" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "skills" ADD COLUMN "author_type" "ActorType" NOT NULL DEFAULT 'HUMAN';
ALTER TABLE "skills" ADD COLUMN "author_id" TEXT;

-- Curator hot-path: find STALE candidates (state, lastUsedAt).
CREATE INDEX "skills_state_last_used_at_idx" ON "skills"("state", "last_used_at");
