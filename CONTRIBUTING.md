# Contributing to AGEMS

Thank you for your interest in contributing to AGEMS. Whether you are fixing a bug, improving documentation, or proposing a new feature, your contributions are welcome and appreciated.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Finding Issues to Work On](#finding-issues-to-work-on)
- [Community](#community)

## Development Setup

### Prerequisites

- Node.js >= 20
- pnpm 10.x (`corepack enable && corepack prepare pnpm@10.30.3 --activate`)
- Docker and Docker Compose (for PostgreSQL and other services)

### Getting Started

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/agems.git
cd agems

# 2. Install dependencies
pnpm install

# 3. Copy the example environment file and configure it
cp .env.example .env

# 4. Start infrastructure services
docker compose up -d

# 5. Set up the database
pnpm db:generate
pnpm db:push

# 6. Start the development servers
pnpm dev
```

## Project Structure

AGEMS is a monorepo managed with pnpm workspaces and Turborepo.

```
agems/
  apps/
    api/          # NestJS 11 -- REST + WebSocket API server
    web/          # Next.js 15 -- Dashboard and admin UI
  packages/
    ai/           # AI runner -- agent execution engine
    db/           # Prisma schema + client (PostgreSQL)
```

| Path | Description |
|---|---|
| `apps/api` | Backend API built with NestJS 11. Handles auth, agents, and integrations. |
| `apps/web` | Frontend application built with Next.js 15 (App Router). |
| `packages/ai` | Core AI runner that orchestrates agent execution. |
| `packages/db` | Shared Prisma client and schema for PostgreSQL. |

## Making Changes

1. **Fork** the repository and create a new branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes in the appropriate package or app.
3. Run linting and tests before committing:
   ```bash
   pnpm lint
   pnpm test
   ```
4. Commit your changes following the conventions below.

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

**Scopes:** `api`, `web`, `ai`, `db`, or omit for cross-cutting changes.

Examples:

```
feat(api): add webhook retry logic
fix(web): correct sidebar navigation on mobile
docs: update contributing guide
chore(db): add migration for agent sessions
```

## Pull Request Process

1. Push your branch to your fork.
2. Open a pull request against `main` on the upstream repository.
3. Fill in the PR template with:
   - A short summary of the change.
   - Motivation or linked issue (e.g., `Closes #42`).
   - Steps to test.
4. Ensure all CI checks pass.
5. A maintainer will review your PR. Please respond to feedback promptly.

Keep pull requests focused -- one logical change per PR. Large changes should be broken into smaller, reviewable pieces.

## Code Style

- **Language:** TypeScript throughout the entire codebase.
- **Formatting:** Prettier handles all formatting. Run `pnpm lint` to check.
- **Linting:** ESLint is configured per package. Fix issues before submitting.
- **General guidelines:**
  - Prefer named exports over default exports.
  - Write clear, descriptive variable and function names.
  - Add JSDoc comments for public APIs and non-obvious logic.
  - Keep files focused on a single responsibility.

## Finding Issues to Work On

Look for issues labeled [`good first issue`](../../labels/good%20first%20issue) for beginner-friendly tasks, or [`help wanted`](../../labels/help%20wanted) for items where maintainers are actively seeking contributions.

If you want to work on something not yet tracked, open an issue first to discuss the approach before investing time in implementation.

## Community

- **GitHub Discussions:** Ask questions, share ideas, and discuss features in the [Discussions](../../discussions) tab.
- **Discord:** Join our Discord server (link coming soon) for real-time conversation with contributors and maintainers.

## License

By contributing to AGEMS, you agree that your contributions will be licensed under the [Sustainable Use License](./LICENSE).
