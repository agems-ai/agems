# Задача: модуль Repositories в AGEMS — Часть 1: Backend

## Среда разработки

Всё работает внутри Docker. Файл `docker-compose.override.yml` подменяет продакшн-образ API на dev-образ (`Dockerfile.dev`) с исходниками, dev-зависимостями и hot-reload. Исходный код монтируется с хоста — ты редактируешь файлы напрямую, изменения подхватываются автоматически.

**Перед началом работы убедись, что контейнеры запущены:**

```bash
docker compose up -d
```

Это поднимет postgres, redis и api в dev-режиме. Web и playwright-mcp убраны в profile `full` и не стартуют.

**Все команды выполняй через `docker compose exec api`:**

```bash
# Сборка / проверка типов
docker compose exec api pnpm build
docker compose exec api npx tsc --noEmit

# Prisma
docker compose exec api sh -c "cd /app/packages/db && npx prisma migrate dev --name <name>"
docker compose exec api pnpm db:generate

# Shell внутри контейнера (для отладки)
docker compose exec api sh
```

**НЕ запускай `pnpm`, `npx`, `node` напрямую на хосте** — на хосте нет node_modules, и нативные модули (bcrypt, prisma) всё равно собраны под Linux.

**Если изменились зависимости** (добавил пакет в package.json) — пересобери образ:

```bash
docker compose up -d --build api
```

Если после пересборки контейнер использует старые node_modules — пересоздай анонимные volume'ы:

```bash
docker compose up -d --build --force-recreate -V api
```

---

## Контекст проекта

AGEMS — платформа для управления AI-агентами. Монорепо на Turborepo + pnpm:

```
agems/
├── apps/
│   ├── api/          → NestJS 11 backend (порт 3001)
│   └── web/          → Next.js 15 frontend (порт 3000)
├── packages/
│   ├── ai/           → Vercel AI SDK, AgentRunner
│   ├── db/           → Prisma схема, миграции, PostgreSQL
│   └── shared/       → Общие типы
```

Ключевые файлы, которые нужно изучить перед началом работы:
- `packages/db/prisma/schema.prisma` — все модели. Обрати внимание на паттерны `Tool` / `AgentTool` и `Skill` / `AgentSkill` — новые модели должны следовать этим паттернам
- `apps/api/src/modules/tools/tools.service.ts` — CRUD-сервис с шифрованием authConfig. Это образец для repos.service.ts
- `apps/api/src/modules/tools/tools.controller.ts` — контроллер с Roles декораторами. Образец для repos.controller.ts
- `apps/api/src/modules/tools/tools.module.ts` — паттерн модуля
- `apps/api/src/modules/tasks/task-scheduler.service.ts` — планировщик с cron-matching. Образец для repo-sync.service.ts, используй тот же `cronMatches` / `fieldMatches` подход
- `apps/api/src/modules/agents/agents.service.ts` — метод `findOne()` с include-блоком. Сюда нужно добавить repositories
- `apps/api/src/modules/runtime/runtime.service.ts` — ядро. Методы `buildTools()`, `buildSystemPrompt()`, `getBuiltinToolNames()` — сюда добавляются repo-инструменты
- `apps/api/src/app.module.ts` — регистрация модулей
- `apps/api/src/common/crypto.util.ts` — `encryptJson` / `decryptJson` для шифрования credentials

## Цель

Агенты отвечают на вопросы о коде, обращаясь в GitLab API — это медленно и дорого по токенам. Нужен модуль, который:

1. Управляет локальными клонами Git-репозиториев (CRUD + git clone + git pull по расписанию)
2. Позволяет подключать репозитории к агентам (как подключаются Tools и Skills)
3. Даёт агентам встроенные инструменты для поиска и чтения кода в подключённых репо

Эта задача — только backend. Frontend будет реализован отдельно.

## Порядок реализации

Проверяй компиляцию после каждого шага: `docker compose exec api pnpm build` или `docker compose exec api npx tsc --noEmit`.

1. Prisma-схема + миграция
2. Backend модуль (service + controller + module)
3. Repo sync scheduler
4. Регистрация модуля в app.module.ts
5. Интеграция в agents.service.ts (include repositories)
6. Runtime-интеграция (инструменты агента + system prompt)

