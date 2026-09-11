/**
 * Один источник правды для сериализации ячеек. До этого модуля жили три
 * почти идентичные копии `Cell ↔ StoredCell`: в draft.ts (localStorage),
 * serialize.ts (URL `?nb=`) и git-notebooks.ts (файлы репо). Любое новое
 * поле у ячейки требовало трёх правок; поле лениво забывалось в одном из
 * трёх мест и молча пропадало на пути.
 *
 * Канон — `StoredCell` (JSON-совместимая форма). Все три сериализатора
 * работают через `toStored()` / `fromStored()`; собственные обёртки (gzip
 * для URL, JSON.stringify + localStorage для draft'а, JSON pretty-printed
 * + git-blob для файла) остаются в своих модулях.
 *
 * Обратная совместимость. Ранее serialize.ts для query-task писал поле
 * `task: QueryTaskSpec`, а draft/git — `query_task: QueryTaskSpec`.
 * fromStored принимает обе формы; toStored пишет всегда каноничную
 * (`query_task`).
 *
 * Snapshot-поля (task_snapshot, query_task_snapshot) для solution-файлов
 * git — это забота git-notebooks.ts (там они пре-/пост-обработкой
 * накладываются на StoredCell после/до вызова codec'а).
 */

import type { Cell, TaskSpec } from './types';
import type { QueryTaskSpec } from '../query/task-format';
import type { QueryParamEntry } from '../query/parameters';

/**
 * Каноничная форма ячейки в persistent-хранилищах. Плюс поля snapshot —
 * их пишет только git-notebooks для solution-файлов, остальные обёртки
 * их игнорируют.
 */
export interface StoredCell {
  t: 'md' | 'code' | 'task' | 'query' | 'query-task';
  s: string;
  /** Task-ячейка. */
  task?: TaskSpec;
  /** Query-task-ячейка. Каноничное имя (draft/git). */
  query_task?: QueryTaskSpec;
  /** Ссылка на .task.yaml / .query-task.yaml / .schema.yaml+.data.yaml в git. */
  ref?: string;
  /** «Объясни своё решение своими словами» (#33). */
  explanation?: string;
  /** Query-ячейка: YAML схемы и данных. */
  schema?: string;
  data?: string;
  /** Query-ячейка: значения параметров &Имя. */
  parameters?: QueryParamEntry[];
  /** Ячейка заморожена автором (#60). */
  frozen?: boolean;
  /** Auto-run — только для code и query (#70). */
  autorun?: boolean;
  /** Solution-файл: спека урока на момент сдачи (git-notebooks). */
  task_snapshot?: TaskSpec;
  query_task_snapshot?: QueryTaskSpec;
}

/** Пишет `Cell` в каноничный `StoredCell`. Никаких snapshot-полей. */
export function toStored(c: Cell): StoredCell {
  const stored: StoredCell = { t: 'md', s: c.source };
  if (c.type === 'markdown') stored.t = 'md';
  else if (c.type === 'code') stored.t = 'code';
  else if (c.type === 'task') {
    stored.t = 'task';
    stored.task = c.task;
    if (c.ref) stored.ref = c.ref;
    if (c.explanation) stored.explanation = c.explanation;
  } else if (c.type === 'query') {
    stored.t = 'query';
    stored.schema = c.schema;
    stored.data = c.data;
    if (c.ref) stored.ref = c.ref;
    if (c.parameters?.length) stored.parameters = c.parameters;
  } else if (c.type === 'query-task') {
    stored.t = 'query-task';
    stored.query_task = c.task;
    if (c.ref) stored.ref = c.ref;
    if (c.explanation) stored.explanation = c.explanation;
  }
  if (c.frozen) stored.frozen = true;
  if ((c.type === 'code' || c.type === 'query') && c.autorun) stored.autorun = true;
  return stored;
}

/**
 * Читает `StoredCell` в `Cell`, генерируя id через переданный `idGen`
 * (обёртки хотят свои префиксы: `c` для URL, `d` для draft, `g` для git).
 *
 * `defaults` — фолбэки для битых или сокращённых ячеек: у URL таких
 * почти нет, а у draft/git при ручной правке — регулярно.
 */
export interface DecodeDefaults {
  task: TaskSpec;
  queryTask: QueryTaskSpec;
  /** Пустая query-схема/данные — некоторые тесты и старые URL их не пишут. */
  querySchema: string;
  queryData: string;
}

export function fromStored(c: StoredCell, idGen: () => string, defaults: DecodeDefaults): Cell {
  const id = idGen();
  const frozen = c.frozen ? { frozen: true } : {};

  if (c.t === 'task') {
    // Solution-файлы держат spec в task_snapshot; урок — в task; битые — DEFAULT.
    const spec: TaskSpec = c.task_snapshot ?? c.task ?? defaults.task;
    return {
      id, type: 'task', source: c.s, task: spec,
      ...(c.ref && { ref: c.ref }),
      ...(c.explanation && { explanation: c.explanation }),
      ...frozen,
    };
  }
  if (c.t === 'query') {
    return {
      id, type: 'query', source: c.s,
      schema: c.schema ?? defaults.querySchema,
      data: c.data ?? defaults.queryData,
      ...(c.ref && { ref: c.ref }),
      ...(c.parameters?.length && { parameters: c.parameters }),
      ...(c.autorun && { autorun: true }),
      ...frozen,
    };
  }
  if (c.t === 'query-task') {
    // Обратная совместимость: старый serialize.ts клал spec в `task`,
    // draft/git — в `query_task`. Snapshot побеждает всё для solution.
    const spec: QueryTaskSpec = (c.query_task_snapshot as QueryTaskSpec | undefined)
      ?? c.query_task
      ?? (c.task as unknown as QueryTaskSpec | undefined)
      ?? defaults.queryTask;
    return {
      id, type: 'query-task', source: c.s, task: spec,
      ...(c.ref && { ref: c.ref }),
      ...(c.explanation && { explanation: c.explanation }),
      ...frozen,
    };
  }
  if (c.t === 'md') {
    return { id, type: 'markdown', source: c.s, ...frozen };
  }
  return {
    id, type: 'code', source: c.s,
    ...(c.autorun && { autorun: true }),
    ...frozen,
  };
}
