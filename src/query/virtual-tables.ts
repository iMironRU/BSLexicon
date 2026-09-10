/**
 * Виртуальные таблицы регистра накопления (#44).
 *
 * Модель — «сырые движения + прямая свёртка» (см.
 * docs/query-sandbox/registers-research.md §Рекомендация). Для учебных
 * объёмов (до ~10k движений) линейная свёртка O(N) быстрее и наглядно
 * отлаживается — ни индексов, ни bucket-снимков не нужно.
 *
 * Поддерживаем три метода регистра `view: 'Остатки'`:
 *   - `Остатки(&Дата, [условие])`
 *   - `Обороты(&Начало, &Конец, [Периодичность], [условие])`
 *   - `ОстаткиИОбороты(&Начало, &Конец, [Периодичность], [условие])`
 *
 * MVP-упрощения:
 *   - Параметр `условие` игнорируется (в интерпретаторе аналогично ГДЕ).
 *   - Параметр `Периодичность` игнорируется — в `ОстаткиИОбороты` только
 *     общий срез без разбивки по периодам.
 *   - Пустой (NULL/UNDEFINED) параметр даты = «без границы»: `&Дата = NULL`
 *     в `Остатки` возвращает остатки на всё время, `&Начало = NULL` — от
 *     минус бесконечности, `&Конец = NULL` — до плюс бесконечности.
 *
 * Виды регистра сведений (СрезПоследних/СрезПервых) — отдельная задача #47.
 */
import type { BslValue } from '@core/index';
import { UNDEFINED } from '@core/interpreter/values';
import type { Fixture, Row } from './fixture';
import type { AccumRegister, Field, InfoRegister } from './types';

export type VirtualMethod =
  | 'Остатки' | 'Обороты' | 'ОстаткиИОбороты'
  | 'СрезПоследних' | 'СрезПервых';

export interface VirtualQuery {
  /** Полное имя регистра: `РегистрНакопления.ОстаткиТоваров`. */
  ref: string;
  method: VirtualMethod;
  /** Уже вычисленные параметры в порядке следования в скобках. */
  params: BslValue[];
}

export interface MaterializedVirtual {
  /** Порядок колонок для `Т.*` и в вывод по умолчанию. */
  fieldNames: string[];
  /** Поля, полученные раскрытием ресурсов — для валидации при разыменовании. */
  virtualFields: Field[];
  rows: Row[];
}

/**
 * Материализует виртуальную таблицу. Диспетчирует по типу регистра:
 *   - РегистрНакопления: Остатки / Обороты / ОстаткиИОбороты
 *   - РегистрСведений (периодический): СрезПоследних / СрезПервых
 */
export function materializeVirtual(fx: Fixture, vq: VirtualQuery): MaterializedVirtual {
  const tf = fx.tables.get(vq.ref);
  if (!tf) throw new Error(`Виртуальная таблица: регистр «${vq.ref}» не найден`);
  const kind = tf.table.kind;
  const rows = tf.rows;

  switch (vq.method) {
    case 'Остатки':
    case 'Обороты':
    case 'ОстаткиИОбороты':
      if (kind !== 'РегистрНакопления') {
        throw new Error(`Виртуальная ${vq.method} доступна только регистру накопления, а «${vq.ref}» — ${kind}`);
      }
      break;
    case 'СрезПоследних':
    case 'СрезПервых':
      if (kind !== 'РегистрСведений') {
        throw new Error(`Виртуальная ${vq.method} доступна только регистру сведений, а «${vq.ref}» — ${kind}`);
      }
      break;
  }

  switch (vq.method) {
    case 'Остатки': return balance(tf.table as AccumRegister, rows, vq.params[0]);
    case 'Обороты': return turnovers(tf.table as AccumRegister, rows, vq.params[0], vq.params[1]);
    case 'ОстаткиИОбороты': return balanceAndTurnovers(tf.table as AccumRegister, rows, vq.params[0], vq.params[1]);
    case 'СрезПоследних': return slice(tf.table as InfoRegister, rows, vq.params[0], 'last');
    case 'СрезПервых': return slice(tf.table as InfoRegister, rows, vq.params[0], 'first');
  }
}

// ── Остатки ────────────────────────────────────────────────────────