---

## Шаг 1. Prisma-схема

Добавь в `packages/db/prisma/schema.prisma` две модели. Следуй паттерну `Tool` / `AgentTool`:

```prisma
model Repository {
  id             String          @id @default(uuid())
  orgId          String          @map("org_id")
  org            Organization    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  name           String                          // Человекочитаемое имя, напр. "Backend API"
  slug           String                          // Уникальный slug, напр. "backend-api"
  gitUrl         String          @map("git_url") // URL для git clone (SSH или HTTPS)
  branch         String          @default("main")
  localPath      String?         @map("local_path")    // Заполняется после клонирования
  syncSchedule   String?         @map("sync_schedule") // Cron expression, напр. "0 8 * * 1"
  syncStatus     RepoSyncStatus  @default(PENDING) @map("sync_status")
  lastSyncAt     DateTime?       @map("last_sync_at")
  lastSyncError  String?         @map("last_sync_error")
  authType       RepoAuthType    @default(NONE) @map("auth_type")
  authConfig     Json?           @map("auth_config")   // Шифровать через encryptJson
  description    String?
  metadata       Json?
  agents         AgentRepository[]
  createdAt      DateTime        @default(now()) @map("created_at")
  updatedAt      DateTime        @updatedAt @map("updated_at")

  @@unique([orgId, slug])
  @@index([orgId])
  @@map("repositories")
}

model AgentRepository {
  id       String     @id @default(uuid())
  agentId  String     @map("agent_id")
  agent    Agent      @relation(fields: [agentId], references: [id], onDelete: Cascade)
  repoId   String     @map("repo_id")
  repo     Repository @relation(fields: [repoId], references: [id], onDelete: Cascade)
  enabled  Boolean    @default(true)

  @@unique([agentId, repoId])
  @@map("agent_repositories")
}

enum RepoSyncStatus {
  PENDING
  CLONING
  SYNCING
  SYNCED
  ERROR
}

enum RepoAuthType {
  NONE
  SSH_KEY
  TOKEN
  BASIC
}
```

Также добавь relations:
- В модель `Agent`: `repositories  AgentRepository[]`
- В модель `Organization`: `repositories Repository[]`

После изменений:
```bash
docker compose exec api pnpm db:generate
docker compose exec api sh -c "cd /app/packages/db && npx prisma migrate dev --name add_repositories"
```

---

## Шаг 2. Backend модуль

Создай директорию `apps/api/src/modules/repos/` с четырьмя файлами.

### repos.module.ts

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { ReposController } from './repos.controller';
import { ReposService } from './repos.service';
import { RepoSyncService } from './repo-sync.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [forwardRef(() => SettingsModule)],
  controllers: [ReposController],
  providers: [ReposService, RepoSyncService],
  exports: [ReposService],
})
export class ReposModule {}
```

### repos.service.ts

CRUD + git-операции. Изучи `tools.service.ts` для паттерна. Ключевые моменты:

**Конфигурация:**
- `REPOS_BASE_DIR` — читать из env `REPOS_BASE_DIR`, дефолт: `path.join(process.cwd(), 'data', 'repos')`. В dev-контейнере переменная задаётся через docker-compose: `REPOS_BASE_DIR=/app/data/repos` с persistent volume.
- `localPath` для каждого репо: `REPOS_BASE_DIR/<orgId>/<slug>`

**Шифрование authConfig:**
- Использовать `encryptJson` / `decryptJson` из `../../common/crypto.util` — точно как в tools.service.ts
- При сохранении: `authConfig: input.authConfig ? { _enc: encryptJson(input.authConfig) } : null`
- При чтении: не отдавать raw authConfig наружу, заменять на `{ configured: true }`

**Методы:**

```typescript
// CRUD
async create(input, userId, orgId)  // Создать запись + запустить cloneRepo в background
async findAll(orgId)                // Список репо организации (без authConfig)
async findOne(id, orgId)            // Одно репо (без authConfig)
async update(id, input, orgId)      // Обновить настройки
async delete(id, orgId)             // Удалить запись + rm -rf localPath

