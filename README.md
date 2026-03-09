<p align="center">
  <h1 align="center">AGEMS</h1>
  <p align="center"><strong>Agent Management System</strong></p>
  <p align="center">The operating system for AI-native businesses</p>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#documentation">Docs</a> &bull;
  <a href="#license">License</a>
</p>

---

AGEMS is an open-source platform for creating, managing, and orchestrating AI agents. Agents communicate through channels, execute tasks, use tools, participate in meetings, and collaborate with humans — all through a unified interface.

## Features

- **AI Agent Registry** — Create agents with any LLM provider (OpenAI, Anthropic, Google, DeepSeek, Mistral, Ollama)
- **Real-time Communication** — Direct and group channels with WebSocket-powered messaging
- **Task Management** — One-time, recurring, and continuous tasks with automatic agent execution
- **Tool Integration** — REST APIs, databases, MCP servers, N8N workflows, SSH, and more
- **Human-in-the-Loop** — Configurable approval policies from full autopilot to supervised mode
- **Agent Meetings** — Multi-agent meetings with agendas, decisions, and voting
- **Skills System** — Reusable skills assigned to agents, loaded on demand
- **Multi-Tenant** — Organization-scoped data with role-based access control (ADMIN, MANAGER, MEMBER, VIEWER)
- **Telegram Integration** — Connect agents to Telegram bots for external communication
- **Dashboard Widgets** — Customizable dashboard with SQL queries, REST API calls, and platform stats
- **Audit Logging** — Full audit trail for security and compliance
- **N8N Integration** — Manage and execute N8N automation workflows

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 10
- [Docker](https://www.docker.com/) (for PostgreSQL and Redis)

### Option 1: Local Development (recommended)

This runs PostgreSQL and Redis in Docker, and the app locally for hot-reload.

```bash
# 1. Clone and install
git clone https://github.com/agems-ai/agems.git
cd agems
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env — add at least one AI provider API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_AI_API_KEY)

# 3. Start PostgreSQL and Redis
docker compose up -d postgres redis

# 4. Set up database
pnpm db:generate
pnpm db:push

# 5. Start development servers
pnpm dev
```

Open http://localhost:3000 — register a new account and start building agents.

> **Note:** `pnpm db:generate` creates the Prisma client. You only need to run it once (or after changing the schema).

### Option 2: Full Docker

Runs everything in containers — no Node.js required on the host.

```bash
git clone https://github.com/agems-ai/agems.git
cd agems
cp .env.example .env
# Edit .env — add at least one AI provider API key

docker compose up -d
```

This starts PostgreSQL, Redis, the API server (port 3001), and the web frontend (port 3000).

Open http://localhost:3000 to get started.

## Architecture

```
agems/
├── apps/
│   ├── api/          # NestJS backend (port 3001)
│   └── web/          # Next.js frontend (port 3000)
├── packages/
│   ├── ai/           # AI SDK integration (multi-provider)
│   ├── db/           # Prisma schema & migrations
│   └── shared/       # Shared types & schemas
├── docker-compose.yml
└── turbo.json
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | NestJS 11, Prisma ORM, PostgreSQL |
| Frontend | Next.js 15, React 19, Tailwind CSS 4 |
| AI | Vercel AI SDK (OpenAI, Anthropic, Google, DeepSeek, Mistral, Ollama) |
| Real-time | Socket.io |
| Queue | BullMQ + Redis |
| Auth | JWT + Passport with RBAC |
| Monorepo | Turborepo + pnpm |

### Runtime Flow

1. Message arrives in a channel
2. `RuntimeService` identifies agent participants
3. Conversation context is built (multimodal support)
4. `AgentRunner` executes AI generation with tools in a loop
5. Tool loop detection prevents infinite cycles
6. Results are posted back to the channel with execution logging

## Documentation

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation, conventions, and development guidelines.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `JWT_SECRET` | Secret for JWT signing | Yes |
| `ANTHROPIC_API_KEY` | Anthropic API key | At least one* |
| `OPENAI_API_KEY` | OpenAI API key | At least one* |
| `GOOGLE_AI_API_KEY` | Google AI API key | At least one* |
| `API_PORT` | API server port (default: 3001) | No |
| `WEB_PORT` | Web server port (default: 3000) | No |

\* At least one AI provider API key is required for agents to work.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

AGEMS is [fair-code](https://faircode.io) distributed under the [**Sustainable Use License**](LICENSE).

- **Free** to use for your own business
- **Free** to self-host and modify
- **Not allowed** to offer as a competing managed service (SaaS) without permission

Enterprise licensing available — contact us for details.
