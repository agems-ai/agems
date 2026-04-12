# Задача: модуль Repositories в AGEMS — Часть 2: Frontend

## Среда разработки

Всё работает внутри Docker. Файл `docker-compose.override.yml` подменяет продакшн-образ API на dev-образ (`Dockerfile.dev`) с исходниками, dev-зависимостями и hot-reload. Исходный код монтируется с хоста — ты редактируешь файлы напрямую, изменения подхватываются автоматически.

**Перед началом работы убедись, что контейнеры запущены:**

```bash
docker compose up -d
```

Это поднимет postgres, redis и api в dev-режиме. В dev-контейнере есть все зависимости монорепо, включая web.

**Все команды выполняй через `docker compose exec api`:**

```bash
# Сборка / проверка типов (вся монорепа, включая web)
docker compose exec api pnpm build

# Shell внутри контейнера (для отладки)
docker compose exec api sh
```

**НЕ запускай `pnpm`, `npx`, `node` напрямую на хосте** — на хосте нет node_modules.

## Контекст

Это продолжение задачи по добавлению модуля Repositories в AGEMS. Backend уже реализован (часть 1) и включает:

- Prisma-модели `Repository` и `AgentRepository` в `packages/db/prisma/schema.prisma`
- Backend модуль `apps/api/src/modules/repos/` с CRUD, git clone/pull, sync scheduler
- API endpoints:
  - `POST /repos` — создать репозиторий
  - `GET /repos` — список репозиториев
  - `GET /repos/:id` — один репозиторий
  - `PATCH /repos/:id` — обновить
  - `DELETE /repos/:id` — удалить
  - `POST /repos/:id/sync` — ручная синхронизация
  - `POST /agents/:agentId/repos` — подключить репо к агенту (body: `{ repoId }`)
  - `DELETE /agents/:agentId/repos/:repoId` — отключить репо от агента
- Runtime-инструменты для агентов: `repo_search`, `repo_read_file`, `repo_structure`, `repo_find_definition`, `repo_list`
- В `agents.service.ts` метод `findOne()` уже включает `repositories: { include: { repo: true } }` — агент возвращается с подключёнными репо

Теперь нужен frontend.

## Ключевые файлы для изучения

Перед началом работы изучи эти файлы — они являются образцами для реализации:

- `apps/web/src/lib/api.ts` — API client. Изучи паттерн методов для Tools и Skills (строки ~270-320). Новые методы для repos должны следовать этому же паттерну
- `apps/web/src/app/(dashboard)/tools/page.tsx` — страница Tools (~494 строк). Образец для страницы `/repos`: layout, модальные окна, CRUD-формы, стили
- `apps/web/src/app/(dashboard)/skills/page.tsx` — страница Skills (~613 строк). Альтернативный образец
- `apps/web/src/app/(dashboard)/agents/[id]/page.tsx` — страница агента. Изучи:
  - Секцию "Skills" (примерно строки 529-561) — образец для секции "Repositories"
  - Skill Picker модалку (примерно строки 897-929) — образец для Repo Picker
  - Секцию "Tools" (примерно строки 480-527) — альтернативный образец
- `apps/web/src/app/(dashboard)/layout.tsx` — навигация, куда добавить ссылку на /repos

## Порядок реализации

1. API client — добавить методы
2. Страница /repos
3. Интеграция в страницу агента (секция + picker)
4. Навигация

---

## Шаг 1. API client

В `apps/web/src/lib/api.ts` добавь методы по образцу Tools/Skills:

```typescript
// Repositories
getRepos() {
  return this.fetch<any>('/repos');
},
createRepo(data: any) {
  return this.fetch('/repos', { method: 'POST', body: JSON.stringify(data) });
},
getRepo(id: string) {
  return this.fetch<any>(`/repos/${id}`);
},
updateRepo(id: string, data: any) {
  return this.fetch(`/repos/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
},
deleteRepo(id: string) {
  return this.fetch(`/repos/${id}`, { method: 'DELETE' });
},
syncRepo(id: string) {
  return this.fetch<any>(`/repos/${id}/sync`, { method: 'POST' });
},
assignRepoToAgent(agentId: string, repoId: string) {
  return this.fetch(`/agents/${agentId}/repos`, { method: 'POST', body: JSON.stringify({ repoId }) });
},
removeRepoFromAgent(agentId: string, repoId: string) {
  return this.fetch(`/agents/${agentId}/repos/${repoId}`, { method: 'DELETE' });
},
```

---

## Шаг 2. Страница /repos

Создай `apps/web/src/app/(dashboard)/repos/page.tsx`.

Используй `tools/page.tsx` как образец для структуры, стилей и паттернов. Следуй тем же CSS-переменным и Tailwind-классам.

### Структура страницы

```
'use client';
Заголовок "Repositories" + кнопка "+ Add Repository"
  ↓
Таблица / список карточек репозиториев
  Каждая строка: Name | Git URL | Branch | Sync Status | Last Sync | Actions
  ↓
