-- backfill-null-results.sql — find COMPLETED/VERIFIED tasks with NULL result
-- Usage: psql -v org_id="'<org-uuid>'" -f backfill-null-results.sql
--
-- Returns tasks whose status says they succeeded but whose result column is empty.
-- Common cause: agent finished work and posted the deliverable in a channel/file
-- but never wrote it back to the task record. These rows make the dashboard
-- look like work disappeared. Triage manually or auto-extract from messages.

\set ON_ERROR_STOP on

SELECT
  t.id,
  a.name              AS agent,
  t.status,
  LEFT(t.title, 80)   AS title,
  t.completed_at,
  EXTRACT(EPOCH FROM (NOW() - t.completed_at))::int / 3600 AS hours_ago
FROM tasks t
JOIN agents a ON t.assignee_id = a.id
WHERE a.org_id = :org_id::text
  AND t.status IN ('COMPLETED', 'VERIFIED')
  AND t.result IS NULL
  AND t.completed_at > NOW() - INTERVAL '7 days'
ORDER BY t.completed_at DESC;