/**
 * `Остатки(&Дата)` = Σ движений с `Период <= &Дата`.
 * Знак: `Приход` → +ресурс, `Расход` → −ресурс. Если `ВидДвижения` отсутствует
 * — считаем как «Приход» (регистр только на прирост).
 * Строки с нулевыми ресурсами не возвращаем — 1С так и делает.
 */
function balance(reg: AccumRegister, movements: Row[], date: BslValue): MaterializedVirtual {
  const upTo = periodBound(date);
  const groups = new Map<string, DimGroup>();

  for (const m of movements) {
    const p = periodOf(m);
    if (upTo !== null && (p === null || p > upTo)) continue;
    const g = groupFor(groups, reg, m);
    const sign = movementSign(m);
    for (const res of reg.resources) {
      const v = numOf(m[res.name]);
      if (v !== null) g.resources[res.name] = (g.resources[res.name] ?? 0) + sign * v;
    }
  }

  const resFieldNames = reg.resources.map((r) => `${r.name}Остаток`);
  const fieldNames = [...reg.dimensions.map((d) => d.name), ...resFieldNames];
  const virtualFields: Field[] = [
    ...reg.dimensions,
    ...reg.resources.map((r) => ({ name: `${r.name}Остаток`, type: r.type })),
  ];
  const rows: Row[] = [];
  for (const g of groups.values()) {
    if (!hasNonZero(g.resources)) continue;
    const row: Row = { ...g.dims };
    for (const res of reg.resources) row[`${res.name}Остаток`] = g.resources[res.name] ?? 0;
    rows.push(row);
  }
  return { fieldNames, virtualFields, rows };
}

// ── Обороты ───────────────────────────────────────────────────────

/**
 * `Обороты(&Начало, &Конец)` — суммы движений в полуоткрытом интервале
 * `[Начало; Конец)`. Для каждого ресурса три колонки:
 * `<ресурс>Приход`, `<ресурс>Расход`, `<ресурс>Оборот = Приход − Расход`.
 */
function turnovers(reg: AccumRegister, movements: Row[], start: BslValue, end: BslValue): MaterializedVirtual {
  const from = periodBound(start);
  const to = periodBound(end);
  const groups = new Map<string, DimGroup & { income: { [k: string]: number }; expense: { [k: string]: number } }>();

  for (const m of movements) {
    const p = periodOf(m);
    if (from !== null && (p === null || p < from)) continue;
    if (to !== null && (p === null || p >= to)) continue;
    const g = groupFor(groups, reg, m) as ReturnType<typeof groupFor> & { income: { [k: string]: number }; expense: { [k: string]: number } };
    if (!g.income) { g.income = {}; g.expense = {}; }
    const isIncome = movementSign(m) > 0;
    for (const res of reg.resources) {
      const v = numOf(m[res.name]);
      if (v === null) continue;
      const bucket = isIncome ? g.income : g.expense;
      bucket[res.name] = (bucket[res.name] ?? 0) + v;
    }
  }

  const fieldNames = [
    ...reg.dimensions.map((d) => d.name),
    ...reg.resources.flatMap((r) => [`${r.name}Приход`, `${r.name}Расход`, `${r.name}Оборот`]),
  ];
  const virtualFields: Field[] = [
    ...reg.dimensions,
    ...reg.resources.flatMap((r) => [
      { name: `${r.name}Приход`, type: r.type },
      { name: `${r.name}Расход`, type: r.type },
      { name: `${r.name}Оборот`, type: r.type },
    ]),
  ];
  const rows: Row[] = [];
  for (const g of groups.values()) {
    const row: Row = { ...g.dims };
    let anyNonZero = false;
    for (const res of reg.resources) {
      const inc = g.income[res.name] ?? 0;
      const exp = g.expense[res.name] ?? 0;
      row[`${res.name}Приход`] = inc;
      row[`${res.name}Расход`] = exp;
      row[`${res.name}Оборот`] = inc - exp;
      if (inc !== 0 || exp !== 0) anyNonZero = true;
    }
    if (anyNonZero) rows.push(row);
  }
  return { fieldNames, virtualFields, rows };
}

// ── ОстаткиИОбороты ──────────────────────────────────────────────

