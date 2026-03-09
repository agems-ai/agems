-- Migrate existing AWAITING_APPROVAL tasks to PENDING
UPDATE "Task" SET "status" = 'PENDING' WHERE "status" = 'AWAITING_APPROVAL';

-- Remove the AWAITING_APPROVAL value from TaskStatus enum
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'IN_TESTING', 'VERIFIED', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED');
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE "TaskStatus" USING ("status"::text::"TaskStatus");
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "TaskStatus_old";