Модальное окно создания/редактирования
```

### Список репозиториев

Для каждого репо показать:
- **Name** — жирный текст
- **Git URL** — моноширинный, серый текст, truncated
- **Branch** — бейдж
- **Sync Status** — цветной бейдж:
  - `SYNCED` → зелёный (`bg-emerald-500/20 text-emerald-400`)
  - `SYNCING` / `CLONING` → жёлтый (`bg-amber-500/20 text-amber-400`)
  - `ERROR` → красный (`bg-red-500/20 text-red-400`)
  - `PENDING` → серый (`bg-gray-500/20 text-gray-400`)
- **Last Sync** — relative time (напр. "2 hours ago") или "Never"
- **Last Sync Error** — если есть, показать красным текстом под строкой
- **Actions**:
  - Кнопка "Sync" → вызвать `api.syncRepo(id)`, обновить список
  - Кнопка "Edit" → открыть модалку с данными репо
  - Кнопка "Delete" → confirm → `api.deleteRepo(id)`, обновить список

### Модальное окно (создание и редактирование)

Одна модалка для обоих кейсов. Поля формы:

- **Name** (text input) — обязательное. Placeholder: "Backend API"
- **Slug** (text input) — auto-generated из name (toLowerCase, replace spaces with hyphens, strip non-alphanumeric). Placeholder: "backend-api". Показать предупреждение если slug уже занят (опционально)
- **Git URL** (text input) — обязательное. Placeholder: "git@gitlab.com:org/repo.git"
- **Branch** (text input) — default "main"
- **Description** (textarea) — optional. Placeholder: "API сервер на NestJS"
- **Auth Type** (select) — варианты: "None", "SSH Key", "Access Token", "Basic Auth"
- **Auth Config** — динамическое поле, зависит от Auth Type:
  - None → ничего не показывать
  - SSH Key → textarea с label "Private SSH Key". Placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----"
  - Access Token → text input с label "Token"
  - Basic Auth → два text input: "Username" и "Password"
- **Sync Schedule** (text input) — optional. Placeholder: "0 8 * * 1". Под полем — подсказка серым: "Cron format. Examples: `0 8 * * 1` (Mon 8am), `0 */6 * * *` (every 6h), `0 9 * * 1-5` (weekdays 9am)"

Кнопки:
- "Cancel" — закрыть модалку
- "Create" / "Save" — отправить форму

При создании:
```typescript
await api.createRepo({
  name, slug, gitUrl, branch, description,
  authType,  // 'NONE' | 'SSH_KEY' | 'TOKEN' | 'BASIC'
  authConfig: authType === 'NONE' ? null : { /* данные в зависимости от типа */ },
  syncSchedule: syncSchedule || null,
});
```

При редактировании: `await api.updateRepo(id, { ...same fields... })`. Не отправлять authConfig если пользователь не менял его (чтобы не затирать зашифрованные данные).

### Автообновление

После clone или sync может пройти несколько секунд. Добавь автообновление списка каждые 5 секунд если хотя бы одно репо в статусе `PENDING` или `CLONING` или `SYNCING`:

```typescript
useEffect(() => {
  const hasInProgress = repos.some(r => ['PENDING', 'CLONING', 'SYNCING'].includes(r.syncStatus));
  if (!hasInProgress) return;
  const timer = setInterval(loadRepos, 5000);
  return () => clearInterval(timer);
}, [repos]);
```

---

## Шаг 3. Интеграция в страницу агента

В `apps/web/src/app/(dashboard)/agents/[id]/page.tsx`.

### 3.1. Добавь state

В начало компонента рядом с `showToolPicker` и `showSkillPicker`:

```typescript
const [showRepoPicker, setShowRepoPicker] = useState(false);
```

### 3.2. Секция "Repositories"

Добавь после секции "Skills" (после `</Section>` на строке ~561) и перед блоком MCP Servers:

```tsx
<Section title="Repositories" wide>
  <div className="space-y-2">
    {(agent.repositories && agent.repositories.length > 0) ? agent.repositories.map((ar: any) => {
      const repo = ar.repo || {};
      const statusColors: Record<string, string> = {
        SYNCED: 'bg-emerald-500/20 text-emerald-400',
        SYNCING: 'bg-amber-500/20 text-amber-400',
        CLONING: 'bg-amber-500/20 text-amber-400',
        ERROR: 'bg-red-500/20 text-red-400',
        PENDING: 'bg-gray-500/20 text-gray-400',
      };
      return (
        <div key={ar.id} className="flex items-center gap-3 p-3 bg-[var(--background)] border border-[var(--border)] rounded-lg">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{repo.name || repo.slug}</div>
            <div className="text-xs text-[var(--muted)] truncate font-mono">{repo.gitUrl}</div>
          </div>
          <span className="text-[10px] px-1 text-[var(--muted)]">{repo.branch}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[repo.syncStatus] || 'bg-gray-500/20 text-gray-400'}`}>
            {repo.syncStatus}
          </span>
          <button
            onClick={async () => {
              await api.removeRepoFromAgent(agent.id, ar.repoId);
              loadAgent();
            }}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
          >Remove</button>
        </div>
      );
    }) : (
      <p className="text-sm text-[var(--muted)]">No repositories connected. Connect repositories to give the agent code search tools.</p>
    )}
    <button
      onClick={() => setShowRepoPicker(true)}
      className="text-sm px-3 py-2 rounded-lg border border-dashed border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition w-full"
    >+ Connect Repository</button>
  </div>
</Section>
```

### 3.3. Модалка выбора репозитория

Добавь в конец компонента рядом с Skill Picker и Tool Picker модалками:

```tsx
{showRepoPicker && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRepoPicker(false)}>
    <div className="bg-[var(--bg)] rounded-xl border border-[var(--border)] p-6 max-w-lg w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
      <h3 className="text-lg font-semibold mb-4">Connect Repository</h3>
      <RepoPickerContent
        agentId={agent.id}
        connectedRepoIds={(agent.repositories || []).map((ar: any) => ar.repoId)}
        onConnected={() => { setShowRepoPicker(false); loadAgent(); }}
      />
      <div className="flex justify-end mt-4">
        <button onClick={() => setShowRepoPicker(false)} className="px-4 py-2 rounded-lg border border-[var(--border)]">Close</button>
      </div>
    </div>
  </div>
)}
```

Компонент `RepoPickerContent` можно определить прямо в этом файле (по аналогии с другими inline-компонентами типа `ApprovalPolicySection`):

```tsx
function RepoPickerContent({ agentId, connectedRepoIds, onConnected }: { agentId: string; connectedRepoIds: string[]; onConnected: () => void }) {
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getRepos().then(data => {
      setRepos(Array.isArray(data) ? data : data.data || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <p className="text-sm text-[var(--muted)]">Loading repositories...</p>;

  const available = repos.filter(r => !connectedRepoIds.includes(r.id));
  if (available.length === 0) return <p className="text-sm text-[var(--muted)]">No repositories available. Create one in the Repositories page first.</p>;

  return (
    <div className="space-y-2">
      {available.map(repo => (
        <div key={repo.id} className="flex items-center gap-3 p-3 bg-[var(--background)] border border-[var(--border)] rounded-lg">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm">{repo.name}</div>
            <div className="text-xs text-[var(--muted)] truncate font-mono">{repo.gitUrl}</div>
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            repo.syncStatus === 'SYNCED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'
          }`}>{repo.syncStatus}</span>
          <button
            onClick={async () => {
              await api.assignRepoToAgent(agentId, repo.id);
              onConnected();
            }}
            className="text-xs px-3 py-1.5 bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
          >Connect</button>
        </div>
      ))}
    </div>
  );
}
```

---

## Шаг 4. Навигация

В `apps/web/src/app/(dashboard)/layout.tsx` найди список навигационных ссылок (рядом с Tools, Skills и т.д.) и добавь:

```tsx
{ href: '/repos', label: 'Repositories', icon: /* использовать тот же паттерн что и у соседних ссылок */ }
```

Размести рядом с "Tools" и "Skills" — они логически связаны.

---

## Стилевые требования

- Используй **только** CSS-переменные из существующих страниц: `var(--background)`, `var(--foreground)`, `var(--border)`, `var(--muted)`, `var(--accent)`, `var(--bg)`
- Tailwind-классы — те же что в `tools/page.tsx` и `agents/[id]/page.tsx`
- Не добавляй новые CSS-файлы, не импортируй внешние библиотеки
- Компонент `Section` уже определён в `agents/[id]/page.tsx` — используй его

## Проверка

1. `docker compose exec api pnpm build` — frontend компилируется без ошибок
2. Страница `/repos`:
   - Открывается, показывает список репозиториев
   - Создание: заполнить форму → Create → репо появляется со статусом PENDING → через несколько секунд SYNCED
   - Sync: нажать Sync → статус меняется на SYNCING → через несколько секунд SYNCED
   - Delete: нажать Delete → confirm → репо исчезает
3. Страница агента:
   - Секция "Repositories" видна
   - Кнопка "+ Connect Repository" → модалка со списком доступных репо
   - Connect → репо появляется в секции
   - Remove → репо исчезает
4. В чате с агентом: спросить "найди где определён класс AuthService" → агент использует `repo_find_definition`

## Что НЕ нужно

- НЕ трогай backend — он уже реализован
- НЕ меняй Prisma-схему
- НЕ добавляй новые npm-зависимости
- НЕ добавляй тесты
- НЕ меняй docker-compose.yml, docker-compose.override.yml, Dockerfile или Dockerfile.dev
- НЕ создавай отдельные компоненты в `components/` — всё inline в page.tsx (как в остальных страницах AGEMS)