# book-check — валидация репо книги

CLI-скрипт для проверки книги на BSLexicon: `book.yaml`, `.nb.json`, `.query-task.yaml`. Прогоняет стартер каждой задачи-запроса через интерпретатор — так автор сразу видит, что фикстура сходится с эталонным ответом.

## Локальный запуск

```bash
npx tsx scripts/book-check.ts .          # человекочитаемый отчёт
npx tsx scripts/book-check.ts . --json   # JSON для CI
```

Exit-code `0` — ошибок нет, `1` — есть.

## В CI книги (GitHub Actions)

Пример workflow, который автор может положить в свой репо книги как `.github/workflows/book-check.yml`:

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

      - uses: actions/checkout@v4
        with:
          repository: iMironRU/BSLexicon
          path: bslexicon
          ref: main

      - uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Install BSLexicon deps
        run: npm ci
        working-directory: bslexicon

      - name: Run book-check
        run: npx tsx scripts/book-check.ts $GITHUB_WORKSPACE
        working-directory: bslexicon
```

Скрипт печатает список findings; если хоть один `error` — CI падает.

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
