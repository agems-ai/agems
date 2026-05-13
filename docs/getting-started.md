# Getting started with AGEMS

This guide takes you from a fresh checkout to a working agent that responds in a channel and uses a tool. About 15 minutes if you have Docker; 25 minutes from scratch.

## What you'll build

By the end of this guide:

1. AGEMS is running on your machine (api on `:3001`, web on `:3000`).
2. You have an organization and admin account.
3. You created a "Demo Assistant" agent with a system prompt.
4. You opened a channel, added the agent, and got a reply.
5. You attached a built-in tool (`agems_tasks`) and the agent created a task on its own.

## Prerequisites

- Node 20+ and `pnpm` (`npm i -g pnpm`)
- Docker Desktop or Docker Engine + Compose v2
- One LLM API key (OpenAI, Anthropic, Google, or Ollama if you want to run a local model). The cheapest cloud option to start is `gpt-4o-mini` or `claude-3-5-haiku`. See [Ollama setup](./ollama-setup.md) if you want zero API spend.

## 1. Clone and install

```bash
git clone https://github.com/agems-ai/agems.git
cd agems
pnpm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in at minimum:

```bash
DATABASE_URL=postgresql://agems:agems@localhost:5432/agems?schema=public
REDIS_URL=redis://localhost:6379
JWT_SECRET=$(openssl rand -hex 32)        # any 32+ char random string
ANTHROPIC_API_KEY=sk-ant-...              # OR set OPENAI_API_KEY=sk-... etc.
WEB_URL=http://localhost:3000
```

> **Heads-up:** AGEMS reads provider keys both from environment variables (used for bootstrap and platform-level features) and from per-org settings stored in the DB (used by individual agents). You can leave the env vars blank during a UI-only setup, but it's easier to set at least one cloud key here so the platform's own bootstrap agent has something to call.

## 3. Bring up the database

The shipped `docker-compose.yml` includes Postgres + Redis with healthchecks. Run only those two services first:

```bash
docker compose up -d postgres redis
```

Wait until both report `healthy`:

```bash
docker compose ps
```

Then push the schema and generate the Prisma client:

```bash
pnpm db:generate
pnpm db:push
```

## 4. Run AGEMS in development mode

```bash
pnpm dev
```

This launches the API (`:3001`) and the web frontend (`:3000`) together via Turborepo. Watch the api logs — you should see `Bootstrap: meta agent ready` on first run.

Verify the API is reachable:

```bash
curl -s http://localhost:3001/api/health | jq
# {"status":"ok","timestamp":"...","checks":{"database":"ok","redis":"ok"}}
```

If that shows `degraded`, the api is up but Postgres or Redis isn't — fix the connection and reload.

## 5. Create your account and organization

Open `http://localhost:3000` in a browser. Sign up with any email + password (no SMTP needed locally — confirmation links are skipped in dev). The first user you create becomes the organization owner.

Once you're in, you'll see the dashboard and an empty agent list.

## 6. Add your LLM key in the UI

Navigate to **Settings → LLM Keys**. Pick a provider, paste the key, save. AGEMS stores it encrypted at rest and uses it whenever an agent of that provider runs. You can add multiple providers.

If you set `ANTHROPIC_API_KEY` in `.env` it's already loaded for the platform's own use, but agents read from the per-org settings — paste it there too so your demo agent can see it.

## 7. Create your first agent

Go to **Agents → New agent**.

| Field | Value |
|---|---|
| Name | `Demo Assistant` |
| Provider | whichever you keyed (e.g. `Anthropic`) |
| Model | a small model — `claude-3-5-haiku-latest` or `gpt-4o-mini` |
| System prompt | "You are a helpful assistant. Be concise. If the user asks for a task, use the `agems_tasks` tool to create it instead of just describing it." |

Save. The agent now exists with status `ACTIVE`.

## 8. Open a channel and chat

**Comms → New channel** → type `GROUP`, name `demo`. Add yourself + your `Demo Assistant` agent as participants.

Type a message:

> Hey, can you summarise what AGEMS does in one sentence?

Within a few seconds the agent's reply appears. If nothing happens, check the API logs (`docker compose logs -f api`) for an error — common causes are an empty LLM key for the org or the wrong model name.

## 9. Give the agent a tool

Right now your agent can talk but can't act. Let's connect a built-in tool.

Go to **Tools → Built-in** (or your agent's edit page → Tools tab) and attach `agems_tasks` to the Demo Assistant. Save.

Back in the `demo` channel, ask:

> Please create a task for me: "Read the AGEMS getting-started guide" and set the priority to LOW.

The agent should respond with confirmation that the task was created. Verify in **Tasks** — a new task appears, attributed to the agent and assigned to you.

If the agent answered without calling the tool, edit its system prompt to be more explicit ("Always use the `agems_tasks` tool when the user asks for a task — never describe it in text"). Smaller models often need a nudge.

## 10. Where to go next

- **Examples in this repo**: under `docs/` and `examples/` (when populated) — patterns for common agent recipes.
- **[Ollama setup](./ollama-setup.md)** — run agents on local models, no API spend.
- **Tool system**: see CLAUDE.md → "Tool System" for how to wire REST API tools (any HTTP endpoint with auth) and MCP servers.
- **Approvals (HITL)**: agents can be set to `SUPERVISED`, `GUIDED`, or `AUTOPILOT`. See `apps/api/src/modules/approvals/`.
- **Tasks and scheduling**: `TaskSchedulerService` runs cron-style recurring agent work. See `apps/api/src/modules/tasks/`.
- **Multi-agent meetings**: agents can hold structured meetings with voting and decisions. See `apps/api/src/modules/meetings/`.

## Common stumbles

| Symptom | Cause | Fix |
|---|---|---|
| `pnpm db:push` errors with "permission denied" | Postgres not healthy yet | `docker compose ps` and wait, or `docker compose logs postgres` |
| `/api/health` returns 503 with `redis: error` | Redis container not started | `docker compose up -d redis` |
| Agent never replies | No LLM key for that provider in org settings | Re-add in **Settings → LLM Keys** for the org you're in (not just `.env`) |
| Agent replies in plain text instead of using a tool | System prompt too vague, or model too small | Be explicit in the prompt; switch to a larger model |
| `Cannot reach ANTHROPIC` in logs | Network or wrong base URL | Test the key directly: `curl -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" https://api.anthropic.com/v1/messages` |

## You're now ready to build

The platform's three primitives are **agents**, **channels**, and **tools**. Everything else (tasks, meetings, approvals, schedules) composes from those. Start small: one agent, one channel, one or two tools, see how it behaves, then add complexity.

Star the repo if AGEMS is useful — it helps us grow.
