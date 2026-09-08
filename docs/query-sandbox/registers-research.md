# Виртуальные таблицы РегистрНакопления в браузерной песочнице

Research-заметка к дизайну query-sandbox BSLexicon: как оптимально считать
`Остатки(&Дата)`, `Обороты(&Начало, &Конец)`, `ОстаткиИОбороты` на in-memory
модели данных 1С в браузере.

## 1. Как это устроено внутри самой 1С

Регистр накопления хранится в двух физических таблицах: **основная таблица
движений** (`AccumRg[n]`, все проведённые записи в исходном виде, без агрегации)
и **таблица итогов** (`AccumRgT[n]` для остатков, `AccumRgTn[n]` для оборотов).
Итоги пересчитываются автоматически и представляют собой **снимки по всем
измерениям с месячной периодичностью**: остатки записываются на начало
следующего месяца, обороты — на начало текущего. Периодичность в конфигураторе
не меняется. Виртуальные таблицы (`Остатки`, `Обороты`, `ОстаткиИОбороты`) —
это макросы над итогами + добор движений на «хвостах» между ближайшим снимком
и запрошенной датой. Формально это **incrementally maintained aggregate +
periodic snapshot table** ([инфостарт про хранение][is-storage],
[ИТС про механизм заполнения][its-fill]).

## 2. Аналоги в других системах

- **Materialized views + incremental refresh.** Прямой аналог таблицы итогов.
  Ближе всего — [TimescaleDB continuous aggregates][tsdb-ca]: гипертаблица
  делится на bucket'ы, агрегат хранится по bucket'ам и досчитывается только по
  «свежим» окнам. Точно та же идея, что «месячный снимок + движения между».
  У ClickHouse — [триггерные materialized views][ch-mv], у RisingWave — стрим.
- **Bitemporal / temporal tables.** Регистры фактически бивременные: `Период` —
  valid time, `МоментВремени/Регистратор` — порядок в этой точке. Классика —
  [XTDB][xtdb-bt] и SQL:2011 temporal tables ([обзор Postgres][pg-temporal]).
- **Event sourcing + snapshots.** Движение = событие, итог = снимок агрегата.
  «Балансовая» задача с депозитами/списаниями — учебниковый пример
  ([Kurrent][kurrent-snap]).
- **Time-series DB.** InfluxDB/TimescaleDB решают ровно наш класс запросов
  «агрегация на произвольном окне». Time-bucketing + pre-aggregation — общий
  паттерн.

Ближайший идейный сосед именно к 1С — **TimescaleDB continuous aggregates**:
такая же трёхслойка «сырые движения → бакетные снимки → быстрый ответ на окно».

## 3. In-memory приёмы

- **Prefix sums / Fenwick tree.** Классика: O(n) построение, O(1) на диапазон,
  O(log n) при мутациях ([разбор][prefix-sum]). Прямой способ считать `Обороты`
  по одному ресурсу без измерений.
- **pandas / Polars.** Идиома «остатки на дату» — `groupby(dims).cumsum()` по
  отсортированным по периоду движениям + `merge_asof` для «на момент».
- **DuckDB-Wasm.** Полноценный OLAP-движок в браузере (WASM, worker),
  оконные функции, `QUALIFY`, arrow-совместимость ([пост DuckDB][duckdb-wasm]).
  При наших объёмах (учебный тренажёр, сотни-тысячи строк) — оверкилл, но
  показывает потолок.
- **Кеширование по бакетам.** Делим ось времени на bucket'ы (например, «день»
  для учебных задач), храним `state_at_bucket_start[dims → resources]` и досчёт
  движений внутри бакета. Это ровно 1С-модель, только с меньшим шагом.

## 4. OSS-эмуляции 1С в браузере/JS

Полноценного BSL-рантайма в JS нет. Есть: [1c-syntax/bsl-language-server][bsls]
(Java, LSP, разбор синтаксиса — статический анализ, без исполнения),
[EvilBeaver/OneScript][onescript] (.NET, десктоп/CI, без движка запросов
к регистрам). Песочница языка **запросов** с честными виртуальными таблицами —
насколько известно, ниша не занята. BSLexicon её и закрывает.

## 5. Педагогика

SQL-курсы учат кумулятивам через **оконные функции**: `SUM(x) OVER (PARTITION BY
dim ORDER BY period)` для running total, `LAG/LEAD` для дельт, `ROWS BETWEEN`
для скользящих окон ([LearnSQL][learnsql-rt], [InterviewQuery][iq-cum]).
Ментальная модель «снимок на дату = префиксная сумма движений до даты»
переносится 1:1 на регистр остатков — это удобный дидактический мостик.

## Рекомендация для BSLexicon

**Делаем: «сырые движения + ленивый bucket-снимок по дню».**

- Хранилище: массив движений, отсортированный по (Период, Регистратор).
- `Обороты(&Н,&К, dims)` — линейная свёртка по срезу; для учебных объёмов
  быстрее любого индекса и наглядно отлаживается.
- `Остатки(&Дата, dims)` — префиксная сумма по группам измерений до `&Дата`.
  Мемоизируем результат на границах суток (bucket = день, не месяц как в 1С:
  учебные задачи обычно короче месяца и «месячный снимок» ничего не сэкономит).
- `ОстаткиИОбороты` — композиция двух предыдущих.

**Почему так:**

1. Соответствует ментальной модели 1С (снимки + добор движений) — студент
   позже узнает «настоящую» реализацию и увидит её как масштабирование той же
   идеи, а не другой механизм.
2. Prefix-sum по дням даёт O(1) на типовой учебный запрос при O(N) памяти
   в худшем случае — приемлемо для датасетов тренажёра (< 10k движений).
3. Не тащим DuckDB-Wasm (~3-5 МБ WASM) ради задач, которые честно решаются
   в 200 строках TypeScript. DuckDB держим как fallback, если появятся
   «большие» учебные датасеты.
4. Реализация тривиально объяснима на уроке про оконные функции — педагогика
   и рантайм совпадают.

[is-storage]: https://infostart.ru/1c/articles/1061227/
[its-fill]: https://its.1c.ru/db/pubapplied/content/123/hdoc
[tsdb-ca]: https://www.tigerdata.com/learn/continuous-aggregates-timescaledb
[ch-mv]: https://clickhouse.com/docs/materialized-view/incremental-materialized-view
[xtdb-bt]: https://v1-docs.xtdb.com/concepts/bitemporality/
[pg-temporal]: https://www.red-gate.com/simple-talk/databases/postgresql/saving-data-historically-with-temporal-tables-part-1-queries/
[kurrent-snap]: https://www.kurrent.io/blog/snapshots-in-event-sourcing/
[prefix-sum]: https://medium.com/@fmkosowski/prefix-sums-a-deep-dive-b11e2e0f1d5e
[duckdb-wasm]: https://duckdb.org/2021/10/29/duckdb-wasm
[bsls]: https://github.com/1c-syntax/bsl-language-server
[onescript]: https://github.com/EvilBeaver/OneScript
[learnsql-rt]: https://learnsql.com/blog/what-is-a-running-total-and-how-to-compute-it-in-sql/
[iq-cum]: https://www.interviewquery.com/p/sql-cumulative-sum-guide
