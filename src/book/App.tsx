/**
 * /book/ — стартовая страница книги (#61).
 *
 * URL: `/book/?src=<raw-url-к-book.yaml>`. Загружаем YAML, парсим,
 * рендерим оглавление. Каждая глава — карточка с кнопкой «Открыть»,
 * которая ведёт на /notebook/?nb-src=... с уже собранным URL к
 * `.nb.json`.
 *
 * Без React-роутера: одна страница, минимальный вес.
 */
import { useEffect, useState } from 'react';
import { parseBookYaml, type Book, type BookChapter } from './book-format';
import { renderMarkdown } from '../notebook/markdown';

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; src: string }
  | { kind: 'ok'; src: string; book: Book }
  | { kind: 'error'; src: string; message: string };

export function BookApp() {
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const src = params.get('src');
    if (!src) return;
    setState({ kind: 'loading', src });
    fetch(src)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        const parsed = parseBookYaml(text);
        if (!parsed.ok) throw new Error(parsed.error);
        setState({ kind: 'ok', src, book: parsed.value });
      })
      .catch((e) => setState({ kind: 'error', src, message: (e as Error).message }));
  }, []);

  return (
    <div className="book-app">
      <header className="book-header">
        <a className="book-logo" href={import.meta.env.BASE_URL} title="К режимам">
          BSLexicon
        </a>
        <span className="book-tagline">книга</span>
        <nav className="book-nav">
          <a href={import.meta.env.BASE_URL}>↑ Режимы</a>
          <a href={`${import.meta.env.BASE_URL}trainer/`}>Тренажёр</a>
          <a href={`${import.meta.env.BASE_URL}notebook/`}>Ноутбук</a>
          <a href={`${import.meta.env.BASE_URL}help/`}>Справочник</a>
        </nav>
      </header>

      <main className="book-main">
        {state.kind === 'idle' && <HowTo />}
        {state.kind === 'loading' && <div className="book-loading">Загрузка книги…</div>}
        {state.kind === 'error' && (
          <div className="book-error">
            <h2>Не удалось загрузить книгу</h2>
            <p>{state.message}</p>
            <p>
              Источник: <code>{state.src}</code>
            </p>
            <HowTo />
          </div>
        )}
        {state.kind === 'ok' && <BookView book={state.book} src={state.src} />}
      </main>
    </div>
  );
}

function BookView({ book, src }: { book: Book; src: string }) {
  return (
    <article className="book-view">
      <header className="book-view__head">
        <h1 className="book-view__title">{book.title}</h1>
        <div className="book-view__meta">
          {book.author && <span>Автор: <b>{book.author}</b></span>}
          {book.version && <span>Версия: <b>{book.version}</b></span>}
          <span>Глав: <b>{book.chapters.length}</b></span>
        </div>
        {book.description && (
          <div className="book-view__desc">{renderMarkdown(book.description)}</div>
        )}
      </header>

      <ol className="book-toc">
        {book.chapters.map((ch, i) => (
          <li key={i} className="book-toc__item">
            <div className="book-toc__number">{String(i + 1).padStart(2, '0')}</div>
            <div className="book-toc__body">
              <h2 className="book-toc__title">{ch.title}</h2>
              {ch.summary && <p className="book-toc__summary">{ch.summary}</p>}
              <a
                className="book-toc__open"
                href={openChapterHref(src, ch, i)}
                title="Открыть главу в ноутбуке"
              >
                ▶ Открыть главу
              </a>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

function HowTo() {
  return (
    <div className="book-howto">
      <h2>Открыть книгу</h2>
      <p>
        В строке адреса должен быть параметр <code>?src=</code> с raw-URL к файлу{' '}
        <code>book.yaml</code> в git-репо книги.
      </p>
      <p>Пример:</p>
      <pre>
        {`/book/?src=https://raw.githubusercontent.com/iMironRU/1c-reading-queries/main/book.yaml`}
      </pre>
      <p>
        Формат <code>book.yaml</code> — <code>title</code>, <code>chapters</code>{' '}
        (список <code>{'{title, notebook}'}</code>). Полное описание{' '}
        <a href="https://github.com/iMironRU/BSLexicon/issues/61">в issue #61</a>.
      </p>
    </div>
  );
}

/**
 * Формирует ссылку «Открыть главу»: путь к `.nb.json` в книге →
 * raw-URL → `/notebook/?nb-src=<encoded>&book-src=<bookYaml>&chapter=<idx>`.
 * Параметры `book-src` и `chapter` включают навигацию Prev/Next в notebook
 * (issue #71).
 */
function openChapterHref(bookYamlUrl: string, chapter: BookChapter, chapterIndex: number): string {
  const notebookRawUrl = resolveNotebookUrl(bookYamlUrl, chapter.notebook);
  const base = import.meta.env.BASE_URL;
  const params = new URLSearchParams({
    'nb-src': notebookRawUrl,
    'book-src': bookYamlUrl,
    chapter: String(chapterIndex),
  });
  return `${base}notebook/?${params.toString()}`;
}

/** notebook path в book.yaml — относительно директории самого book.yaml. */
function resolveNotebookUrl(bookYamlUrl: string, notebook: string): string {
  try {
    const u = new URL(bookYamlUrl);
    const parts = u.pathname.split('/');
    parts.pop(); // отбросить имя файла book.yaml
    const basePath = parts.join('/');
    // notebook — относительный путь; предполагаем без ./ префикса
    const clean = notebook.replace(/^\.?\/*/, '');
    return `${u.origin}${basePath}/${clean}`;
  } catch {
    return notebook;
  }
}
