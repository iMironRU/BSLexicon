import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../app/error-message';
import type { GitConfig } from '../app/git-config';
import { GitApiError } from '../app/git-storage';
import {
  listNotebooks,
  loadNotebook,
  saveNotebook,
  validateNotebookName,
  type GitNotebookFile,
  type LoadedNotebook,
} from './git-notebooks';
import type { Notebook } from './types';

interface NotebooksPanelProps {
  cfg: GitConfig;
  /** Текущий ноутбук — для «↑ Push» / «Сохранить как». */
  current: Notebook;
  /** Уже открытый файл: имя + sha. null = черновик, не привязан к файлу. */
  currentFile: { name: string; sha: string } | null;
  onOpen: (loaded: LoadedNotebook) => void;
  onSaved: (name: string, sha: string) => void;
  onClose: () => void;
}

/**
 * Панель управления файлами `.nb.json` в git-репо педагога.
 * Показывает список из `notebooks/`, позволяет открыть / сохранить как / push.
 *
 * Не рендерится сама по себе — вызывается из App при клике «📁 Мои ноутбуки»,
 * закрывается по крестику или клику вне.
 */
export function NotebooksPanel({
  cfg,
  current,
  currentFile,
  onOpen,
  onSaved,
  onClose,
}: NotebooksPanelProps) {
  const [files, setFiles] = useState<GitNotebookFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    setFiles(null);
    try {
      const list = await listNotebooks(cfg);
      setFiles(list);
    } catch (e) {
      setError(errText(e));
      setFiles([]);
    }
  }, [cfg]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleOpen = async (name: string): Promise<void> => {
    setBusy(`open:${name}`);
    setError(null);
    try {
      const loaded = await loadNotebook(cfg, name);
      if (!loaded) {
        setError(`Файл «${name}» не найден в репо — обнови список.`);
      } else {
        onOpen(loaded);
        onClose();
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const handleSaveAs = async (): Promise<void> => {
    const name = window.prompt('Имя нового ноутбука (без .nb.json):', 'lesson-new');
    if (!name) return;
    const err = validateNotebookName(name);
    if (err) { setError(err); return; }
    if (files?.some((f) => f.name === name)) {
      if (!window.confirm(`«${name}» уже есть в репо. Перезаписать?`)) return;
      const existing = files.find((f) => f.name === name)!;
      await doSave(name, existing.sha);
      return;
    }
    await doSave(name, null);
  };

  const handlePush = async (): Promise<void> => {
    if (!currentFile) return;
    await doSave(currentFile.name, currentFile.sha);
  };

  const doSave = async (name: string, prevSha: string | null): Promise<void> => {
    setBusy(`save:${name}`);
    setError(null);
    try {
      const r = await saveNotebook(cfg, name, current, prevSha);
      onSaved(name, r.sha);
      await reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="nb-panel-backdrop" onClick={onClose}>
      <div className="nb-panel" onClick={(e) => e.stopPropagation()}>
        <div className="nb-panel__head">
          <h2>📁 Мои ноутбуки</h2>
          <div className="nb-panel__repo" title={`${cfg.owner}/${cfg.repo}, ветка ${cfg.branch}`}>
            {cfg.owner}/{cfg.repo}
          </div>
          <button type="button" className="nb-panel__close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        {error && <div className="nb-panel__error">{error}</div>}

        <div className="nb-panel__toolbar">
          <button type="button" className="nb-btn nb-btn--add" onClick={handleSaveAs} disabled={!!busy}>
            💾 Сохранить как…
          </button>
          {currentFile && (
            <button type="button" className="nb-btn" onClick={handlePush} disabled={!!busy}>
              ↑ Push ({currentFile.name})
            </button>
          )}
          <button type="button" className="nb-btn nb-btn--ghost" onClick={reload} disabled={!!busy}>
            ↻ Обновить
          </button>
        </div>

        {files === null ? (
          <div className="nb-panel__loading">Загрузка списка…</div>
        ) : files.length === 0 ? (
          <div className="nb-panel__empty">
            В <code>notebooks/</code> пока пусто. Сохрани текущий ноутбук через «💾 Сохранить как…».
          </div>
        ) : (
          <ul className="nb-panel__list">
            {files.map((f) => {
              const isCurrent = currentFile?.name === f.name;
              const isBusy = busy === `open:${f.name}`;
              return (
                <li key={f.name} className={`nb-panel__item${isCurrent ? ' nb-panel__item--current' : ''}`}>
                  <button
                    type="button"
                    className="nb-panel__item-btn"
                    onClick={() => handleOpen(f.name)}
                    disabled={!!busy}
                  >
                    <span className="nb-panel__item-name">{f.name}</span>
                    <span className="nb-panel__item-meta">
                      {isCurrent && <span className="nb-panel__badge">открыт</span>}
                      {f.size !== undefined && <span>{formatSize(f.size)}</span>}
                      {isBusy && <span>…</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  if (e instanceof GitApiError) return `GitHub ${e.status}: ${e.message}`;
  return errorMessage(e);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
