# Задача: улучшить repo-инструменты агентов в AGEMS

## Контекст

Файл: `apps/api/src/modules/runtime/runtime.service.ts`

В методе `buildTools()` есть секция `// —— Repository code search tools ——`. Там определены инструменты: `repo_list`, `repo_search`, `repo_read_file`, `repo_structure`, `repo_find_definition`.

Эти инструменты используются AI-агентами (LLM) для исследования кода в склонированных на сервер Git-репозиториях. Агенты задают вопросы о коде, ищут определения, разбираются в архитектуре. Репозитории могут быть на **Python, Java, JavaScript, TypeScript, Go, Rust, C#, Kotlin, Ruby, PHP, Swift** — инструменты должны хорошо работать со всеми распространёнными языками.

Текущая проблема: инструменты возвращают слишком мало контекста, результаты поиска — сырой grep-вывод, обрезанный до 100 строк. Агент часто не может понять структуру проекта и даёт некачественные ответы.

Нужно внести четыре изменения. Правки в трёх файлах:
1. `apps/api/Dockerfile` — добавить системные пакеты (изменение 0)
2. `apps/api/Dockerfile.dev` — добавить системные пакеты (изменение 0)
3. `apps/api/src/modules/runtime/runtime.service.ts` — секция repo tools внутри `buildTools()` (изменения 1, 2, 3)

Не менять никакие другие файлы. Не менять сигнатуры существующих инструментов, которые не затронуты задачей. Не трогать код вне секции repo tools (в runtime.service.ts).

Общие константы, которые уже определены выше в коде и доступны внутри блока:

```ts
const EXCLUDE_DIRS = ['node_modules', 'dist', 'build', '.git', '__pycache__', '.next'];
const EXCLUDE_FILES = ['*.lock', '*.min.js', '*.min.css', '*.map'];
```

Функция `getRepoPath(slug)` тоже уже определена и возвращает `{ path: string }` или `{ error: string }`.

---

## Изменение 0: установить GNU grep и findutils в Docker-образы

Файлы: `apps/api/Dockerfile` и `apps/api/Dockerfile.dev`

Оба образа на `node:20-alpine`. Alpine использует BusyBox, где `grep`, `find` и `xargs` — урезанные версии. Они в целом работают, но есть проблемы:
- BusyBox `xargs` нестабилен на длинных списках файлов (тысячи результатов от find)
- BusyBox `grep -c` в pipe с xargs даёт неожиданный exit code 1, если часть файлов не содержит совпадений, что ломает обработку ошибок в Node.js `execSync`
- BusyBox `find` не поддерживает некоторые GNU-опции, которые могут понадобиться в будущем

### Что сделать

**Файл 1: `apps/api/Dockerfile`**

В стадии `runner` найти строку:

```dockerfile
RUN apk add --no-cache ffmpeg git curl chromium poppler-utils \
```

Заменить на:

```dockerfile
RUN apk add --no-cache ffmpeg git curl chromium poppler-utils grep findutils \
```