// Git operations
async cloneRepo(repoId)             // git clone → обновить syncStatus/localPath
async pullRepo(repoId)              // git pull → обновить lastSyncAt/syncStatus  
async syncRepo(id, orgId)           // Ручной trigger (для кнопки в UI и API)

// Agent assignments (паттерн из tools.service.ts — assignToolToAgent/removeToolFromAgent)
async assignToAgent(agentId, repoId, orgId)
async removeFromAgent(agentId, repoId, orgId)
```

**cloneRepo — логика:**
1. Обновить `syncStatus: 'CLONING'`
2. Создать директорию `localPath` рекурсивно если не существует
3. Собрать git-команду с учётом authType:
   - `NONE`: `git clone --branch <branch> --single-branch <url> <path>`
   - `SSH_KEY`: записать key во временный файл (mode 0o600), `GIT_SSH_COMMAND="ssh -i /tmp/key_<id> -o StrictHostKeyChecking=no" git clone ...`, удалить temp file после
   - `TOKEN`: `git clone https://oauth2:<token>@<host>/<path>.git` (заменить протокол в gitUrl)
   - `BASIC`: `git clone https://<user>:<pass>@<host>/<path>.git`
4. Выполнить через `execSync` с `timeout: 120_000` (2 минуты)
5. Обновить `syncStatus: 'SYNCED'`, `lastSyncAt: new Date()`, `lastSyncError: null`
6. При ошибке: `syncStatus: 'ERROR'`, `lastSyncError: error.message.substring(0, 500)`

**pullRepo — логика:**
1. Обновить `syncStatus: 'SYNCING'`
2. `execSync('git pull', { cwd: localPath, timeout: 30_000 })`
3. Обновить `syncStatus: 'SYNCED'`, `lastSyncAt`, очистить `lastSyncError`
4. При ошибке: `syncStatus: 'ERROR'`, `lastSyncError`

**delete — логика:**
1. Получить репо, проверить orgId
2. Удалить из БД (каскад удалит AgentRepository)
3. Если `localPath` существует — `rmSync(localPath, { recursive: true, force: true })`

**Security:**
- Валидируй что `localPath` всегда начинается с `REPOS_BASE_DIR`
- Slug: только `[a-z0-9-]`, без `..`

### repos.controller.ts

По образцу `tools.controller.ts`:

```typescript
@Controller()
export class ReposController {
  constructor(private reposService: ReposService) {}

  @Post('repos')         @Roles('MANAGER')
  create(@Body() body: any, @Request() req: { user: RequestUser }) {
    return this.reposService.create(body, req.user.id, req.user.orgId);
  }

  @Get('repos')
  findAll(@Request() req: { user: RequestUser }) {
    return this.reposService.findAll(req.user.orgId);
  }

  @Get('repos/:id')
  findOne(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.reposService.findOne(id, req.user.orgId);
  }

  @Patch('repos/:id')    @Roles('MANAGER')
  update(@Param('id') id: string, @Body() body: any, @Request() req: { user: RequestUser }) {
    return this.reposService.update(id, body, req.user.orgId);
  }

  @Delete('repos/:id')   @Roles('ADMIN')
  delete(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.reposService.delete(id, req.user.orgId);
  }

  @Post('repos/:id/sync') @Roles('MANAGER')
  sync(@Param('id') id: string, @Request() req: { user: RequestUser }) {
    return this.reposService.syncRepo(id, req.user.orgId);
  }

  @Post('agents/:agentId/repos')  @Roles('MANAGER')
  assignToAgent(@Param('agentId') agentId: string, @Body() body: { repoId: string }, @Request() req: { user: RequestUser }) {
    return this.reposService.assignToAgent(agentId, body.repoId, req.user.orgId);
  }

  @Delete('agents/:agentId/repos/:repoId')  @Roles('MANAGER')
  removeFromAgent(@Param('agentId') agentId: string, @Param('repoId') repoId: string, @Request() req: { user: RequestUser }) {
    return this.reposService.removeFromAgent(agentId, repoId, req.user.orgId);
  }
}
```

Не забудь импорты: `Controller, Get, Post, Patch, Delete, Param, Body, Request` из `@nestjs/common`, `Roles` из `../../common/decorators/roles.decorator`, `RequestUser` из `../../common/types`.

---

