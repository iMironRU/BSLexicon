/**
 * Автосохранение notebook'а в localStorage (см. #25).
 *
 * Один слот `bslexicon:notebook:draft` — последнее состояние ноутбука
 * пользователя. Пишется дебаунсом из App.tsx на каждое изменение.
 * Приоритет при загрузке: URL `?nb=` > draft > starter.
 *
 * Формат — JSON (не gzip): черновик хранится локально, места хватает,
 * а parsing нужен на каждой инициализации — простая строка быстрее.
 * URL-shareable форма (gzip+base64) — отдельно в serialize.ts.
 *
 * Хранит все типы ячеек и расширения (frozen, autorun, parameters,
 * spec для task/query-task) — без них author-режим #27 терял бы
 * правки после перезагрузки.
 *
 * Battery: если localStorage недоступен (Safari Private, кросс-домен
 * блокировка) — вся логика превращается в no-op, ноутбук продолжает
 * работать без сохранения. Никаких исключений.
 */

import type { Cell, Notebook, TaskSpec } from './types';
import type { QueryTaskSpec } from '../query/task-format';
import type { QueryParamEntry } from '../query/parameters';

const KEY = 'bslexicon:notebook:draft';

interface StoredCell {
  t: 'md' | 'code' | 'task' | 'query' | 'query-task';
  s: string;
  task?: TaskSpec;
  ref?: string;
  explanation?: string;
  frozen?: boolean;
  autorun?: boolean;
  schema?: string;
  data?: string;
  parameters?: QueryParamEntry[];
  query_task?: QueryTaskSpec;
}

interface StoredNotebook {
  v: 1;
  cells: StoredCell[];
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `d${idCounter}`;
}

export function saveDraft(nb: Notebook): void {
  try {
    const payload: StoredNotebook = {
      v: 1,
      cells: nb.cells.map((c) => {
        const base: StoredCell = { t: 'md', s: c.source };
        if (c.type === 'markdown') base.t = 'md';
        else if (c.type === 'code') base.t = 'code';
        else if (c.type === 'task') {
          base.t = 'task';
          base.task = c.task;
          if (c.ref) base.ref = c.ref;
          if (c.explanation) base.explanation = c.explanation;
        } else if (c.type === 'query') {
          base.t = 'query';
          base.schema = c.schema;
          base.data = c.data;
          if (c.ref) base.ref = c.ref;
          if (c.parameters?.length) base.parameters = c.parameters;
        } else if (c.type === 'query-task') {
          base.t = 'query-task';
          base.query_task = c.task;
          if (c.ref) base.ref = c.ref;
          if (c.explanation) base.explanation = c.explanation;
        }
        if (c.frozen) base.frozen = true;
        if ((c.type === 'code' || c.type === 'query') && c.autorun) base.autorun = true;
        return base;
      }),
    };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* storage недоступен — молча игнорируем */
  }
}

/**
 * Возвращает сохранённый notebook или null. При битом JSON / неверной
 * схеме тоже null (не бросаем): фолбэк на starter — предсказуемее
 * чем «пустой экран с ошибкой».
 */
export function loadDraft(): Notebook | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNotebook;
    if (parsed.v !== 1 || !Array.isArray(parsed.cells)) return null;
    const cells: Cell[] = parsed.cells.map((c) => {
      let cell: Cell;
      if (c.t === 'task' && c.task) {
        cell = { id: nextId(), type: 'task', source: c.s, task: c.task };
        if (c.ref) cell.ref = c.ref;
        if (c.explanation) cell.explanation = c.explanation;
      } else if (c.t === 'query') {
        cell = { id: nextId(), type: 'query', source: c.s, schema: c.schema ?? '', data: c.data ?? '' };
        if (c.ref) cell.ref = c.ref;
        if (c.parameters?.length) cell.parameters = c.parameters;
      } else if (c.t === 'query-task' && c.query_task) {
        cell = { id: nextId(), type: 'query-task', source: c.s, task: c.query_task };
        if (c.ref) cell.ref = c.ref;
        if (c.explanation) cell.explanation = c.explanation;
      } else if (c.t === 'md') {
        cell = { id: nextId(), type: 'markdown', source: c.s };
      } else {
        cell = { id: nextId(), type: 'code', source: c.s };
      }
      if (c.frozen) (cell as { frozen?: boolean }).frozen = true;
      if (c.autorun && (cell.type === 'code' || cell.type === 'query')) {
        (cell as { autorun?: boolean }).autorun = true;
      }
      return cell;
    });
    return { cells };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