Строка после `\` (с `&& ln -s ...`) остаётся без изменений.

**Файл 2: `apps/api/Dockerfile.dev`**

Найти строку:

```dockerfile
RUN apk add --no-cache git openssh-client curl
```

Заменить на:

```dockerfile
RUN apk add --no-cache git openssh-client curl grep findutils
```

### Зачем оба пакета

- `grep` — GNU grep (~250KB), заменяет BusyBox grep, поддерживает все флаги: `-l`, `-c`, `-m`, `-C`, `-A`, `-B`, `-E`, `-P`
- `findutils` — GNU find и xargs (~350KB), надёжная обработка длинных списков файлов, поддержка `-print0` / `xargs -0`

---

## Изменение 1: переделать `repo_search`

### Текущее поведение
`repo_search` делает `find | xargs grep -n -C 10 | head -500`, потом возвращает первые 100 строк. Результат — мешанина строк из разных файлов.

### Новое поведение

Добавить параметр `mode` с двумя значениями:

#### `mode: "files"` (значение по умолчанию)

Возвращает **список файлов**, в которых есть совпадения, а не сырой grep-вывод.

Алгоритм:
1. Выполнить `find ... | xargs grep -l` (флаг `-l` — только имена файлов)
2. Для каждого найденного файла (максимум **30 файлов**) посчитать количество совпадений (`grep -c`) и взять **3 строки preview** вокруг первого совпадения (`grep -n -m 1 -A 1 -B 1`)
3. Вернуть структурированный JSON:

```ts
{
  files: Array<{
    path: string;       // путь от корня репо, например "src/modules/runtime/runtime.service.ts"
    matchCount: number;  // кол-во совпадений в файле
    preview: string;     // 3 строки: строка до, строка совпадения, строка после (с номерами строк)
  }>;
  totalFiles: number;    // сколько всего файлов найдено (может быть > 30)
  query: string;         // повтор запроса для удобства
  hint: string;          // подсказка агенту: "Use repo_search with mode='content' and filePattern to read matches in a specific file, or repo_read_file to read the full file."
}
```

**Ранжирование файлов**: перед отдачей отсортировать файлы по "весу":
- Если совпадение найдено в строке, содержащей ключевое слово определения (`export`, `class`, `function`, `def`, `fn`, `func`, `interface`, `type`, `struct`, `enum`, `trait`, `impl`, `public static`, `private`, `protected`, `const`, `let`, `var`, `val`, `object`) — файл получает вес 3
- Если совпадение в строке import/require/use/from — вес 1  
- Остальные строки — вес 2
- Итоговый вес файла = сумма весов всех совпадений
- Сортировать по убыванию веса

Для определения типа строки — простая проверка через regex на первое слово/паттерн, без AST-парсинга. Достаточно line.match() по основным паттернам.

#### `mode: "content"`

Поведение похоже на текущее, но улучшенное:
- Контекст: `-C 25` вместо `-C 10`
- Лимит строк в ответе: **200** вместо 100
- `head -1000` вместо `head -500`
- Группировка по файлам: вывод grep разбивать на секции по файлам и возвращать как структурированный JSON:

```ts
{
  results: Array<{
    file: string;      // путь к файлу
    matches: string;   // grep-вывод для этого файла (с номерами строк)
  }>;
  totalMatches: number;
  truncated: boolean;
}
```

Для разбивки по файлам: grep -n выводит строки вида `./path/to/file.ts:42:content`. Парсить по имени файла перед первым двоеточием.

### Обновлённые параметры

```ts
parameters: z.object({
  repo: z.string().describe('Repository slug'),
  query: z.string().describe('Search query (text or regex pattern)'),
  filePattern: z.string().optional().default('*').describe('File glob pattern, e.g. "*.ts", "*.py", "*.java"'),
  caseSensitive: z.boolean().optional().default(false),
  mode: z.enum(['files', 'content']).optional().default('files').describe(
    'files = list matching files with preview (default, start here); content = show full grep matches with surrounding context'
  ),
}),
```

### Обновлённое описание инструмента

```
Search for text/code patterns in a repository. Available repos: ${repoNames.join(', ')}.

Two modes:
- mode="files" (default): Returns a ranked list of files containing matches, with match count and preview. Start with this to find relevant files.
- mode="content": Returns full grep output with 25 lines of context, grouped by file. Use after identifying target files with mode="files".

