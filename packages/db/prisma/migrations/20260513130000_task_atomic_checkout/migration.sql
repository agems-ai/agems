-- Atomic task checkout: prevents two scheduler instances from claiming the
-- same PENDING task. Each tick does an updateMany() with a predicate
-- (status='PENDING' AND (locked_by IS NULL OR locked_until < NOW()))
-- and gets back the rows it actually claimed.

ALTER TABLE "tasks" ADD COLUMN "locked_by" TEXT;
ALTER TABLE "tasks" ADD COLUMN "locked_until" TIMESTAMP(3);

-- Scheduler hot-path: claim query filters by (status, locked_by, locked_until).
CREATE INDEX "tasks_status_locked_by_locked_until_idx"
  ON "tasks"("status", "locked_by", "locked_until");
