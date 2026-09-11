/**
 * Формат книги (#61).
 *
 * Книга — это git-репо с `book.yaml` в корне и уроками в `notebooks/*.nb.json`.
 * Уроки открываются через существующий `?nb-src=`; сама эта страница
 * `/book/` показывает оглавление и метаданные.
 *
 * Пример:
 *
 * ```yaml
 * title: Чтение данных. Язык запросов 1С
 * author: iMironRU
 * version: "1.0"
 * chapters:
 *   - title: Введение
 *     notebook: notebooks/01-intro.nb.json
 *   - title: Условия и фильтры
 *     notebook: notebooks/02-conditions.nb.json
 * ```
 */
import { load as yamlLoad } from 'js-yaml';
import { errorMessage } from '../app/error-message';
import { err, getStrNonEmpty as getStr, isObj, type Result } from '../app/parse-helpers';

export interface BookChapter {
  title: string;
  /** Путь к `.nb.json` относительно корня репо книги. */
  notebook: string;
  /** Опциональное короткое описание (для карточки). */
  summary?: string;
}

export interface Book {
  title: string;
  author?: string;
  version?: string;
  /** Опциональное расширенное описание (Markdown, отрисуется на странице `/book/`). */
  description?: string;
  chapters: BookChapter[];
}

/** Ре-экспорт: старые тесты и вызовы ждут ParseResult из этого модуля. */
export type ParseResult<T> = Result<T>;

/** Разбирает YAML в объект `Book`. Никогда не бросает — вернёт ошибку. */
export function parseBookYaml(text: string): ParseResult<Book> {
  let raw: unknown;
  try {
    raw = yamlLoad(text);
  } catch (e) {
    return err(`YAML: ${errorMessage(e)}`);
  }
  if (!isObj(raw)) return err('Файл книги должен быть YAML-объектом');
  const o = raw as Record<string, unknown>;

  const title = getStr(o, 'title');
  if (!title) return err('Поле `title` обязательно и должно быть непустой строкой');

  const chaptersRaw = o.chapters;
  if (!Array.isArray(chaptersRaw) || chaptersRaw.length === 0) {
    return err('Поле `chapters` обязательно и должно содержать минимум одну главу');
  }

  const chapters: BookChapter[] = [];
  for (let i = 0; i < chaptersRaw.length; i += 1) {
    const c = chaptersRaw[i];
    if (!isObj(c)) return err(`Глава #${i + 1}: должна быть YAML-объектом`);
    const chapter = c as Record<string, unknown>;
    const cTitle = getStr(chapter, 'title');
    if (!cTitle) return err(`Глава #${i + 1}: поле title обязательно`);
    const notebook = getStr(chapter, 'notebook');
    if (!notebook) return err(`Глава #${i + 1}: поле notebook обязательно (путь к .nb.json)`);
    const summary = getStr(chapter, 'summary') ?? undefined;
    chapters.push({ title: cTitle, notebook, summary });
  }

  const book: Book = { title, chapters };
  const author = getStr(o, 'author');
  if (author) book.author = author;
  const version = typeof o.version === 'string' ? o.version : typeof o.version === 'number' ? String(o.version) : undefined;
  if (version) book.version = version;
  const description = getStr(o, 'description');
  if (description) book.description = description;

  return { ok: true, value: book };
}

