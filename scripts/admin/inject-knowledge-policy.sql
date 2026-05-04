-- inject-knowledge-policy.sql — broadcast org-wide KNOWLEDGE memory to every
-- agent in the org. Covers truth gate, AI-bot policy, SERP length limits.
--
-- Why all agents (not only writers): non-writers brief writers. The classic
-- failure mode is an analyst misreading a metric, marketing escalating, an
-- engineer executing — and the policy has to be in everyone's memory to
-- break that chain at the briefing stage, not just the commit stage.
--
-- Usage: psql -v org_id="'<org-uuid>'" -f inject-knowledge-policy.sql

\set ON_ERROR_STOP on

INSERT INTO agent_memory (id, agent_id, type, content, created_at)
SELECT
  gen_random_uuid()::text,
  a.id,
  'KNOWLEDGE',
  'CONTENT QUALITY POLICY (enforced by pre-commit hook on content repos):

1. TRUTH GATE: never claim testing or spending that did not happen. Forbidden phrases: "we tested N+", "30-day test", "$500 test", "tested 20+ X". Use "compared", "reviewed", "analyzed" instead.

2. LENGTH GATE: title <=62 chars (SERP truncation), description <=165 chars. The hook rejects longer.

3. EM-DASH GATE: no em-dashes (—) in user-facing files. Use hyphen.

4. AI-BOT GATE: never propose blocking GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, CCBot, Applebot-Extended, Bytespider, Amazonbot, Meta-ExternalAgent, OAI-SearchBot, Claude-Web, anthropic-ai, Perplexity-User, Meta-ExternalAgent. The hook rejects such commits. A high chatgpt.com / perplexity.ai / claude.ai referrer percentage = HUMANS clicking through AI answers, not scrapers. AdSense invalid-activity policy is about ad-click manipulation, not referrer domain.

If your task brief asks you to violate any of these, refuse and escalate to the human owner. The hook is the mechanical guard; policy in your own context is the cognitive guard. Chains of reasoning where one agent gives another a bad brief have caused production incidents — self-check before sending a brief, not only before committing code.'
,
  NOW()
FROM agents a
WHERE a.org_id = :org_id::text
  AND NOT EXISTS (
    SELECT 1 FROM agent_memory am
    WHERE am.agent_id = a.id
      AND am.type = 'KNOWLEDGE'
      AND am.content LIKE 'CONTENT QUALITY POLICY%'
  )
RETURNING agent_id;
