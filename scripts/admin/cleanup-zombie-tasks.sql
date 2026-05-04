-- cleanup-zombie-tasks.sql — bulk-cancel FAILED tasks older than 14 days
-- Usage: psql -v org_id="'<org-uuid>'" -f cleanup-zombie-tasks.sql
--
-- Run audit first to see the scope:
--   SELECT a.name, COUNT(*) FROM tasks t JOIN agents a ON t.assignee_id = a.id
--   WHERE a.org_id = '<org-uuid>' AND t.status = 'FAILED'
--     AND t.updated_at < NOW() - INTERVAL '14 days' GROUP BY a.name;

\set ON_ERROR_STOP on

UPDATE tasks
SET
  status      = 'CANCELLED',
  updated_at  = NOW(),
  description = COALESCE(description, '') ||
                E'\n\n[zombie cleanup ' || NOW()::date || ': bulk-cancelled stale FAILED >14d]'
WHERE assignee_id IN (
        SELECT id FROM agents WHERE org_id = :org_id::text
      )
  AND status     = 'FAILED'
  AND updated_at < NOW() - INTERVAL '14 days'
RETURNING id, status;
