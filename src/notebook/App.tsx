import { useCallback, useEffect, useMemo, useState } from 'react';
import { Session } from '@core/index';
import { CodeCell } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';
import { TaskCell } from './TaskCell';
import { QueryCell } from './QueryCell';
import { QueryTaskCell } from './QueryTaskCell';
import { NotebooksPanel } from './NotebooksPanel';
import { clearDraft, loadDraft, saveDraft } from './draft';
import { decodeNotebook, encodeNotebook, newCell, starterNotebook } from './serialize';
import { fetchNotebookFromSrc, type NbSource } from './nb-src';
import { loadBookContext, chapterHref, type BookContext } from './book-context';
import { initialMode, setModeInUrl, withStudentMode, type NotebookMode } from './mode';
import type { SolutionMeta } from './git-notebooks';
import { pushSolution, suggestSolutionName } from './git-solutions';
import { errorMessage } from '../app/error-message';
import { GitApiError } from '../app/git-storage';
import type { Cell, Notebook } from './types';
import { loadCatalog } from '../app/catalog';
import { loadGitConfig } from '../app/git-config';
import type { GitConfig } from '../app/git-config';
import { HelpFooter } from '../help/HelpFooter';
import { ToastHost } from '../app/toast/toast';
import { useToast } from '../app/toast/context';

export function App() {
  return (
    <ToastHost>
      <NotebookShell />
    </ToastHost>
  );
}

