# AGEMS — Agent Management System

AI agent management platform. Agents communicate, execute tasks, participate in meetings, and work with tools — all through a unified interface.

## Stack

- **Monorepo**: Turborepo + pnpm
- **API**: NestJS (apps/api), port 3001
- **Web**: Next.js 15 + Tailwind v4 (apps/web), port 3000
- **DB**: PostgreSQL + Prisma (packages/db)
- **AI**: Vercel AI SDK v4 (packages/ai) — OpenAI, Anthropic, Google, DeepSeek, Mistral, Ollama
- **Shared**: packages/shared — types and schemas

## Project Structure

```
apps/
  api/src/modules/          # NestJS modules
    agents/                  # Agent registry (CRUD, LLM config)
    approvals/               # HITL — action approval requests
    auth/                    # JWT auth (passport-jwt)
    bootstrap/               # Seed data (meta agent)
    comms/                   # Channels, messages, WebSocket (socket.io)
    dashboard/               # Dashboard widgets & system stats
    meetings/                # Agent meetings
    n8n/                     # N8N workflow integration
    org/                     # Org structure (positions, departments)
    runtime/                 # Core: agent execution, tool dispatch, conversation context
    security/                # Audit logging, access rules
    settings/                # Key-value platform settings
    tasks/                   # Tasks + TaskScheduler (cron)
    telegram/                # Telegram bot integration
    tools/                   # REST API / MCP / DB tools for agents

  web/src/app/(dashboard)/   # Next.js pages
    agents/                  # Agent cards, editor
    approvals/               # Approval queue
    comms/                   # Chat (channels, messages)
    company/                 # Company profile
    dashboard/               # Main dashboard — widgets
    employees/               # Team members
    files/                   # File management
    meetings/                # Meetings
    n8n/                     # N8N integration
    security/                # Audit log
    settings/                # Settings (LLM keys, platform, task agents, n8n)
    skills/                  # Agent skills
    tasks/                   # Task board
    tools/                   # Tools registry

packages/
  ai/src/                    # AgentRunner — wrapper over Vercel AI SDK generateText()
    runner.ts                # Main runner: tools, loop detection, thinking
    provider.ts              # AI provider factory from config
    types.ts                 # ToolDefinition, UserMessage, MessagePart
  db/prisma/
    schema.prisma            # All models
  shared/                    # Shared types and schemas
```

## Key Models (Prisma)

- **Agent** — LLM provider/model, systemPrompt, tools, skills, memory, status
- **Channel/Message** — chat channels (DIRECT/GROUP/BROADCAST), messages (TEXT/JSON/FILE/ACTION)
- **Task/TaskComment** — tasks (ONE_TIME/RECURRING/CONTINUOUS), statuses, comments
- **Meeting** — meetings with participants, entries, decisions, voting
- **Tool** — REST_API, MCP_SERVER, DATABASE and other tool integrations
- **ApprovalPolicy/ApprovalRequest** — HITL system (SUPERVISED/GUIDED/AUTOPILOT)
- **AgentExecution** — execution log: input, output, tool calls, tokens, cost
- **Setting** — key-value store for platform configuration

## Getting Started

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your database URL and API keys

# Set up database
pnpm db:generate
pnpm db:push

# Run everything
pnpm dev

# Or run individually:
cd apps/api && pnpm dev     # NestJS API (port 3001)
cd apps/web && pnpm dev     # Next.js frontend (port 3000)
cd packages/db && pnpm studio   # Prisma Studio
```

## Runtime Architecture

1. Message in channel → `CommsService` → event `message.created`
2. `RuntimeService.handleChannelMessage()` → finds agent participant
3. Builds context: chat history → `UserMessage[]` (multimodal support)
4. `AgentRunner.run()` — generateText() loop with tools up to maxIterations
5. Tool loop detector (sliding window + hash dedup) prevents infinite loops
6. Result → message in channel + execution log

## Tool System

Agents receive tools via `AgentTool` associations:
- **Built-in tools**: agems_tasks, agems_manage_agents, agems_manage_skills, etc.
- **REST API tools**: arbitrary HTTP calls (with auth: API_KEY, BEARER, BASIC, OAUTH2)
- **MCP Server tools**: connect to MCP servers
- **Database tools**: direct SQL queries

Each tool has an `approvalMode`: FREE / REQUIRES_APPROVAL / BLOCKED.

## Task System

- `TaskSchedulerService` — cron with configurable interval (Setting: `task_scheduler_interval`)
- Enable/disable via Setting: `task_agents_enabled`
- When a task is created for an agent → event `task.created` → auto-start after 2s
- RECURRING tasks with cronExpression → auto-reset COMPLETED → PENDING on schedule
- Agent receives a prompt with instructions, reports progress via comments

## Conventions

- **API prefix**: `/api/` (NestJS global prefix)
- **Auth**: JWT Bearer token, roles: ADMIN, MANAGER, MEMBER, VIEWER
- **Frontend state**: React useState + fetch to API, no Redux/Zustand
- **CSS**: Tailwind v4 + CSS variables (--bg, --card, --border, --accent, --muted, --hover)
- **Modal dialogs**: `modalMode` state machine ('view' | 'edit' | 'create' | null)
- **Events**: NestJS EventEmitter2 for cross-module communication
- **Prisma**: snake_case in DB (@@map), camelCase in code
- **Language**: All code, comments, and documentation in English