Workflow: repo_search(mode="files") → identify relevant file → repo_search(mode="content", filePattern="exact/path.ts") or repo_read_file.
```

---

## Изменение 2: добавить новый инструмент `repo_file_summary`

Добавить ПОСЛЕ `repo_structure` и ПЕРЕД `repo_find_definition`. Условие показа — такое же: `!disabledTools.has('repo_file_summary')`.

### Назначение
Даёт агенту «оглавление» файла — список всех определений (классы, функции, типы, переменные) без чтения всего файла. Экономит токены и помогает агенту понять, нужен ли этот файл.

### Параметры

```ts
{
  name: 'repo_file_summary',
  description: `Get a structural summary of a file: imports, exports, class/function/type definitions with line numbers. Much cheaper than reading the whole file — use this to decide if a file is relevant before reading it. Available repos: ${repoNames.join(', ')}`,
  parameters: z.object({
    repo: z.string().describe('Repository slug'),
    path: z.string().describe('File path relative to repo root'),
  }),
}
```

### Логика execute

1. Проверить `getRepoPath`, разрешить путь, проверить path traversal (точно как в `repo_read_file`)
2. Прочитать файл целиком в строковый массив
3. Вернуть:

```ts
{
  path: string;
  totalLines: number;
  language: string;              // определить по расширению: .ts→TypeScript, .py→Python, .java→Java, .js→JavaScript, .go→Go, .rs→Rust, .cs→C#, .kt→Kotlin, .rb→Ruby, .php→PHP, .swift→Swift и т.д.
  header: string;                // первые 10 строк файла (обычно imports, package, pragma)
  definitions: Array<{
    line: number;
    kind: string;                // 'class' | 'function' | 'method' | 'interface' | 'type' | 'enum' | 'const' | 'variable' | 'struct' | 'trait' | 'decorator' | 'export'
    name: string;                // имя определения
    signature: string;           // вся строка (обрезать до 150 символов)
  }>;
}
```

### Regex-паттерны для извлечения определений

Написать функцию `extractDefinitions(lines: string[], language: string)`, которая проходит по строкам и матчит паттерны. Паттерны должны покрывать:

**TypeScript / JavaScript:**
- `export (default )?(class|function|const|let|var|type|interface|enum|abstract class) NAME`
- `(class|interface|type|enum) NAME`
- `(const|let|var) NAME = ` (только на уровне модуля — строка начинается без отступа или с `export`)
- `(async )?function NAME`
- `(public|private|protected|static|async|get|set)+ NAME(` — методы внутри класса
- Декораторы NestJS: `@Controller`, `@Injectable`, `@Module`, `@Guard`, `@Resolver` (line.kind = 'decorator')

**Python:**
- `class NAME`
- `(async )?def NAME`
- `NAME = ` на уровне модуля (без отступа)
- `@decorator` — только если следующая строка начинается с `class` или `def`

**Java / Kotlin / C#:**
- `(public|private|protected|static|final|abstract|override|open|data|sealed|suspend)* (class|interface|enum|record|struct|object) NAME`
- `(public|private|protected|static|final|abstract|override|suspend)* [\w<>\[\].]+ NAME(` — методы
- `(val|var|const val) NAME`

**Go:**
- `func (NAME|(\w+ \w+) NAME)(`  — функции и методы
- `type NAME (struct|interface|func)`
- `var NAME` / `const NAME`

**Rust:**
- `(pub )?(fn|struct|enum|trait|impl|type|const|static|mod) NAME`
- `(pub )?(async )?fn NAME`

**Ruby:**
- `class NAME` / `module NAME`
- `def NAME`
- `attr_accessor :NAME` / `attr_reader :NAME`

**PHP:**
- `(abstract )?(class|interface|trait|enum) NAME`
- `(public|private|protected|static)* function NAME`

**Swift:**
- `(class|struct|enum|protocol|extension|actor) NAME`
- `(func|var|let|static func|class func) NAME`

Не нужно идеальное AST-парсирование. Regex по строке — достаточно. Если строка не матчится — пропускать. Лучше пропустить определение, чем распарсить неправильно.

Лимит: максимум **100 definitions** в ответе. Если больше — обрезать и добавить `truncated: true`.

---

## Изменение 3: улучшить `repo_read_file`

### Текущее поведение
- `endLine` default: 300
- Если файл длиннее — агент получает только первые 300 строк без подсказки о продолжении

### Изменения

1. Поднять default `endLine` с `300` до `500`:
```ts
endLine: z.number().optional().default(500).describe('End line number (max 500 lines per read)'),
```

2. В строке расчёта `end`:
```ts
const end = Math.min(allLines.length, Math.min(params.endLine || 500, start + 499));
```

3. После формирования ответа, если файл длиннее прочитанного диапазона — добавить поле `hint`:

```ts
const result: any = { content: numbered, startLine: start, endLine: end, totalLines: allLines.length };

if (end < allLines.length) {
  result.hint = `File has ${allLines.length} lines. You read lines ${start}–${end}. Call again with startLine=${end + 1} to continue reading.`;
  // Добавить краткое «оглавление» оставшейся части — найти определения в непрочитанных строках
  const remaining = allLines.slice(end);
  const defs = remaining
    .map((line, i) => {
      // Quick scan for definitions in remaining lines
      const m = line.match(/^\s*(export\s+)?(default\s+)?(class|function|interface|type|enum|struct|def|fn|func|pub fn|pub struct|pub enum)\s+(\w+)/);
      if (m) return `  L${end + 1 + i}: ${line.trim().substring(0, 120)}`;
      return null;
    })
    .filter(Boolean)
    .slice(0, 15);
  if (defs.length > 0) {
    result.hint += `\nKey definitions in unread portion:\n${defs.join('\n')}`;
  }
}

return result;
```

Расширить regex для `defs`, чтобы он ловил определения на всех поддерживаемых языках:

```ts
const defPattern = /^\s*(export\s+)?(default\s+)?(abstract\s+)?(public\s+|private\s+|protected\s+|static\s+|final\s+|async\s+|override\s+|open\s+|sealed\s+|data\s+|suspend\s+)*(class|function|interface|type|enum|struct|trait|impl|object|record|def|fn|func|pub fn|pub struct|pub enum|pub trait|module|protocol|extension|actor)\s+(\w+)/;
```

4. Обновить описание инструмента:

```
Read a file from a repository. Returns content with line numbers. If the file is longer than the requested range, the response includes a hint with key definitions in the unread portion to help you decide whether to continue reading. Available repos: ${repoNames.join(', ')}
```

---

## Важные ограничения

- Все exec-команды (`execSync`) должны иметь `timeout: 10_000` (уже есть, не менять)
- Все exec-команды должны использовать `shell: '/bin/sh'`
- `maxBuffer: 2 * 1024 * 1024` — не менять
- PATH traversal проверки (`if (!filePath.startsWith(pathResolve(repoPath)))`) — сохранить как есть
- Сохранить обработку SIGPIPE (блок catch, где проверяется `err.stdout`) в `repo_search`
- Не ломать API: все существующие вызовы `repo_search` без `mode` должны работать (mode defaults to 'files')
- Код должен компилироваться TypeScript'ом без ошибок
- В Docker-образе установлены GNU grep и GNU findutils (изменение 0), поэтому можно использовать любые GNU-флаги: `grep -P`, `find -print0`, `xargs -0` и т.д. При этом код также должен работать на macOS (локальная разработка), где GNU grep и find — стандарт. Не использовать флаг `grep -P` — он не нужен для этой задачи и отсутствует в macOS grep.

## Стиль кода

Следовать стилю существующего файла:
- Однострочные if/catch без фигурных скобок где уместно
- `const` по умолчанию
- Шаблонные строки для формирования команд
- Zod для параметров
- async execute функции
- Использовать dynamic imports (`await import('child_process')`, `await import('fs')`, `await import('path')`) — как в остальном коде файла

## Проверка

После внесения изменений:
1. Убедиться, что в `apps/api/Dockerfile` (стадия `runner`) и в `apps/api/Dockerfile.dev` строки `apk add` содержат `grep findutils`
2. Запустить `cd /path/to/agems && pnpm turbo build --filter=api` — убедиться, что нет ошибок компиляции
3. Проверить, что `repo_search` без параметра `mode` работает (default = 'files')
4. Проверить, что `repo_file_summary` для .ts и .py файлов возвращает определения