function NotebookShell() {
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0); // bump — сбросить kernel
  // Конфиг git — только читаем: настройки живут в тренажёре, notebook
  // подхватывает при монтировании. Смена конфига в тренажёре потребует
  // reload вкладки notebook — это ОК для MVP #29.
  const gitCfg = useMemo<GitConfig | null>(() => loadGitConfig(), []);
  const [showPanel, setShowPanel] = useState(false);
  const [currentFile, setCurrentFile] = useState<{ name: string; sha: string } | null>(null);
  // Открыт из ссылки педагога `?nb-src=`. `sha` понадобится в #31 при
  // сохранении решения ученика (snapshot версии репо на момент открытия).
  const [nbSource, setNbSource] = useState<{ source: NbSource; sha: string | null } | null>(null);
  const [refWarnings, setRefWarnings] = useState<string[]>([]);
  // Контекст главы книги (#71): показываем banner «Глава N из M» + prev/next.
  const [bookCtx, setBookCtx] = useState<BookContext | null>(null);
  // Режим (#27): author правит всё, student — только своё решение.
  const [mode, setMode] = useState<NotebookMode>(() => initialMode(window.location.search));
  // Педагог смотрит файл-решение ученика (#32): весь UI в readOnly,
  // banner подсвечивает откуда пришёл исходный урок.
  const [viewingSolution, setViewingSolution] = useState<SolutionMeta | null>(null);
  const readOnly = viewingSolution !== null;
  const catalog = loadCatalog();
  const toast = useToast();
  // Один Session на весь ноутбук. При «Перезапустить kernel» пересоздаём
  // объект (bump epoch): все Code-ячейки автоматом получат свежий kernel
  // через useMemo и очистят свои [N]-метки собственным state'ом ниже.
  const session = useMemo(() => new Session(), [sessionEpoch]);

  // Одноразовая инициализация: nb-src > nb > localStorage draft > starter.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nbSrcParam = params.get('nb-src');
    const nbParam = params.get('nb');
    const bookSrcParam = params.get('book-src');
    const chapterParam = params.get('chapter');
    if (nbSrcParam) {
      fetchNotebookFromSrc(nbSrcParam)
        .then((r) => {
          setNotebook(r.notebook);
          setNbSource({ source: r.source, sha: r.sha });
          setRefWarnings(r.refWarnings);
          if (r.kind === 'solution' && r.solutionMeta) {
            setViewingSolution(r.solutionMeta);
          }
        })
        .catch((e) => {
          setLoadError(`Загрузка из репо: ${errorMessage(e)}`);
          setNotebook(loadDraft() ?? starterNotebook());
        });
      if (bookSrcParam) {
        const hint = chapterParam !== null ? Number.parseInt(chapterParam, 10) : null;
        loadBookContext(bookSrcParam, nbSrcParam, Number.isFinite(hint) ? hint : null).then((res) => {
          if (res.ok) setBookCtx(res.ctx);
        });
      }
      return;
    }
    if (nbParam) {
      decodeNotebook(nbParam)
        .then((nb) => setNotebook(nb))
        .catch((e) => {
          setLoadError(errorMessage(e));
          setNotebook(loadDraft() ?? starterNotebook());
        });
      return;
    }
    setNotebook(loadDraft() ?? starterNotebook());
  }, []);

  // Автосохранение с дебаунсом 500 мс. Первый рендер (notebook null) —
  // не пишем; когда grid установился — начинаем следить за изменениями.
  // При просмотре решения (readOnly) draft НЕ трогаем — это не наш
  // черновик, а чужой файл, не хотим перезаписать свой draft.
  useEffect(() => {
    if (!notebook || readOnly) return;
    const id = window.setTimeout(() => saveDraft(notebook), 500);
    return () => window.clearTimeout(id);
  }, [notebook, readOnly]);

  const updateCell = useCallback((id: string, source: string): void => {
    setNotebook((prev) => {
      if (!prev) return prev;
      return { cells: prev.cells.map((c) => (c.id === id ? { ...c, source } : c)) };
    });
  }, []);

  const updateQueryParameters = useCallback((id: string, parameters: import('../query/parameters').QueryParamEntry[]): void => {
    setNotebook((prev) => {
      if (!prev) return prev;
      return {
        cells: prev.cells.map((c) => (c.id === id && c.type === 'query' ? { ...c, parameters } : c)),
      };
    });
  }, []);

  const updateTaskSpec = useCallback((id: string, task: import('./types').TaskSpec): void => {
    setNotebook((prev) => {
      if (!prev) return prev;
      return { cells: prev.cells.map((c) => (c.id === id && c.type === 'task' ? { ...c, task } : c)) };
    });
  }, []);

  const updateExplanation = useCallback((id: string, explanation: string): void => {
    setNotebook((prev) => {
      if (!prev) return prev;
      return {
        cells: prev.cells.map((c) =>
          c.id === id && (c.type === 'task' || c.type === 'query-task')
            ? { ...c, explanation }
            : c,
        ),
      };
    });
  }, []);

  const addCell = useCallback((type: Cell['type']): void => {
    setNotebook((prev) => {
      if (!prev) return prev;
      // Overload по литеральному типу — TS не резолвит union, поэтому
      // диспатчим руками.
      const created = type === 'task' ? newCell('task')
        : type === 'query' ? newCell('query')
        : type === 'query-task' ? newCell('query-task')
        : newCell(type);
      return { cells: [...prev.cells, created] };
    });
  }, []);

  const removeCell = useCallback((id: string): void => {
    setNotebook((prev) => (prev ? { cells: prev.cells.filter((c) => c.id !== id) } : prev));
  }, []);

  const moveCell = useCallback((id: string, dir: -1 | 1): void => {
    setNotebook((prev) => {
      if (!prev) return prev;
      const idx = prev.cells.findIndex((c) => c.id === id);
      if (idx < 0) return prev;
      const next = idx + dir;
      if (next < 0 || next >= prev.cells.length) return prev;
      const cells = prev.cells.slice();
      const [item] = cells.splice(idx, 1);
      cells.splice(next, 0, item);
      return { cells };
    });
  }, []);

  const handleShare = useCallback(async (): Promise<void> => {
    if (!notebook) return;
    try {
      const encoded = await encodeNotebook(notebook);
      // Педагог делится — ссылка всегда открывается в student-режиме,
      // иначе ученик увидит + Задача и педагогскую механику (#27).
      const rawUrl = `${window.location.origin}${window.location.pathname}?nb=${encoded}`;
      const url = mode === 'author' ? withStudentMode(rawUrl) : rawUrl;
      await navigator.clipboard.writeText(url);
      toast.show(mode === 'author'
        ? 'Ссылка для ученика скопирована'
        : 'Ссылка скопирована');
    } catch {
      toast.show('Не удалось скопировать ссылку', 'error');
    }
  }, [notebook, toast, mode]);

  const handleReset = useCallback((): void => {
    if (!window.confirm('Сбросить ноутбук к стартовому? Твои ячейки потеряются.')) return;
    clearDraft();
    setNotebook(starterNotebook());
  }, []);

  const handleSendToTeacher = useCallback(async (): Promise<void> => {
    if (!notebook || !nbSource) return;
    if (!gitCfg) {
      toast.show('Подключи свой git-репо в тренажёре (кнопка Git)', 'error');
      return;
    }
    const suggested = suggestSolutionName(nbSource.source.path);
    const name = window.prompt(
      'Имя файла решения (без .nb.json). Файл ляжет в solutions/ твоего репо.',
      suggested,
    );
    if (!name) return;
    try {
      const r = await pushSolution(gitCfg, name, notebook, nbSource.source, nbSource.sha, null);
      await navigator.clipboard.writeText(r.rawUrl);
      toast.show(`Решение отправлено. Ссылка в буфере — отдай педагогу.`);
    } catch (e) {
      if (e instanceof GitApiError) {
        toast.show(`GitHub ${e.status}: ${e.message}`, 'error');
      } else {
        toast.show(`Не удалось сохранить: ${errorMessage(e)}`, 'error');
      }
    }
  }, [notebook, nbSource, gitCfg, toast]);

  const handleRestartKernel = useCallback((): void => {
    // Kernel-only: ячейки и их источник остаются, но переменные и процедуры
    // забываются; счётчик [N] у каждой ячейки очищается через sessionEpoch.
    setSessionEpoch((e) => e + 1);
    toast.show('Переменные и процедуры забыты', 'info');
  }, [toast]);

  if (!notebook) {
    return <div className="nb-loading">Загрузка ноутбука…</div>;
  }

  return (
    <div className="nb-app">
      <header className="nb-header">
        <div className="nb-header__brand">
          <span className="nb-header__logo">BSLexicon</span>
          <span className="nb-header__sub">ноутбук BSL</span>
        </div>
        <nav className="nb-header__nav">
          <a href={import.meta.env.BASE_URL} title="К режимам">↑ Режимы</a>
          <a href={`${import.meta.env.BASE_URL}trainer/`} title="Тренажёр">Тренажёр</a>
          <a href={`${import.meta.env.BASE_URL}query/`} title="Песочница запросов">Запросы</a>
          <a href={`${import.meta.env.BASE_URL}help/`} title="Справочник">Справочник</a>
          <a href={`${import.meta.env.BASE_URL}help/judge/`} title="Задачи">Задачник</a>
        </nav>
        <div className="nb-header__actions">
          {readOnly && (
            <span className="nb-header__mode">🔍 Просмотр решения</span>
          )}
          {!readOnly && (
            <div className="nb-mode-toggle" role="group" aria-label="Режим ноутбука">
              <button
                type="button"
                className={'nb-mode-toggle__btn' + (mode === 'author' ? ' nb-mode-toggle__btn--active' : '')}
                onClick={() => { setMode('author'); setModeInUrl('author'); }}
                title="Педагог редактирует всё"
              >
                👨‍🏫 Педагог
              </button>
              <button
                type="button"
                className={'nb-mode-toggle__btn' + (mode === 'student' ? ' nb-mode-toggle__btn--active' : '')}
                onClick={() => { setMode('student'); setModeInUrl('student'); }}
                title="Ученик — только своё решение"
              >
                👨‍🎓 Ученик
              </button>
            </div>
          )}
          {gitCfg && !readOnly && (
            <button
              type="button"
              className="nb-btn nb-btn--ghost"
              onClick={() => setShowPanel(true)}
              title={`Ноутбуки в ${gitCfg.owner}/${gitCfg.repo}`}
            >
              📁 Мои ноутбуки
            </button>
          )}
          {nbSource && !readOnly && (
            <button
              type="button"
              className="nb-btn"
              onClick={handleSendToTeacher}
              title="Сохранить в свой репо и отдать педагогу ссылку"
            >
              📤 Отправить педагогу
            </button>
          )}
          {!readOnly && (
            <>
              <button type="button" className="nb-btn" onClick={handleShare} title="Скопировать ссылку на ноутбук">
                🔗 Поделиться
              </button>
              <button
                type="button"
                className="nb-btn nb-btn--ghost"
                onClick={handleRestartKernel}
                title="Забыть все переменные и процедуры; ячейки останутся"
              >
                ↻ Забыть переменные
              </button>
              <button type="button" className="nb-btn nb-btn--ghost" onClick={handleReset} title="Стартовый ноутбук">
                Сбросить
              </button>
            </>
          )}
        </div>
      </header>

      {loadError && (
        <div className="nb-error-banner">
          Не удалось загрузить ноутбук из ссылки — показан стартовый. ({loadError})
        </div>
      )}

      {bookCtx && !viewingSolution && (
        <div className="nb-chapter-banner">
          <div className="nb-chapter-banner__meta">
            📖 <b>{bookCtx.book.title}</b> · Глава {bookCtx.chapterIndex + 1} из {bookCtx.book.chapters.length} · {bookCtx.chapter.title}
          </div>
          <div className="nb-chapter-banner__nav">
            {bookCtx.chapterIndex > 0 ? (
              <a
                className="nb-chapter-banner__link"
                href={chapterHref(import.meta.env.BASE_URL, bookCtx.bookSrcUrl, bookCtx.book, bookCtx.chapterIndex - 1)}
                title={bookCtx.book.chapters[bookCtx.chapterIndex - 1].title}
              >
                ← {bookCtx.book.chapters[bookCtx.chapterIndex - 1].title}
              </a>
            ) : (
              <span className="nb-chapter-banner__link nb-chapter-banner__link--disabled">← Начало книги</span>
            )}
            <a
              className="nb-chapter-banner__toc"
              href={`${import.meta.env.BASE_URL}book/?src=${encodeURIComponent(bookCtx.bookSrcUrl)}`}
              title="Оглавление книги"
            >
              📚 Оглавление
            </a>
            {bookCtx.chapterIndex < bookCtx.book.chapters.length - 1 ? (
              <a
                className="nb-chapter-banner__link"
                href={chapterHref(import.meta.env.BASE_URL, bookCtx.bookSrcUrl, bookCtx.book, bookCtx.chapterIndex + 1)}
                title={bookCtx.book.chapters[bookCtx.chapterIndex + 1].title}
              >
                {bookCtx.book.chapters[bookCtx.chapterIndex + 1].title} →
              </a>
            ) : (
              <span className="nb-chapter-banner__link nb-chapter-banner__link--disabled">Конец книги →</span>
            )}
          </div>
        </div>
      )}

      {nbSource && !viewingSolution && (
        <div className="nb-source-banner">
          📚 Из репо педагога:{' '}
          <a
            href={`https://github.com/${nbSource.source.owner}/${nbSource.source.repo}/blob/${nbSource.source.branch}/${nbSource.source.path}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {nbSource.source.owner}/{nbSource.source.repo}
          </a>
          {nbSource.sha && (
            <span className="nb-source-banner__sha" title="SHA коммита ветки на момент открытия">
              @ {nbSource.sha.slice(0, 7)}
            </span>
          )}
          {refWarnings.length > 0 && (
            <details className="nb-source-banner__warnings">
              <summary>⚠ Задачи с проблемами: {refWarnings.length}</summary>
              <ul>
                {refWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      {viewingSolution && (
        <div className="nb-source-banner nb-source-banner--solution">
          🎓 Решение ученика · исходный урок:{' '}
          <a
            href={`https://github.com/${viewingSolution.repo}/blob/${viewingSolution.branch}/${viewingSolution.nb_path}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {viewingSolution.repo}/{viewingSolution.nb_path}
          </a>
          {viewingSolution.sha && (
            <span className="nb-source-banner__sha" title="SHA ветки педагога на момент когда ученик открыл">
              @ {viewingSolution.sha.slice(0, 7)}
            </span>
          )}
          <span className="nb-source-banner__hint">
            Тесты идут против snapshot'а, а не свежего HEAD.
          </span>
        </div>
      )}

      <main className="nb-main">
        {notebook.cells.length === 0 && (
          <div className="nb-empty">
            Ноутбук пуст. Добавь первую ячейку кнопками ниже.
          </div>
        )}

        {notebook.cells.map((cell) => {
          const cellReadOnly = readOnly || !!cell.frozen;
          // В student-режиме markdown — это условие/пояснение, ученик его не правит.
          const mdReadOnly = cellReadOnly || mode === 'student';
          // В student-режиме педагогская механика (переставить/удалить) выключена.
          const authorControls = !readOnly && mode === 'author';
          return (
          <div key={cell.id} className={'nb-cell-slot' + (cell.frozen ? ' nb-cell-slot--frozen' : '')}>
            {authorControls && (
              <div className="nb-cell-controls">
                <button type="button" className="nb-cell-ctl" onClick={() => moveCell(cell.id, -1)} title="Вверх" aria-label="Вверх">↑</button>
                <button type="button" className="nb-cell-ctl" onClick={() => moveCell(cell.id, 1)} title="Вниз" aria-label="Вниз">↓</button>
                <button type="button" className="nb-cell-ctl nb-cell-ctl--danger" onClick={() => removeCell(cell.id)} title="Удалить" aria-label="Удалить">✕</button>
              </div>
            )}
            {cell.frozen && (
              <div className="nb-cell-frozen-mark" title="Ячейка заморожена автором — редактирование запрещено">🔒</div>
            )}
            {cell.type === 'markdown' && (
              <MarkdownCell source={cell.source} onChange={(v) => updateCell(cell.id, v)} readOnly={mdReadOnly} />
            )}
            {cell.type === 'code' && (
              <CodeCell
                source={cell.source}
                onChange={(v) => updateCell(cell.id, v)}
                catalog={catalog}
                session={session}
                sessionEpoch={sessionEpoch}
                readOnly={cellReadOnly}
                autorun={cell.autorun}
              />
            )}
            {cell.type === 'task' && (
              <TaskCell
                source={cell.source}
                onChange={(v) => updateCell(cell.id, v)}
                catalog={catalog}
                task={cell.task}
                taskRef={cell.ref}
                showRefPlaceholder={!!cell.ref && !nbSource}
                readOnly={cellReadOnly}
                explanation={cell.explanation}
                onExplanationChange={(v) => updateExplanation(cell.id, v)}
                onTaskChange={mode === 'author' && !readOnly ? (t) => updateTaskSpec(cell.id, t) : undefined}
              />
            )}
            {cell.type === 'query' && (
              <QueryCell
                source={cell.source}
                schema={cell.schema}
                data={cell.data}
                onChange={(v) => updateCell(cell.id, v)}
                parameters={cell.parameters}
                onParametersChange={(v) => updateQueryParameters(cell.id, v)}
                readOnly={cellReadOnly}
                ref={cell.ref}
                showRefPlaceholder={!!cell.ref && !nbSource}
                autorun={cell.autorun}
              />
            )}
            {cell.type === 'query-task' && (
              <QueryTaskCell
                source={cell.source}
                onChange={(v) => updateCell(cell.id, v)}
                task={cell.task}
                ref={cell.ref}
                showRefPlaceholder={!!cell.ref && !nbSource}
                readOnly={cellReadOnly}
                explanation={cell.explanation}
                onExplanationChange={(v) => updateExplanation(cell.id, v)}
              />
            )}
          </div>
          );
        })}

        {!readOnly && mode === 'author' && (
          <div className="nb-add">
            <button type="button" className="nb-btn nb-btn--add" onClick={() => addCell('markdown')}>
              + Текст
            </button>
            <button type="button" className="nb-btn nb-btn--add" onClick={() => addCell('code')}>
              + Код
            </button>
            <button type="button" className="nb-btn nb-btn--add" onClick={() => addCell('task')}>
              + Задача
            </button>
            <button type="button" className="nb-btn nb-btn--add" onClick={() => addCell('query')}>
              + Запрос
            </button>
            <button type="button" className="nb-btn nb-btn--add" onClick={() => addCell('query-task')}>
              + Задача-запрос
            </button>
          </div>
        )}
      </main>

      <HelpFooter hint="Клик по тексту — редактирование · ▶ — запуск ячейки" />

      {showPanel && gitCfg && (
        <NotebooksPanel
          cfg={gitCfg}
          current={notebook}
          currentFile={currentFile}
          onOpen={(loaded) => {
            setNotebook(loaded.notebook);
            setCurrentFile({ name: loaded.name, sha: loaded.sha });
            toast.show(`Открыт «${loaded.name}»`);
          }}
          onSaved={(name, sha) => {
            setCurrentFile({ name, sha });
            toast.show(`Сохранено «${name}»`);
          }}
          onClose={() => setShowPanel(false)}
        />
      )}
    </div>
  );
}

