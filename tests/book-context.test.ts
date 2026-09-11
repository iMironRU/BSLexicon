/**
 * Тесты #71: контекст главы книги в notebook — определение текущей главы,
 * формирование URL для prev/next.
 */
import { describe, expect, it } from 'vitest';
import { chapterHref, loadBookContext, resolveNotebookUrl } from '../src/notebook/book-context';

const BOOK_URL = 'https://raw.githubusercontent.com/x/y/main/book.yaml';
const BOOK_YAML = `title: Тестовая книга
version: "0.1"
chapters:
  - title: Введение
    notebook: notebooks/01-intro.nb.json
  - title: Основы
    notebook: notebooks/02-basics.nb.json
  - title: Итог
    notebook: notebooks/99-final.nb.json
`;

function mockFetch(text: string, status = 200): typeof fetch {
  return (async () => new Response(text, { status })) as typeof fetch;
}

describe('resolveNotebookUrl', () => {
  it('склеивает notebook path относительно book.yaml', () => {
    expect(resolveNotebookUrl(BOOK_URL, 'notebooks/01.nb.json'))
      .toBe('https://raw.githubusercontent.com/x/y/main/notebooks/01.nb.json');
  });

  it('убирает ведущий ./', () => {
    expect(resolveNotebookUrl(BOOK_URL, './notebooks/01.nb.json'))
      .toBe('https://raw.githubusercontent.com/x/y/main/notebooks/01.nb.json');
  });
});

describe('loadBookContext', () => {
  it('находит главу по совпадению URL', async () => {
    const nbUrl = 'https://raw.githubusercontent.com/x/y/main/notebooks/02-basics.nb.json';
    const res = await loadBookContext(BOOK_URL, nbUrl, null, mockFetch(BOOK_YAML));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ctx.chapterIndex).toBe(1);
    expect(res.ctx.chapter.title).toBe('Основы');
  });

  it('чтит hint если он совпадает с URL', async () => {
    const nbUrl = 'https://raw.githubusercontent.com/x/y/main/notebooks/01-intro.nb.json';
    const res = await loadBookContext(BOOK_URL, nbUrl, 0, mockFetch(BOOK_YAML));
    if (!res.ok) throw new Error(res.error);
    expect(res.ctx.chapterIndex).toBe(0);
  });

  it('игнорирует hint, если он не совпадает — ищет по URL', async () => {
    const nbUrl = 'https://raw.githubusercontent.com/x/y/main/notebooks/99-final.nb.json';
    const res = await loadBookContext(BOOK_URL, nbUrl, 0, mockFetch(BOOK_YAML));
    if (!res.ok) throw new Error(res.error);
    expect(res.ctx.chapterIndex).toBe(2);
  });

  it('главы нет в оглавлении → ошибка', async () => {
    const nbUrl = 'https://raw.githubusercontent.com/x/y/main/notebooks/left-over.nb.json';
    const res = await loadBookContext(BOOK_URL, nbUrl, null, mockFetch(BOOK_YAML));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/не найдена/i);
  });

  it('битый book.yaml → сообщение об ошибке', async () => {
    const res = await loadBookContext(BOOK_URL, 'x', null, mockFetch('title: X'));
    expect(res.ok).toBe(false);
  });

  it('404 → HTTP-ошибка', async () => {
    const res = await loadBookContext(BOOK_URL, 'x', null, mockFetch('', 404));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/HTTP 404/);
  });
});

describe('chapterHref', () => {
  it('собирает полный URL со всеми параметрами', async () => {
    const res = await loadBookContext(
      BOOK_URL,
      'https://raw.githubusercontent.com/x/y/main/notebooks/01-intro.nb.json',
      null,
      mockFetch(BOOK_YAML),
    );
    if (!res.ok) throw new Error(res.error);
    const href = chapterHref(BOOK_URL, res.ctx.book, 1);
    // vitest env: BASE_URL из vite.config.ts не подставляется, дефолт '/'
    expect(href).toContain('notebook/');
    expect(decodeURIComponent(href)).toContain('nb-src=https://raw.githubusercontent.com/x/y/main/notebooks/02-basics.nb.json');
    expect(decodeURIComponent(href)).toContain('book-src=https://raw.githubusercontent.com/x/y/main/book.yaml');
    expect(href).toContain('chapter=1');
  });
});
