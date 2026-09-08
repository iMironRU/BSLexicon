/**
 * Модель данных для notebook-режима (#22, #23, #24).
 *
 * Ноутбук — упорядоченный массив ячеек. Три типа:
 *   - `markdown` — объяснение автора;
 *   - `code` — BSL-фрагмент с собственным Run в общем kernel'е (#23);
 *   - `task` — задача с автопрогонкой: условие + стартовый код +
 *     набор тестов. Проверяется в изолированном runtime (не в общем
 *     kernel), чтобы ученик не «схитрил», объявив нужное в соседней
 *     ячейке.
 *
 * `id` живёт только на клиенте для React `key` — в сериализованный
 * `?nb=` не попадает (см. serialize.ts).
 */
import type { TaskTest } from '../judge/types';

export type CellType = 'markdown' | 'code' | 'task';

export interface MarkdownCellData {
  id: string;
  type: 'markdown';
  source: string;
}

export interface CodeCellData {
  id: string;
  type: 'code';
  source: string;
}

export interface TaskCellData {
  id: string;
  type: 'task';
  /** Текущее решение ученика (то, что он редактирует в Monaco). */
  source: string;
  task: TaskSpec;
}

export type Cell = MarkdownCellData | CodeCellData | TaskCellData;

export interface Notebook {
  cells: Cell[];
}

/** Спека задачи, встроенная в task-ячейку. Иммутабельна для ученика. */
export interface TaskSpec {
  title?: string;
  /** Markdown-условие задачи. */
  statement: string;
  /** Стартовый код (появляется в редакторе при создании ячейки/сбросе). */
  starter: string;
  /** Набор тестов, тот же формат что в Judge (stdout / call). */
  tests: TaskTest[];
  /** Опциональные подсказки; ученик разворачивает по одной. */
  hints?: string[];
}

export interface CodeCellOutput {
  /** Строки, напечатанные `Сообщить()`. */
  lines: string[];
  /** Runtime/parse/lex-ошибка, если была. */
  error: string | null;
}
