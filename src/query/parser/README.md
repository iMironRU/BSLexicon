# SDBL parser

Грамматика и сгенерированный парсер языка запросов 1С (SDBL —
Structured Data Base Language).

## Лицензия

Этот подкаталог — **LGPL-3.0-or-later**. Остальной BSLexicon — MIT.

Причина: файлы `grammar/SDBLLexer.g4` и `grammar/SDBLParser.g4`
взяты из проекта [`1c-syntax/bsl-parser`](https://github.com/1c-syntax/bsl-parser)
(автор грамматики Максим Валерий, `<maximovvalery@gmail.com>`).
Оригинальный SPDX-заголовок LGPL сохранён в самих `.g4`.

Сгенерированный код в `generated/` — производное произведение от
LGPL-грамматики, публикуется под той же лицензией. Наша обёртка
`parse.ts` — тоже LGPL (использует `generated/`).

Импортеры из остальных модулей BSLexicon — не производное от LGPL,
т.к. LGPL допускает динамическую линковку. `src/query/interpreter.ts`
и т.п. останутся под MIT.

## Обновление грамматики

```bash
npm run gen:sdbl
```

Скрипт делает `antlr4ng -Dlanguage=TypeScript` над `.g4`. Проверять
собранное — `npm run test tests/query-parser.test.ts`.

Если понадобится обновить грамматику из upstream:

```bash
curl -sL -o src/query/parser/grammar/SDBLLexer.g4 \
  https://raw.githubusercontent.com/1c-syntax/bsl-parser/develop/src/main/antlr/SDBLLexer.g4
curl -sL -o src/query/parser/grammar/SDBLParser.g4 \
  https://raw.githubusercontent.com/1c-syntax/bsl-parser/develop/src/main/antlr/SDBLParser.g4
npm run gen:sdbl
```
