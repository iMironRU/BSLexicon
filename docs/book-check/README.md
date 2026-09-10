# book-check — валидация репо книги

CLI-скрипт для проверки книги на BSLexicon: `book.yaml`, `.nb.json`, `.query-task.yaml`. Прогоняет стартер каждой задачи-запроса через интерпретатор — так автор сразу видит, что фикстура сходится с эталонным ответом.

## Локальный запуск

```bash
npx tsx scripts/book-check.ts .          # человекочитаемый отчёт
npx tsx scripts/book-check.ts . --json   # JSON для CI
```

Exit-code `0` — ошибок нет, `1` — есть.

## В CI книги (GitHub Actions)

Используй composite action — он сам делает checkout BSLexicon,
npm ci и запуск скрипта. Автор книги кладёт в свой репо
`.github/workflows/book-check.yml`:

```yaml
name: book-check

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: iMironRU/BSLexicon/.github/actions/book-check@main
```

Входы (все опциональны):

| input | по умолчанию | что |
|---|---|---|
| `path` | `.` | путь к корню репо книги внутри workspace |
| `bslexicon-ref` | `main` | ветка/тег/SHA BSLexicon для запуска — используй тег на релизах книги, чтобы CI не ломался при изменениях песочницы |
| `node-version` | `24` | версия Node |

Скрипт печатает список findings; если хоть один `error` — CI падает.

### Пример: закрепить версию песочницы

```yaml
- uses: iMironRU/BSLexicon/.github/actions/book-check@main
  with:
    bslexicon-ref: v1.2.0
```

### Пример: книга в подпапке monorepo

```yaml
- uses: iMironRU/BSLexicon/.github/actions/book-check@main
  with:
    path: books/reading-queries
```

## Что проверяется

- `book.yaml` — формат (title, chapters, notebook paths существуют)
- каждый `.nb.json` — парсится через тот же `parseAnyFile`, что и в браузере
- каждый `.query-task.yaml` — формат, потом `runQueryTask(spec.starter, spec)`:
  - `pass` (starter сам решает задачу) — `ok`
  - `fail` (не сходится) — `warn` (нормально: стартеры заготовки)
  - `error` (парсер/рантайм) — `error` (задача сломана)

## Что не проверяется (пока)

- Что book.yaml содержит все notebook'и, лежащие в `notebooks/` — но не наоборот. Если добавили файл и забыли в оглавление — молчание.
- Ссылки внутри markdown-ячеек.
- Прогон обычных `task-cell` (BSL) — только query-task.

Расширять по мере необходимости в src/book/book-check.ts, обратите внимание — pure TypeScript, никаких вызовов git/сети.
