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
import type { QueryTaskSpec } from '../query/task-format';

export type CellType = 'markdown' | 'code' | 'task' | 'query' | 'query-task';

export interface MarkdownCellData {
  id: string;
  type: 'markdown';
  source: string;
  /**
   * Ячейка «заморожена» автором: ученик не может её редактировать (issue #60).
   * Ставится в спеке автора, в UI отображается замочком в gutter.
   */
  frozen?: boolean;
}

export interface CodeCellData {
  id: string;
  type: 'code';
  source: string;
  frozen?: boolean;
}

export interface TaskCellData {
  id: string;
  type: 'task';
  /** Текущее решение ученика (то, что он редактирует в Monaco). */
  source: string;
  /**
   * Спека задачи. Если задан `ref` и spec из него подтянут — используем
   * его, иначе — этот inline. Для offline / share-по-URL сценария
   * (без git-контекста) `ref` показывает placeholder, а inline
   * работает как fallback.
   */
  task: TaskSpec;
  /**
   * Опциональная ссылка на `.task.yaml` в репо педагога — относительно
   * корня репо (например, `tasks/strings-length.task.yaml`). Резолвится
   * при открытии через `?nb-src=` (см. #30 учебной платформы). Пока
   * такого контекста нет — task-cell помечается «нужно открыть через
   * ссылку педагога».
   */
  ref?: string;
  /**
   * «Объясни своё решение своими словами» (#33). Feynman method: ученик
   * пишет короткое markdown-объяснение почему решил именно так. Педагог
   * видит и код, и объяснение — знает угадал или понял.
   */
  explanation?: string;
  frozen?: boolean;
}

/**
 * Query-ячейка (#42): SDBL-запрос против встроенной схемы + данных.
 * Схема/данные хранятся как YAML-строки прямо в ячейке — либо inline
 * (созданы автором вручную), либо подгружаются через `ref` из репо
 * педагога аналогично task-ячейкам. `ref` — путь без расширения,
 * например `datasets/mini-erp`; резолвится в пару файлов
 * `<ref>.schema.yaml` и `<ref>.data.yaml`.
 */
export interface QueryCellData {
  id: string;
  type: 'query';
  /** Текст запроса — то, что редактирует ученик. */
  source: string;
  /** YAML схемы (Kind, поля, размерности…). */
  schema: string;
  /** YAML данных (записи справочников, движения регистров…). */
  data: string;
  /** Опциональная ссылка на пару .schema.yaml/.data.yaml в репо педагога. */
  ref?: string;
  /**
   * Значения параметров `&Имя` (issue #53). Порядок сохраняется — так же,
   * как их вводит пользователь.
   */
  parameters?: import('../query/parameters').QueryParamEntry[];
  frozen?: boolean;
}

/**
 * Query-задача (#43): SDBL-запрос с эталонным результатом и автопроверкой.
 * Похоже на TaskCellData, но проверка идёт через сравнение rowset'а с
 * эталоном (см. src/query/task-runner.ts). Спека `task` иммутабельна для
 * ученика; `source` — то, что он редактирует.
 */
export interface QueryTaskCellData {
  id: string;
  type: 'query-task';
  source: string;
  task: QueryTaskSpec;
  /** Опциональная ссылка на `.query-task.yaml` в репо педагога. */
  ref?: string;
  /** «Объясни своё решение» — тот же паттерн, что у обычной задачи (#33). */
  explanation?: string;
  frozen?: boolean;
}

export type Cell = MarkdownCellData | CodeCellData | TaskCellData | QueryCellData | QueryTaskCellData;

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
