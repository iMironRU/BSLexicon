/**
 * Контекст главы книги (#71): если notebook открыт с параметрами
 * `?book-src=<book.yaml-url>&chapter=<idx>`, показываем banner
 * «Глава N из M» с prev/next кнопками.
 *
 * Определение текущей главы:
 *  1. `chapter` из URL — hint, но проверяется на диапазон
 *  2. Если hint битый, ищем главу, `notebook` которой совпадает
 *     с `nb-src` (после resolveNotebookUrl)
 */
import { parseBookYaml, type Book } from '../book/book-format';
import { errorMessage } from '../app/error-message';
import { NOTEBOOK_URL } from '../app/urls';

export interface BookContext {
  book: Book;
  bookSrcUrl: string;
  chapterIndex: number;
  chapter: import('../book/book-format').BookChapter;
}

export async function loadBookContext(
  bookSrcUrl: string,
  currentNbSrcUrl: string,
  chapterHint: number | null,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; ctx: BookContext } | { ok: false; error: string }> {
  try {
    const r = await fetchFn(bookSrcUrl);
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    const text = await r.text();
    const parsed = parseBookYaml(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const book = parsed.value;

    let idx = -1;
    if (chapterHint !== null && chapterHint >= 0 && chapterHint < book.chapters.length) {
      const expected = resolveNotebookUrl(bookSrcUrl, book.chapters[chapterHint].notebook);
      if (expected === currentNbSrcUrl) idx = chapterHint;
    }
    if (idx < 0) {
      // Ищем главу по совпадению resolved URL
      for (let i = 0; i < book.chapters.length; i += 1) {
        if (resolveNotebookUrl(bookSrcUrl, book.chapters[i].notebook) === currentNbSrcUrl) {
          idx = i;
          break;
        }
      }
    }
    if (idx < 0) return { ok: false, error: 'Текущая глава не найдена в оглавлении книги' };
    return { ok: true, ctx: { book, bookSrcUrl, chapterIndex: idx, chapter: book.chapters[idx] } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** notebook path в book.yaml — относительно директории самого book.yaml. */
export function resolveNotebookUrl(bookYamlUrl: string, notebook: string): string {
  try {
    const u = new URL(bookYamlUrl);
    const parts = u.pathname.split('/');
    parts.pop(); // отбросить имя файла book.yaml
    const basePath = parts.join('/');
    const clean = notebook.replace(/^\.?\/*/, '');
    return `${u.origin}${basePath}/${clean}`;
  } catch {
    return notebook;
  }
}

/** Собирает URL notebook-страницы для указанной главы. */
export function chapterHref(bookSrcUrl: string, book: Book, chapterIndex: number): string {
  const ch = book.chapters[chapterIndex];
  const nbUrl = resolveNotebookUrl(bookSrcUrl, ch.notebook);
  const params = new URLSearchParams({
    'nb-src': nbUrl,
    'book-src': bookSrcUrl,
    chapter: String(chapterIndex),
  });
  return `${NOTEBOOK_URL}?${params.toString()}`;
}
