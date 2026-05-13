-- audit-queue-depth.sql — open task counts per agent
-- Usage: psql -v org_id="'<org-uuid>'" -f audit-queue-depth.sql

\set ON_ERROR_STOP on

SELECT
  a.name,
  a.slug,
  COUNT(*) FILTER (WHERE t.status = 'PENDING')      AS pending,
  COUNT(*) FILTER (WHERE t.status = 'IN_PROGRESS')  AS in_progress,
  COUNT(*) FILTER (WHERE t.status = 'IN_REVIEW')    AS in_review,
  COUNT(*) FILTER (WHERE t.status = 'BLOCKED')      AS blocked,
  MAX(e.started_at)                                 AS last_exec
FROM agents a
LEFT JOIN tasks t
  ON t.assignee_type = 'AGENT'
 AND t.assignee_id   = a.id
 AND t.status IN ('PENDING','IN_PROGRESS','IN_REVIEW','BLOCKED')
LEFT JOIN agent_executions e
  ON e.agent_id = a.id
WHERE a.org_id = :org_id::text
GROUP BY a.name, a.slug
ORDER BY (COUNT(*) FILTER (WHERE t.status IN ('PENDING','IN_PROGRESS','IN_REVIEW'))) DESC,
         last_exec DESC NULLS LAST;