## Шаг 3. Repo sync scheduler

Создай `apps/api/src/modules/repos/repo-sync.service.ts`.

Упрощённый вариант `task-scheduler.service.ts`. Изучи его для паттерна cron-matching (`cronMatches`, `fieldMatches`).

```typescript
@Injectable()
export class RepoSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RepoSyncService.name);
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private prisma: PrismaService,
    private reposService: ReposService,
  ) {}

  async onModuleInit() {
    this.intervalId = setInterval(() => this.tick(), 60_000);
    // При старте: клонировать все PENDING репо
    setTimeout(() => this.clonePendingRepos(), 5_000);
    this.logger.log('Repo sync scheduler started');
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async tick() {
    try {
      await this.checkSyncSchedule();
    } catch (err) {
      this.logger.error(`Repo sync tick error: ${err}`);
    }
  }

  private async clonePendingRepos() {
    // Найти все репо с syncStatus = PENDING, localPath = null
    // Для каждого вызвать reposService.cloneRepo(repo.id)
    // Запускать последовательно (не параллельно) чтобы не перегрузить диск
  }

  private async checkSyncSchedule() {
    // Найти репо с syncSchedule != null И syncStatus = SYNCED
    // Для каждого: если cronMatches(syncSchedule, new Date()) → reposService.pullRepo(repo.id)
  }

  // Скопировать cronMatches и fieldMatches из task-scheduler.service.ts
  private cronMatches(expression: string, date: Date): boolean { ... }
  private fieldMatches(expr: string, value: number, min: number, max: number): boolean { ... }
}
```

---

## Шаг 4. Регистрация модуля

В `apps/api/src/app.module.ts`:

1. Добавь импорт: `import { ReposModule } from './modules/repos/repos.module';`
2. Добавь `ReposModule` в массив `imports`

---

## Шаг 5. Интеграция в agents.service.ts

В файле `apps/api/src/modules/agents/agents.service.ts`, метод `findOne()`, добавь в include-блок:

```typescript
include: {
  owner: { select: { id: true, name: true, email: true } },
  positions: { select: { title: true }, take: 1 },
  skills: { include: { skill: true } },
  tools: { include: { tool: true } },
  repositories: { include: { repo: true } },  // ← ДОБАВИТЬ
  responsibilities: true,
  parentAgent: { select: { id: true, name: true, slug: true } },
  childAgents: { select: { id: true, name: true, slug: true, status: true } },
  _count: { select: { memory: true, executions: true, metrics: true } },
}
```

---

## Шаг 6. Runtime-интеграция

В `apps/api/src/modules/runtime/runtime.service.ts` нужно сделать три вещи.

### 6.1. Инструменты агента — в buildTools()

В методе `buildTools()` (после секции `// ── Memory tools ──`) добавь блок с repo-инструментами. Инструменты создаются только если у агента есть подключённые синхронизированные репо:

```typescript
// ── Repository code search tools ──
{
  const agentRepos = (agent.repositories || [])
    .filter((ar: any) => ar.enabled && ar.repo?.localPath && ar.repo?.syncStatus === 'SYNCED');
  
  if (agentRepos.length > 0) {
    const repoMap = new Map(agentRepos.map((ar: any) => [ar.repo.slug, ar.repo.localPath]));
    const repoNames = Array.from(repoMap.keys());
```

**5 инструментов внутри этого блока:**

**repo_list** — без параметров, возвращает список доступных репо.

**repo_search** — параметры: `repo` (string), `query` (string), `filePattern` (string, optional, default `"*"`), `caseSensitive` (bool, optional, default false). Реализация через `execSync` с `grep`. Ключевые моменты:
- Флаги: `-rn`, `--include=<filePattern>`, `-C 3` (контекст), `-i` если не caseSensitive
- Исключения: `--exclude-dir=node_modules`, `--exclude-dir=dist`, `--exclude-dir=build`, `--exclude-dir=.git`, `--exclude-dir=__pycache__`, `--exclude-dir=.next`, `--exclude=*.lock`, `--exclude=*.min.js`, `--exclude=*.min.css`, `--exclude=*.map`
- `cwd: repoPath`, `timeout: 10_000`, `maxBuffer: 512 * 1024`, `shell: true`
- Обрезать вывод до 100 строк
- grep exit code 1 = нет совпадений (не ошибка)

