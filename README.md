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

- Node.js >= 20
- PostgreSQL 16+ (with pgvector extension)
- Redis 7+
- pnpm 10+

### Installation

```bash
# Clone the repository
git clone https://github.com/agems-ai/agems.git
cd agems

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL and API keys

# Set up database
pnpm db:generate
pnpm db:push

# Start development servers
pnpm dev
```

The API will be available at `http://localhost:3001` and the web interface at `http://localhost:3000`.

### Docker

```bash
cp .env.example .env
# Edit .env — add at least one AI provider key (ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_AI_API_KEY)

docker compose up -d
```

Database migrations run automatically on first startup. This starts PostgreSQL, Redis, the API server, and the web frontend.

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
| `ANTHROPIC_API_KEY` | Anthropic API key | No |
| `OPENAI_API_KEY` | OpenAI API key | No |
| `GOOGLE_AI_API_KEY` | Google AI API key | No |
| `API_PORT` | API server port (default: 3001) | No |
| `WEB_PORT` | Web server port (default: 3000) | No |

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
