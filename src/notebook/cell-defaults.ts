/**
 * Дефолтные спеки задачи / query-задачи. Используются fromStored (см.
 * cell-codec.ts) как фолбэки для битых ячеек — иначе пропадала бы вся
 * ячейка, а не её spec.
 *
 * `DEFAULT_TASK` / `DEFAULT_QUERY_TASK` намеренно с примерами:
 * если фолбэк сработал, педагог увидит осмысленную задачу и поймёт,
 * что делать. Пустая структура молчала бы.
 *
 * Модуль намеренно без Vite-специфичных импортов (никаких `?raw`) —
 * подключается из git-notebooks.ts, а её вызывают под tsx-Node
 * (scripts/book-check.ts). Стартовые YAML mini-ERP для newCell живут
 * в serialize.ts, там Vite всё скомпилирует.
 */
import type { QueryTaskSpec } from '../query/task-format';
import type { TaskSpec } from './types';

export const DEFAULT_TASK: TaskSpec = {
  statement: '## Задача\n\nНапиши код, который выводит `Сообщить("привет")`.',
  starter: '// напиши решение здесь\n',
  tests: [{ kind: 'stdout', expect: 'привет' }],
};

/** Фолбэк для битых query-task ячеек. Схема/данные пустые — UI это переживёт. */
export const DEFAULT_QUERY_TASK: QueryTaskSpec = {
  title: 'Задача-запрос',
  statement: '## Задача\n\nНапиши запрос.',
  starter: 'ВЫБРАТЬ ...',
  schema: '',
  data: '',
  expected: { kind: 'unordered', columns: [], rows: [] },
};

/** Пустые схема/данные — для фолбэка на битых ячейках в draft/git. */
export const EMPTY_QUERY_SCHEMA = '';
export const EMPTY_QUERY_DATA = '';