/**
 * `ОстаткиИОбороты(&Начало, &Конец)` — комбинация начала, конца и оборота
 * за интервал. Для каждого ресурса пять колонок: `НачальныйОстаток`,
 * `КонечныйОстаток`, `Приход`, `Расход`, `Оборот`.
 * Периодичность не поддерживаем — общий срез без разбивки.
 */
function balanceAndTurnovers(reg: AccumRegister, movements: Row[], start: BslValue, end: BslValue): MaterializedVirtual {
  const openingRaw = balance(reg, movements, minusEpsilon(start));
  const closingRaw = balance(reg, movements, minusEpsilon(end));
  const t = turnovers(reg, movements, start, end);

  // Индекс по ключу измерений: сначала соберём все уникальные группы.
  const keyOf = (row: Row): string => reg.dimensions.map((d) => stableKey(row[d.name] as BslValue)).join('');
  const dimsFor = (row: Row): { [k: string]: BslValue } => {
    const out: { [k: string]: BslValue } = {};
    for (const d of reg.dimensions) out[d.name] = row[d.name] as BslValue;
    return out;
  };
  const openIdx = new Map<string, Row>();
  for (const r of openingRaw.rows) openIdx.set(keyOf(r), r);
  const closeIdx = new Map<string, Row>();
  for (const r of closingRaw.rows) closeIdx.set(keyOf(r), r);
  const turnIdx = new Map<string, Row>();
  for (const r of t.rows) turnIdx.set(keyOf(r), r);

  const allKeys = new Set<string>();
  const dimsByKey = new Map<string, { [k: string]: BslValue }>();
  const collect = (rows: Row[]): void => {
    for (const r of rows) {
      const k = keyOf(r);
      allKeys.add(k);
      if (!dimsByKey.has(k)) dimsByKey.set(k, dimsFor(r));
    }
  };
  collect(openingRaw.rows);
  collect(closingRaw.rows);
  collect(t.rows);

  const fieldNames = [
    ...reg.dimensions.map((d) => d.name),
    ...reg.resources.flatMap((r) => [
      `${r.name}НачальныйОстаток`, `${r.name}Приход`, `${r.name}Расход`,
      `${r.name}Оборот`, `${r.name}КонечныйОстаток`,
    ]),
  ];
  const virtualFields: Field[] = [
    ...reg.dimensions,
    ...reg.resources.flatMap((r) => [
      { name: `${r.name}НачальныйОстаток`, type: r.type },
      { name: `${r.name}Приход`, type: r.type },
      { name: `${r.name}Расход`, type: r.type },
      { name: `${r.name}Оборот`, type: r.type },
      { name: `${r.name}КонечныйОстаток`, type: r.type },
    ]),
  ];
  const rows: Row[] = [];
  for (const k of allKeys) {
    const dims = dimsByKey.get(k) ?? {};
    const row: Row = { ...dims };
    let anyNonZero = false;
    for (const res of reg.resources) {
      const open = numOf(openIdx.get(k)?.[`${res.name}Остаток`]) ?? 0;
      const close = numOf(closeIdx.get(k)?.[`${res.name}Остаток`]) ?? 0;
      const tr = turnIdx.get(k);
      const inc = numOf(tr?.[`${res.name}Приход`]) ?? 0;
      const exp = numOf(tr?.[`${res.name}Расход`]) ?? 0;
      row[`${res.name}НачальныйОстаток`] = open;
      row[`${res.name}Приход`] = inc;
      row[`${res.name}Расход`] = exp;
      row[`${res.name}Оборот`] = inc - exp;
      row[`${res.name}КонечныйОстаток`] = close;
      if (open !== 0 || close !== 0 || inc !== 0 || exp !== 0) anyNonZero = true;
    }
    if (anyNonZero) rows.push(row);
  }
  return { fieldNames, virtualFields, rows };
}

// ── СрезПоследних / СрезПервых ──────────────────────────────────

/**
 * Срез регистра сведений: для каждой комбинации измерений — запись с
 * максимальным (для СрезПоследних) или минимальным (для СрезПервых)
 * Периодом, удовлетворяющим ограничению по &Дата.
 * Непериодический регистр: параметр даты игнорируется, возвращаем один
 * ряд на комбинацию измерений (последний по порядку вставки).
 */
