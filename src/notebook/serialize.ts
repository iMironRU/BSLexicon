/**
 * URL-контракт notebook'а: `?nb=<url-safe base64(gzip(JSON))>`.
 *
 * Формат аналогичен `?gzcode` в тренажёре (см. src/app/url-params.ts):
 * gzip-компрессия → URL-safe base64 → строка. Для notebook сжатое поле
 * особенно важно — глава с 10 ячейками легко перевалит за 2 KB без
 * компрессии, а URL-лимит браузеров ~8 KB.
 *
 * `id` ячейки — чисто клиентский (для React key), в сериализацию не
 * попадает: генерируем свежий при decode.
 *
 * Сериализация ячеек — через `cell-codec.ts` (общий с draft и git),
 * тут остаются URL-специфичные вещи: gzip, base64, схема пакета
 * `{v: 1, cells}`, и «фабричные» функции создания ячеек / стартового
 * ноутбука.
 */
import type { Cell, Notebook, TaskSpec } from './types';
import type { QueryTaskSpec } from '../query/task-format';
import { compressGzip, decompressGzip } from '../app/url-params';
import { fromStored, toStored, type DecodeDefaults, type StoredNotebook } from './cell-codec';
import { DEFAULT_TASK } from './cell-defaults';
// mini-ERP как стартовые схема/данные — Vite-only импорт (?raw). Скрипты
// под tsx (book-check и т.п.) не должны цепляться за serialize.ts.
import schemaYaml from '../../examples/query-demo/mini-erp.schema.yaml?raw';
import dataYaml from '../../examples/query-demo/mini-erp.data.yaml?raw';

const DEFAULT_QUERY_SOURCE = `ВЫБРАТЬ Наименование
ИЗ Справочник.Номенклатура
ГДЕ ПометкаУдаления = ЛОЖЬ
УПОРЯДОЧИТЬ ПО Наименование`;

/** Полновесная task-спека для стартового «объясни задачу и проверь». */
const STARTER_QUERY_TASK: QueryTaskSpec = {
  title: 'Первая задача-запрос',
  statement: '## Все склады\n\nВыведи **Наименование** всех складов из мини-ERP.',
  starter: 'ВЫБРАТЬ ...\nИЗ Справочник.Склады',
  schema: schemaYaml,
  data: dataYaml,
  expected: {
    kind: 'unordered',
    columns: ['Наименование'],
    rows: [['Основной'], ['Восточный']],
  },
  hints: ['Тебе нужны один столбец и одна таблица — никаких соединений.'],
};


let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `c${idCounter}`;
}

/**
 * Стартовая схема+данные для новой query-ячейки — «мини-ERP» из
 * examples/query-demo. Так автор урока может добавить запрос,
 * не собирая схему с нуля.
 */
export interface QueryCellInit {
  source?: string;
  schema?: string;
  data?: string;
  ref?: string;
}

/** Создаёт пустую ячейку нужного типа. Task — из шаблона по умолчанию. */
export function newCell(type: 'markdown' | 'code'): Cell;
export function newCell(type: 'markdown' | 'code', source: string): Cell;
export function newCell(type: 'task'): Cell;
export function newCell(type: 'task', source: string, task: TaskSpec): Cell;
export function newCell(type: 'query'): Cell;
export function newCell(type: 'query', init: QueryCellInit): Cell;
export function newCell(type: 'query-task'): Cell;
export function newCell(type: 'query-task', source: string, task: QueryTaskSpec): Cell;
export function newCell(
  type: Cell['type'],
  sourceOrInit?: string | QueryCellInit,
  taskSpec?: TaskSpec | QueryTaskSpec,
): Cell {
  if (type === 'task') {
    const t = (taskSpec as TaskSpec | undefined) ?? DEFAULT_TASK;
    const src = typeof sourceOrInit === 'string' ? sourceOrInit : '';
    return { id: nextId(), type: 'task', source: src || t.starter, task: t };
  }
  if (type === 'query') {
    const init = (typeof sourceOrInit === 'object' && sourceOrInit) ? sourceOrInit : {};
    return {
      id: nextId(),
      type: 'query',
      source: init.source ?? DEFAULT_QUERY_SOURCE,
      schema: init.schema ?? schemaYaml,
      data: init.data ?? dataYaml,
      ...(init.ref && { ref: init.ref }),
    };
  }
  if (type === 'query-task') {
    const t = (taskSpec as QueryTaskSpec | undefined) ?? STARTER_QUERY_TASK;
    const src = typeof sourceOrInit === 'string' ? sourceOrInit : '';
    return { id: nextId(), type: 'query-task', source: src || t.starter, task: t };
  }
  const src = typeof sourceOrInit === 'string' ? sourceOrInit : '';
  return { id: nextId(), type, source: src } as Cell;
}

