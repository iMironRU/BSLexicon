# Demo-набор для `?nb-src=`

Пример ноутбука-урока с task-cell'ами по `ref` — для проверки #30 и как
показательный образец для педагогов.

## Файлы

- `lesson-01-basics.nb.json` — урок из 5 ячеек: md + code + task-по-ref + md + task-по-ref
- `tasks/print-42.task.yaml` — простая stdout-задача
- `tasks/double.task.yaml` — call-задача с двумя тестами (один hidden)

## Как открыть

Открыть урок в тренажёре напрямую по raw-ссылке:

```
https://imiron.ru/BSLexicon/notebook/?nb-src=https://raw.githubusercontent.com/iMironRU/BSLexicon/main/examples/notebook-demo/lesson-01-basics.nb.json
```

Тренажёр:
1. Загрузит `lesson-01-basics.nb.json`.
2. Резолвит `ref` каждой task-ячейки как raw в том же репо.
3. Загрузит `tasks/print-42.task.yaml` и `tasks/double.task.yaml`.
4. Зафиксирует SHA ветки `main` на момент открытия — покажется в шапке.

## Для собственных наборов

См. [`docs/education/README.md`](../../docs/education/README.md) — общий
дизайн платформы. Кратко:

- задачи лежат как `.task.yaml` в любой папке репо (педагог сам решает где);
- ноутбуки — как `.nb.json` (либо в git-connect'нутых `notebooks/`, либо где угодно);
- `ref` в task-cell — относительно корня репо.