function slice(reg: InfoRegister, rows: Row[], date: BslValue, mode: 'first' | 'last'): MaterializedVirtual {
  const bound = periodBound(date);
  const groups = new Map<string, Row>();
  const dimKey = (r: Row): string => reg.dimensions.map((d) => stableKey(r[d.name] as BslValue)).join('|');

  for (const r of rows) {
    const p = reg.periodic ? periodOf(r) : null;
    if (reg.periodic && bound !== null) {
      if (p === null) continue;
      if (mode === 'last' && p > bound) continue;
      if (mode === 'first' && p < bound) continue;
    }
    const key = dimKey(r);
    const prev = groups.get(key);
    if (!prev) { groups.set(key, r); continue; }
    if (!reg.periodic) continue; // непериодический: первая победила
    const prevP = periodOf(prev);
    if (prevP === null || p === null) { groups.set(key, r); continue; }
    if (mode === 'last' && p > prevP) groups.set(key, r);
    if (mode === 'first' && p < prevP) groups.set(key, r);
  }

  const fieldNames = [
    ...(reg.periodic ? ['Период'] : []),
    ...reg.dimensions.map((d) => d.name),
    ...reg.resources.map((r) => r.name),
    ...(reg.attributes ?? []).map((a) => a.name),
  ];
  const virtualFields: Field[] = [
    ...(reg.periodic ? [{ name: 'Период', type: { kind: 'Дата' } as const }] : []),
    ...reg.dimensions,
    ...reg.resources,
    ...(reg.attributes ?? []),
  ];
  const outRows: Row[] = [];
  for (const g of groups.values()) {
    const row: Row = {};
    if (reg.periodic) row['Период'] = (g['Период'] as BslValue) ?? UNDEFINED;
    for (const d of reg.dimensions) row[d.name] = g[d.name] as BslValue;
    for (const r of reg.resources) row[r.name] = g[r.name] as BslValue;
    for (const a of reg.attributes ?? []) row[a.name] = g[a.name] as BslValue;
    outRows.push(row);
  }
  return { fieldNames, virtualFields, rows: outRows };
}

// ── helpers ────────────────────────────────────────────────────────

interface DimGroup {
  dims: { [k: string]: BslValue };
  resources: { [k: string]: number };
}

function groupFor(map: Map<string, DimGroup>, reg: AccumRegister, m: Row): DimGroup {
  const key = reg.dimensions.map((d) => stableKey(m[d.name] as BslValue)).join('');
  let g = map.get(key);
  if (!g) {
    const dims: { [k: string]: BslValue } = {};
    for (const d of reg.dimensions) dims[d.name] = m[d.name] as BslValue;
    g = { dims, resources: {} };
    map.set(key, g);
  }
  return g;
}

function stableKey(v: BslValue): string {
  if (v === null) return ' null';
  if (v === undefined) return ' undef';
  if (typeof v === 'boolean') return v ? 'T' : 'F';
  return String(v);
}

function periodOf(m: Row): string | null {
  const p = m['Период'];
  return typeof p === 'string' && p ? p : null;
}

function periodBound(v: BslValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return null;
}

/**
 * Верхняя граница для «начального остатка» и «конечного остатка на день до конца
 * интервала» — уменьшаем на минимальный шаг ISO-строки. Достаточно для учебных
 * дат с секундной точностью: вычитаем 1 секунду.
 */
function minusEpsilon(v: BslValue): BslValue {
  const p = periodBound(v);
  if (p === null) return v;
  const d = new Date(p);
  if (isNaN(d.getTime())) return v;
  d.setUTCSeconds(d.getUTCSeconds() - 1);
  return d.toISOString().replace(/\.\d{3}Z$/, '');
}

function movementSign(m: Row): 1 | -1 {
  const kind = m['ВидДвижения'];
  if (typeof kind === 'string') {
    const up = kind.toUpperCase();
    if (up === 'РАСХОД' || up === 'EXPENSE') return -1;
  }
  return 1;
}

function numOf(v: BslValue | Row[] | undefined): number | null {
  if (v === undefined || v === null || v === UNDEFINED) return null;
  if (typeof v === 'number') return v;
  return null;
}

function hasNonZero(r: { [k: string]: number }): boolean {
  for (const k in r) if (r[k] !== 0) return true;
  return false;
}