/**
 * Демо-урок как стартовый notebook — знакомит новичка со всеми тремя
 * типами ячеек за один проход. Сюжет: объяснение → две связанные
 * code-ячейки (показывают persistent kernel) → объяснение → задача
 * (показывает автопрогонку). Пять ячеек — хватает чтобы «пощупать»,
 * не столько чтобы утонуть. См. #26.
 */
export function starterNotebook(): Notebook {
  return {
    cells: [
      newCell(
        'markdown',
        '# Что это?\n\n' +
          'Ноутбук — это последовательность ячеек. Ячейки бывают трёх видов: ' +
          '**текст** (то что ты сейчас читаешь), **код** (запускается на BSL) ' +
          'и **задача** (с автопрогонкой тестов).\n\n' +
          'Слева от каждой ячейки — кнопка **▶**. Жми — увидишь как работает.',
      ),
      newCell('code', 'Х = 10;'),
      newCell(
        'code',
        '// Эта ячейка помнит, что Х = 10 из предыдущей.\n' +
          'Х = Х + 5;\n' +
          'Сообщить(Х);',
      ),
      newCell(
        'markdown',
        '## Задачи проверяются автоматически\n\n' +
          'В **задаче** ты дописываешь решение и жмёшь «▶ Проверить». ' +
          'Тесты сравнят вывод с ожидаемым. Задача **изолирована** от общего ' +
          'kernel\'а (иконка ⊘ в gutter\'е) — переменные соседних ячеек ей не видны.',
      ),
      newCell(
        'task',
        '// Выведи 42\n',
        {
          title: 'Первая задача',
          statement: '## Выведи 42\n\nНапиши строку, которая напечатает число **42**.',
          starter: '// Выведи 42\n',
          tests: [{ kind: 'stdout', expect: '42' }],
          hints: ['Функция называется `Сообщить`.'],
        },
      ),
      newCell(
        'markdown',
        '## И язык запросов тоже\n\n' +
          'Ячейка **запроса** — та же песочница что и на странице /query/, ' +
          'но живёт прямо в уроке. Схема и данные встроены — здесь это ' +
          'мини-ERP: справочники, документ и регистр остатков.',
      ),
      newCell('query'),
      newCell(
        'markdown',
        '## И задачи-запросы\n\n' +
          'Ячейка **задача-запрос** сравнивает результат твоего запроса ' +
          'с эталоном. Порядок строк проверяется только если задача так требует.',
      ),
      newCell('query-task'),
    ],
  };
}

/**
 * Сериализует notebook в компактный `?nb=` параметр.
 * Асинхронно из-за `CompressionStream` (нативный API браузера).
 */
export async function encodeNotebook(nb: Notebook): Promise<string> {
  const payload: StoredNotebook = { v: 1, cells: nb.cells.map(toStored) };
  return compressGzip(JSON.stringify(payload));
}

const DECODE_DEFAULTS: DecodeDefaults = {
  task: DEFAULT_TASK,
  queryTask: STARTER_QUERY_TASK,
  querySchema: schemaYaml,
  queryData: dataYaml,
};

/**
 * Декодирует `?nb=` в объект `Notebook`. Кидает исключение, если параметр
 * невалидный (не base64 / не gzip / не наша схема) — вызывающий должен
 * это обработать и показать пользователю понятный fallback.
 */
export async function decodeNotebook(raw: string): Promise<Notebook> {
  const json = await decompressGzip(raw);
  const payload = JSON.parse(json) as StoredNotebook;
  if (payload.v !== 1 || !Array.isArray(payload.cells)) {
    throw new Error('Unsupported notebook schema');
  }
  return {
    cells: payload.cells.map((c) => fromStored(c, nextId, DECODE_DEFAULTS)),
  };
}