**repo_read_file** — параметры: `repo` (string), `path` (string), `startLine` (number, optional, default 1), `endLine` (number, optional, default 300). Реализация через `readFileSync`. Security: проверить через `path.resolve` что итоговый путь начинается с repoPath. Лимит: 1MB, 300 строк за раз. Формат: пронумерованные строки + общее количество строк.

**repo_structure** — параметры: `repo` (string), `path` (string, optional, default "."), `depth` (number, optional, default 3, max 5). Реализация через `find` с исключениями + `head -500 | sort`.

**repo_find_definition** — параметры: `repo` (string), `name` (string), `filePattern` (string, optional). Regex-поиск: `(class|interface|type|enum|function|const|let|var|export|def|struct)\s+<n>\b`. Через `grep -rn -E -C 5`. Лимит 50 строк.

**Для каждого инструмента:** валидировать `repo` через `repoMap.get(params.repo)`, при отсутствии — вернуть ошибку со списком доступных.

### 6.2. System prompt — в buildSystemPrompt()

В методе `buildSystemPrompt()`, после блока с `skillsContext`, добавь:

```typescript
let reposContext = '';
const agentRepos = (agent.repositories || [])
  .filter((ar: any) => ar.enabled && ar.repo?.syncStatus === 'SYNCED');
if (agentRepos.length > 0) {
  const repoList = agentRepos.map((ar: any) => {
    const r = ar.repo;
    return `- ${r.slug}: ${r.name}${r.description ? ' — ' + r.description : ''} (branch: ${r.branch})`;
  }).join('\n');
  reposContext = `=== CONNECTED REPOSITORIES ===\nYou have access to these code repositories via repo_search, repo_read_file, repo_structure, and repo_find_definition tools:\n${repoList}\nAlways specify the repo slug when searching. Search in specific repos, not all at once.\n=== END REPOSITORIES ===\n\n`;
}
```

Добавь `reposContext` в return строку между `skillsContext` и `memoryContext`.

**Важно:** `buildSystemPrompt` принимает `agent` из `execute()`, который загружается через `agentsService.findOne()` — после шага 5 repositories уже включены в agent.

### 6.3. Built-in tool names — в getBuiltinToolNames()

В методе `getBuiltinToolNames()`, в include-блоке запроса agent, добавь `repositories: { include: { repo: true } }`.

Затем после блока memory tools добавь:

```typescript
const agentRepos = (agent as any).repositories?.filter((ar: any) => ar.enabled && ar.repo) || [];
if (agentRepos.length > 0) {
  add('repo_list', 'List available repositories', 'Repositories');
  add('repo_search', 'Search code in repositories', 'Repositories');
  add('repo_read_file', 'Read file from repository', 'Repositories');
  add('repo_structure', 'List repository file tree', 'Repositories');
  add('repo_find_definition', 'Find code definitions', 'Repositories');
}
```

---

## Проверка

После реализации:
1. `docker compose exec api sh -c "cd /app/packages/db && npx prisma migrate dev"` — миграция проходит
2. `docker compose exec api pnpm build` — всё компилируется без ошибок
3. API уже работает в dev-режиме внутри контейнера (hot-reload подхватил изменения)
4. API-тест через curl (на localhost:3001):
   - `POST /repos` — создать репо → статус PENDING → через несколько секунд SYNCED
   - `GET /repos` — список с syncStatus
   - `POST /repos/:id/sync` — ручная синхронизация
   - `POST /agents/:id/repos` — подключить репо к агенту
   - Проверить что агент при обращении видит repo_search и остальные инструменты

## Что НЕ нужно

- НЕ трогай frontend — он будет реализован отдельной задачей
- НЕ добавляй git log, git diff, git blame — только clone и pull
- НЕ добавляй write-операции с файлами в репо — только чтение
- НЕ добавляй тесты
- НЕ создавай отдельный пакет — всё в `apps/api/src/modules/repos/`
- НЕ меняй AgentRunner или MCP-транспорт
- НЕ меняй docker-compose.yml, docker-compose.override.yml, Dockerfile или Dockerfile.dev
