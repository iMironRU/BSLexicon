/**
 * Учебная база по ссылке (#55).
 *
 * `/query/?schema-src=<url>&data-src=<url>` — книга или педагог держат
 * схему и данные у себя, песочница их забирает. Без параметров всё как
 * было: встроенная мини-ERP, ни одного сетевого запроса.
 *
 * Модуль чистый: сеть приходит параметром `fetchImpl`, хранилище —
 * параметром `store`. Поэтому он проверяется тестами без браузера.
 */
import { buildFixture, type Fixture } from '../query/fixture';
import { parseDataYaml, parseSchemaYaml, validateFixture } from '../query/schema-loader';

/** Откуда взята база, которая сейчас в песочнице. */
export type FixtureOrigin =
  | { kind: 'встроенная' }
  | { kind: 'по ссылке'; schemaUrl: string; dataUrl: string };

export type LoadResult =
  | { ok: true; fixture: Fixture; origin: FixtureOrigin }
  | { ok: false; error: string };

/** Минимум от `fetch`, который нам нужен, — чтобы тест не поднимал сеть. */
export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Минимум от `sessionStorage`. */
export interface TextStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Разбор адресной строки. Возвращает либо пару ссылок, либо причину,
 * по которой параметры не приняты, — молчаливого отката нет нигде.
 */
export function readFixtureSource(search: string): { origin: FixtureOrigin; error?: string } {
  const params = new URLSearchParams(search);
  const schemaUrl = params.get('schema-src');
  const dataUrl = params.get('data-src');

  if (!schemaUrl && !dataUrl) return { origin: { kind: 'встроенная' } };
  if (!schemaUrl || !dataUrl) {
    return {
      origin: { kind: 'встроенная' },
      error: 'Нужны оба параметра: schema-src и data-src. Открыта встроенная демо-база.',
    };
  }
  if (!isHttpUrl(schemaUrl) || !isHttpUrl(dataUrl)) {
    return {
      origin: { kind: 'встроенная' },
      error: 'База грузится только по http:// или https://. Открыта встроенная демо-база.',
    };
  }
  return { origin: { kind: 'по ссылке', schemaUrl, dataUrl } };
}

/**
 * Загрузка и сборка базы по двум ссылкам. Путь тот же, что у встроенной:
 * разбор схемы → разбор данных → сверка данных со схемой → сборка.
 */
export async function loadRemoteFixture(
  schemaUrl: string,
  dataUrl: string,
  opts: { fetchImpl: FetchLike; store?: TextStore } ,
): Promise<LoadResult> {
  const origin: FixtureOrigin = { kind: 'по ссылке', schemaUrl, dataUrl };

  const schemaText = await fetchText(schemaUrl, 'схема', opts);
  if (typeof schemaText !== 'string') return schemaText;
  const dataText = await fetchText(dataUrl, 'данные', opts);
  if (typeof dataText !== 'string') return dataText;

  const schema = parseSchemaYaml(schemaText);
  if (!schema.ok) return { ok: false, error: `Схема не разобралась: ${schema.error}` };

  const data = parseDataYaml(dataText);
  if (!data.ok) return { ok: false, error: `Данные не разобрались: ${data.error}` };

  const checked = validateFixture(schema.value, data.value);
  if (!checked.ok) return { ok: false, error: `Данные не соответствуют схеме: ${checked.error}` };

  return { ok: true, fixture: buildFixture(schema.value, data.value), origin };
}

async function fetchText(
  url: string,
  what: string,
  opts: { fetchImpl: FetchLike; store?: TextStore },
): Promise<string | { ok: false; error: string }> {
  const key = `qs-fixture:${url}`;
  const cached = opts.store?.getItem(key);
  if (cached !== null && cached !== undefined) return cached;

  let res: { ok: boolean; status: number; text: () => Promise<string> };
  try {
    res = await opts.fetchImpl(url);
  } catch (e) {
    return { ok: false, error: `Не удалось загрузить ${what}: ${(e as Error).message}` };
  }
  if (!res.ok) return { ok: false, error: `Не удалось загрузить ${what}: ответ ${res.status}` };

  const text = await res.text();
  if (text.length > MAX_BYTES) {
    return { ok: false, error: `Файл со ${what} больше ${Math.round(MAX_BYTES / 1024)} КБ — не грузим.` };
  }
  try {
    opts.store?.setItem(key, text);
  } catch {
    /* хранилище переполнено или запрещено — не беда, просто не кэшируем */
  }
  return text;
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
