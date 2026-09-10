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
 */
import type { Cell, Notebook, TaskSpec } from './types';
import type { QueryTaskSpec } from '../query/task-format';
import type { QueryParamEntry } from '../query/parameters';
import schemaYaml from '../../examples/query-demo/mini-erp.schema.yaml?raw';
import dataYaml from '../../examples/query-demo/mini-erp.data.yaml?raw';

interface SerializedCellBase {
  t: 'md' | 'code' | 'task' | 'query' | 'query-task';
  s: string;
  /** Ячейка заморожена автором (issue #60). */
  frozen?: boolean;
  /** Auto-run (issue #70) — только для code и query. */
  autorun?: boolean;
}
interface SerializedTaskCell extends SerializedCellBase {
  t: 'task';
  /** Спека задачи прямо внутри ячейки — иммутабельна для ученика. */
  task: TaskSpec;
  /**
   * Опциональная ссылка на `.task.yaml` в репо педагога (см. #28
   * учебной платформы). Резолвится при открытии через `?nb-src=`.
   */
  ref?: string;
  /** «Объясни своё решение своими словами» (#33). */
  explanation?: string;
}
interface SerializedQueryCell extends SerializedCellBase {
  t: 'query';
  /** YAML схемы — inline или подгружается через ref. */
  schema: string;
  /** YAML данных. */
  data: string;
  /** Опциональная ссылка на пару .schema.yaml/.data.yaml (без расширения). */
  ref?: string;
  /** Значения параметров &Имя. */
  parameters?: QueryParamEntry[];
}
interface SerializedQueryTaskCell extends SerializedCellBase {
  t: 'query-task';
  /** Полная спека задачи. */
  task: QueryTaskSpec;
  /** Опциональная ссылка на `.query-task.yaml`. */
  ref?: string;
  explanation?: string;
}
type SerializedCell =
  | SerializedCellBase
  | SerializedTaskCell
  | SerializedQueryCell
  | SerializedQueryTaskCell;

interface SerializedNotebook {
  v: 1;
  cells: SerializedCell[];
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `c${idCounter}`;
}

const DEFAULT_TASK: TaskSpec = {
  statement: '## Задача\n\nНапиши код, который выводит `Сообщить("привет")`.',
  starter: '// напиши решение здесь\n',
  tests: [{ kind: 'stdout', expect: 'привет' }],
};

const DEFAULT_QUERY_SOURCE = `ВЫБРАТЬ Наименование
ИЗ Справочник.Номенклатура
ГДЕ ПометкаУдаления = ЛОЖЬ
УПОРЯДОЧИТЬ ПО Наименование`;

const DEFAULT_QUERY_TASK: QueryTaskSpec = {
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
    const cell: Cell = {
      id: nextId(),
      type: 'query',
      source: init.source ?? DEFAULT_QUERY_SOURCE,
      schema: init.schema ?? schemaYaml,
      data: init.data ?? dataYaml,
    };
    if (init.ref) (cell as { ref?: string }).ref = init.ref;
    return cell;
  }
  if (type === 'query-task') {
    const t = (taskSpec as QueryTaskSpec | undefined) ?? DEFAULT_QUERY_TASK;
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
  const payload: SerializedNotebook = {
    v: 1,
    cells: nb.cells.map((c) => {
      if (c.type === 'task') {
        const cell: SerializedTaskCell = { t: 'task', s: c.source, task: c.task };
        if (c.ref) cell.ref = c.ref;
        if (c.explanation) cell.explanation = c.explanation;
        if (c.frozen) cell.frozen = true;
        return cell;
      }
      if (c.type === 'query') {
        const cell: SerializedQueryCell = { t: 'query', s: c.source, schema: c.schema, data: c.data };
        if (c.ref) cell.ref = c.ref;
        if (c.parameters?.length) cell.parameters = c.parameters;
        if (c.frozen) cell.frozen = true;
        if (c.autorun) cell.autorun = true;
        return cell;
      }
      if (c.type === 'query-task') {
        const cell: SerializedQueryTaskCell = { t: 'query-task', s: c.source, task: c.task };
        if (c.ref) cell.ref = c.ref;
        if (c.explanation) cell.explanation = c.explanation;
        if (c.frozen) cell.frozen = true;
        return cell;
      }
      const base: SerializedCellBase = { t: c.type === 'markdown' ? 'md' : 'code', s: c.source };
      if (c.frozen) base.frozen = true;
      if (c.type === 'code' && c.autorun) base.autorun = true;
      return base;
    }),
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);

  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }

  let bin = '';
  for (const b of merged) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Декодирует `?nb=` в объект `Notebook`. Кидает исключение, если параметр
 * невалидный (не base64 / не gzip / не наша схема) — вызывающий должен
 * это обработать и показать пользователю понятный fallback.
 */
export async function decodeNotebook(raw: string): Promise<Notebook> {
  const std = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const binStr = atob(padded);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }

  const json = new TextDecoder().decode(merged);
  const payload = JSON.parse(json) as SerializedNotebook;
  if (payload.v !== 1 || !Array.isArray(payload.cells)) {
    throw new Error('Unsupported notebook schema');
  }
  return {
    cells: payload.cells.map((c) => {
      let created: Cell;
      if (c.t === 'task') {
        const withTask = c as SerializedTaskCell;
        // Осторожно: спека может быть недоделанной, если старый URL или ручная правка.
        // Fallback на DEFAULT — чтобы не крашить весь ноутбук из-за одной битой ячейки.
        const task: TaskSpec = withTask.task ?? DEFAULT_TASK;
        created = newCell('task', withTask.s, task);
        if (withTask.ref && created.type === 'task') created.ref = withTask.ref;
        if (withTask.explanation && created.type === 'task') created.explanation = withTask.explanation;
      } else if (c.t === 'query') {
        const withQuery = c as SerializedQueryCell;
        // Схема/данные обязательны в сериализации, но старый URL или ручная
        // правка могут привести к пустым — fallback на встроенный mini-erp.
        created = newCell('query', {
          source: withQuery.s,
          schema: withQuery.schema || undefined,
          data: withQuery.data || undefined,
          ref: withQuery.ref,
        });
        if (withQuery.parameters?.length && created.type === 'query') {
          created.parameters = withQuery.parameters;
        }
      } else if (c.t === 'query-task') {
        const withQt = c as SerializedQueryTaskCell;
        const task = withQt.task ?? DEFAULT_QUERY_TASK;
        created = newCell('query-task', withQt.s, task);
        if (withQt.ref && created.type === 'query-task') created.ref = withQt.ref;
        if (withQt.explanation && created.type === 'query-task') created.explanation = withQt.explanation;
      } else {
        created = newCell(c.t === 'md' ? 'markdown' : 'code', c.s);
      }
      if (c.frozen) (created as { frozen?: boolean }).frozen = true;
      if (c.autorun && (created.type === 'code' || created.type === 'query')) {
        (created as { autorun?: boolean }).autorun = true;
      }
      return created;
    }),
  };
}
