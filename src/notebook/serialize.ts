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

interface SerializedCellBase {
  t: 'md' | 'code' | 'task';
  s: string;
}
interface SerializedTaskCell extends SerializedCellBase {
  t: 'task';
  /** Спека задачи прямо внутри ячейки — иммутабельна для ученика. */
  task: TaskSpec;
}
type SerializedCell = SerializedCellBase | SerializedTaskCell;

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

/** Создаёт пустую ячейку нужного типа. Task — из шаблона по умолчанию. */
export function newCell(type: 'markdown' | 'code'): Cell;
export function newCell(type: 'markdown' | 'code', source: string): Cell;
export function newCell(type: 'task'): Cell;
export function newCell(type: 'task', source: string, task: TaskSpec): Cell;
export function newCell(type: Cell['type'], source = '', task?: TaskSpec): Cell {
  if (type === 'task') {
    const t = task ?? DEFAULT_TASK;
    return { id: nextId(), type: 'task', source: source || t.starter, task: t };
  }
  return { id: nextId(), type, source } as Cell;
}

/** Стартовый notebook при открытии `/notebook/` без параметров. */
export function starterNotebook(): Notebook {
  return {
    cells: [
      newCell(
        'markdown',
        '# Новый ноутбук\n\n' +
          'Слева от каждой ячейки — кнопка **▶ Запустить**. ' +
          'Вывод появится под ячейкой.',
      ),
      newCell('code', 'Сообщить("Привет, мир!");'),
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
      if (c.type === 'task') return { t: 'task', s: c.source, task: c.task };
      return { t: c.type === 'markdown' ? 'md' : 'code', s: c.source };
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
      if (c.t === 'task') {
        const withTask = c as SerializedTaskCell;
        // Осторожно: спека может быть недоделанной, если старый URL или ручная правка.
        // Fallback на DEFAULT — чтобы не крашить весь ноутбук из-за одной битой ячейки.
        const task: TaskSpec = withTask.task ?? DEFAULT_TASK;
        return newCell('task', withTask.s, task);
      }
      return newCell(c.t === 'md' ? 'markdown' : 'code', c.s);
    }),
  };
}
