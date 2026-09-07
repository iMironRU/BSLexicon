/**
 * Модель данных для notebook-режима (см. #22).
 *
 * Ноутбук — упорядоченный массив ячеек. Каждая ячейка либо markdown
 * (текст объяснения), либо code (BSL-фрагмент с собственным Run).
 *
 * `id` живёт только на клиенте для React `key` — в сериализованный
 * `?nb=` не попадает (см. serialize.ts).
 */
export type CellType = 'markdown' | 'code';

export interface Cell {
  id: string;
  type: CellType;
  source: string;
}

export interface Notebook {
  cells: Cell[];
}

export interface CodeCellOutput {
  /** Строки, напечатанные `Сообщить()`. */
  lines: string[];
  /** Runtime/parse/lex-ошибка, если была. */
  error: string | null;
}
