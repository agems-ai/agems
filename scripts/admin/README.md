# AGEMS admin scripts

Maintenance + safety tooling for an AGEMS deployment. Each script is parameterized — pass the org_id you want to operate on. Tested against the `tasks`, `agents`, `agent_memory` tables that ship with the platform.

## Quick start

```bash
# from the postgres container or a host with access:
ORG_ID=your-org-uuid psql -U agems -d agems -v org_id="'$ORG_ID'" -f scripts/admin/audit-queue-depth.sql
```

Or via docker:

```bash
docker exec -i your-postgres-container psql -U agems -d agems \
  -v org_id="'your-org-uuid'" -f /path/to/scripts/admin/audit-queue-depth.sql
```

## Scripts

| Script | What it does | When to run |
|---|---|---|
| `audit-queue-depth.sql` | Lists open task counts per agent (PENDING/IN_PROGRESS/BLOCKED/IN_REVIEW). | Hourly, or when agents look idle. |
| `cleanup-zombie-tasks.sql` | Bulk-cancels FAILED tasks older than 14 days. Adds an audit note. | Weekly maintenance. Run dry-run version first. |
| `backfill-null-results.sql` | Finds COMPLETED/VERIFIED tasks with `result IS NULL` (agent shipped without saving output) for follow-up. | Whenever the dashboard's task-result column looks sparse. |
| `inject-content-policy.sql` | Appends a CRITICAL CONTENT POLICY block to the `system_prompt` of agents whose mission contains "content", "SEO", "writer", "QA", or "copy". Idempotent. | Once after install. Re-run only if the canonical block needs updating. |
| `inject-knowledge-policy.sql` | Broadcasts an org-wide KNOWLEDGE memory entry to every agent: AI-bot allow-list, no fabricated test claims, SERP length limits. | Once after install. |

## Hooks

`hooks/pre-commit-content-quality.sh` — Git pre-commit hook for content repos that an AGEMS instance publishes to. Catches:

1. Em-dashes (`—`) in user-facing source files (AI-writing tell)
2. `Disallow: /` blocks under `User-agent:` for known AI-engine bots in `robots.txt` (kills AI Citation traffic channel)
3. Site-wide `<meta name="robots" content="noai|noimageai|noindex">` in layout files
4. Fabricated testing claims (`we tested 100+`, `30-day test`, `$500 test`, `tested 20+ X`)
5. Title declarations longer than 62 chars (SERP truncation)
6. Description declarations longer than 165 chars (SERP truncation)

Install on each content repo:

```bash
cp scripts/admin/hooks/pre-commit-content-quality.sh /path/to/content-repo/.git/hooks/pre-commit
chmod +x /path/to/content-repo/.git/hooks/pre-commit
```

The hook is intentionally self-contained — no node, no python, just `sh + grep + awk`. Override (Max only, very rare): `git commit --no-verify`.

## Why these exist

These tools were extracted from the AGEMS Survival experiment after a series of preventable incidents:

- An agent reasoning chain (analyst flagged `chatgpt.com` referrer as "scrapers" → marketing ordered block → engineer executed) added `Disallow: /` for GPTBot to robots.txt, which would have killed the site's biggest organic traffic channel.
- Multiple content-writing agents independently shipped meta titles of 71-86 chars (SERP truncated to ~60) with fabricated testing claims like "we tested 100+ apps" that the agent had not done.
- Stale `FAILED` tasks accumulated to 100+ across the team after a few weeks, polluting the dashboard.
- VERIFIED tasks frequently shipped with `result = NULL` — work was done, but the deliverable lived in chat messages and was never reattached to the task record.

Each script here addresses one of those classes. The pre-commit hook is the mechanical last line of defence; the policy injectors are the cognitive layer.
