import { useCallback, useEffect, useMemo, useState } from 'react';
import { Session } from '@core/index';
import { CodeCell } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';
import { TaskCell } from './TaskCell';
import { NotebooksPanel } from './NotebooksPanel';
import { clearDraft, loadDraft, saveDraft } from './draft';
import { decodeNotebook, encodeNotebook, newCell, starterNotebook } from './serialize';
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
  const catalog = loadCatalog();
  const toast = useToast();
  // Один Session на весь ноутбук. При «Перезапустить kernel» пересоздаём
  // объект (bump epoch): все Code-ячейки автоматом получат свежий kernel
  // через useMemo и очистят свои [N]-метки собственным state'ом ниже.
  const session = useMemo(() => new Session(), [sessionEpoch]);

  // Одноразовая инициализация: URL > localStorage draft > starter.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nbParam = params.get('nb');
    if (nbParam) {
      decodeNotebook(nbParam)
        .then((nb) => setNotebook(nb))
        .catch((e) => {
          setLoadError(String(e));
          setNotebook(loadDraft() ?? starterNotebook());
        });
      return;
    }
    setNotebook(loadDraft() ?? starterNotebook());
  }, []);

  // Автосохранение с дебаунсом 500 мс. Первый рендер (notebook null) —
  // не пишем; когда grid установился — начинаем следить за изменениями.
  useEffect(() => {
    if (!notebook) return;
    const id = window.setTimeout(() => saveDraft(notebook), 500);
    return () => window.clearTimeout(id);
  }, [notebook]);

  const updateCell = useCallback((id: string, source: string): void => {
    setNotebook((prev) => {
      if (!prev) return prev;
      return { cells: prev.cells.map((c) => (c.id === id ? { ...c, source } : c)) };
    });
  }, []);

  const addCell = useCallback((type: Cell['type']): void => {
    setNotebook((prev) => {
      if (!prev) return prev;
      // Overload по литеральному типу — TS не резолвит union, поэтому
      // диспатчим руками.
      const created = type === 'task' ? newCell('task') : newCell(type);
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
      const url = `${window.location.origin}${window.location.pathname}?nb=${encoded}`;
      await navigator.clipboard.writeText(url);
      toast.show('Ссылка скопирована');
    } catch (e) {
      toast.show('Не удалось скопировать ссылку', 'error');
    }
  }, [notebook, toast]);

  const handleReset = useCallback((): void => {
    if (!window.confirm('Сбросить ноутбук к стартовому? Твои ячейки потеряются.')) return;
    clearDraft();
    setNotebook(starterNotebook());
  }, []);

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
          <a href={import.meta.env.BASE_URL} title="Тренажёр">Тренажёр</a>
          <a href={`${import.meta.env.BASE_URL}help/`} title="Справочник">Справочник</a>
          <a href={`${import.meta.env.BASE_URL}help/judge/`} title="Задачи">Задачи</a>
        </nav>
        <div className="nb-header__actions">
          {gitCfg && (
            <button
              type="button"
              className="nb-btn nb-btn--ghost"
              onClick={() => setShowPanel(true)}
              title={`Ноутбуки в ${gitCfg.owner}/${gitCfg.repo}`}
            >
              📁 Мои ноутбуки
            </button>
          )}
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
        </div>
      </header>

      {loadError && (
        <div className="nb-error-banner">
          Не удалось загрузить ноутбук из ссылки — показан стартовый. ({loadError})
        </div>
      )}

      <main className="nb-main">
        {notebook.cells.length === 0 && (
          <div className="nb-empty">
            Ноутбук пуст. Добавь первую ячейку кнопками ниже.
          </div>
        )}

        {notebook.cells.map((cell) => (
          <div key={cell.id} className="nb-cell-slot">
            <div className="nb-cell-controls">
              <button type="button" className="nb-cell-ctl" onClick={() => moveCell(cell.id, -1)} title="Вверх" aria-label="Вверх">↑</button>
              <button type="button" className="nb-cell-ctl" onClick={() => moveCell(cell.id, 1)} title="Вниз" aria-label="Вниз">↓</button>
              <button type="button" className="nb-cell-ctl nb-cell-ctl--danger" onClick={() => removeCell(cell.id)} title="Удалить" aria-label="Удалить">✕</button>
            </div>
            {cell.type === 'markdown' && (
              <MarkdownCell source={cell.source} onChange={(v) => updateCell(cell.id, v)} />
            )}
            {cell.type === 'code' && (
              <CodeCell
                source={cell.source}
                onChange={(v) => updateCell(cell.id, v)}
                catalog={catalog}
                session={session}
                sessionEpoch={sessionEpoch}
              />
            )}
            {cell.type === 'task' && (
              <TaskCell
                source={cell.source}
                onChange={(v) => updateCell(cell.id, v)}
                catalog={catalog}
                task={cell.task}
                taskRef={cell.ref}
              />
            )}
          </div>
        ))}

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
        </div>
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

