import { useEffect, useRef, useState } from 'react';
import type { GitConfig } from '../git-config';
import { GitApiError, readFile, snippetsFilePath, writeFile } from '../git-storage';
import {
  deleteSnippet,
  exportAll,
  importAll,
  listSnippets,
  saveSnippet,
  type Snippet,
} from '../snippets';

interface SnippetsMenuProps {
  /** Текущий код редактора — попадает в «Сохранить как…». */
  currentCode: string;
  /** Загрузить сниппет в редактор. */
  onLoad: (code: string) => void;
  /** Настройки подключения к GitHub (null — не подключено). */
  gitCfg: GitConfig | null;
}

/**
 * Кнопка «📂 Мои» в шапке тренажёра. Открывает поповер:
 *  • строка «Сохранить как…» — ввод имени + кнопка;
 *  • список сохранённых (клик = загрузить, крестик = удалить);
 *  • «⬇ Экспорт» скачивает JSON, «⬆ Импорт» — читает файл.
 * Всё хранится в localStorage через `snippets.ts`.
 */
export function SnippetsMenu({ currentCode, onLoad, gitCfg }: SnippetsMenuProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Snippet[]>(() => (canUseStorage() ? listSnippets() : []));
  const [name, setName] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Пере-читать список при каждом открытии — на случай если параллельная
  // вкладка что-то дописала.
  useEffect(() => {
    if (open) setItems(listSnippets());
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!flash) return undefined;
    const id = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(id);
  }, [flash]);

  const handleSave = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveSnippet(trimmed, currentCode);
    setName('');
    setItems(listSnippets());
    setFlash(`Сохранён: ${trimmed}`);
  };

  const handleDelete = (id: string, snippetName: string): void => {
    if (!window.confirm(`Удалить сниппет «${snippetName}»?`)) return;
    deleteSnippet(id);
    setItems(listSnippets());
  };

  const handleExport = (): void => {
    const json = exportAll(items);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `bslexicon-snippets-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = (): void => fileRef.current?.click();

  const handlePushGit = async (): Promise<void> => {
    if (!gitCfg) return;
    setSyncing(true);
    try {
      const filePath = snippetsFilePath(gitCfg);
      const existing = await readFile(gitCfg, filePath);
      const body = exportAll(listSnippets());
      const msg = `BSLexicon: sync ${items.length} snippet${items.length === 1 ? '' : 's'}`;
      await writeFile(gitCfg, filePath, body, msg, existing?.sha ?? null);
      setFlash(`↑ Отправлено в ${gitCfg.owner}/${gitCfg.repo}`);
    } catch (e) {
      const m = e instanceof GitApiError ? e.message : (e as Error).message;
      setFlash(`Ошибка push: ${m}`);
    } finally {
      setSyncing(false);
    }
  };

  const handlePullGit = async (): Promise<void> => {
    if (!gitCfg) return;
    if (items.length > 0 && !window.confirm('Загрузка из git заменит текущий список сниппетов. Продолжить?')) return;
    setSyncing(true);
    try {
      const filePath = snippetsFilePath(gitCfg);
      const existing = await readFile(gitCfg, filePath);
      if (!existing) {
        setFlash(`В репо ещё нет ${filePath}. Сначала «↑ В git».`);
        return;
      }
      const result = importAll(existing.text, 'replace');
      if (result.error) {
        setFlash(`Ошибка pull: ${result.error}`);
        return;
      }
      setItems(listSnippets());
      setFlash(`↓ Загружено из ${gitCfg.owner}/${gitCfg.repo}: ${result.added} шт.`);
    } catch (e) {
      const m = e instanceof GitApiError ? e.message : (e as Error).message;
      setFlash(`Ошибка pull: ${m}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = importAll(text, 'merge');
    e.target.value = ''; // сброс, чтобы можно было выбрать тот же файл повторно
    if (result.error) {
      setFlash(`Ошибка импорта: ${result.error}`);
      return;
    }
    setItems(listSnippets());
    setFlash(
      `Импортировано: ${result.added}` + (result.skipped ? ` (пропущено ${result.skipped})` : ''),
    );
  };

  return (
    <div className="snippets" ref={ref}>
      <button
        type="button"
        className={'app__step snippets__btn' + (open ? ' snippets__btn--open' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Сохранённые сниппеты"
      >
        <span aria-hidden="true">📂</span>
        <span className="btn-label">Мои</span>
        {items.length > 0 && <span className="snippets__count">{items.length}</span>}
      </button>

      {open && (
        <div className="snippets__popover" role="menu">
          <div className="snippets__save-row">
            <input
              type="text"
              className="snippets__name-input"
              placeholder="Имя нового сниппета…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              autoFocus
            />
            <button
              type="button"
              className="snippets__save-btn"
              onClick={handleSave}
              disabled={!name.trim()}
              title="Сохранить текущий код под этим именем"
            >
              💾 Сохранить
            </button>
          </div>

          <ul className="snippets__list">
            {items.length === 0 && (
              <li className="snippets__empty">
                Ещё ничего не сохранено. Введи имя выше и нажми «Сохранить».
              </li>
            )}
            {items.map((s) => (
              <li key={s.id} className="snippets__item">
                <button
                  type="button"
                  className="snippets__load"
                  onClick={() => { onLoad(s.code); setOpen(false); }}
                  title="Загрузить в редактор"
                >
                  <span className="snippets__item-name">{s.name}</span>
                  <span className="snippets__item-meta">{formatDate(s.createdAt)}</span>
                </button>
                <button
                  type="button"
                  className="snippets__del"
                  onClick={() => handleDelete(s.id, s.name)}
                  aria-label={`Удалить сниппет ${s.name}`}
                  title="Удалить"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <div className="snippets__toolbar">
            <button
              type="button"
              className="snippets__tool-btn"
              onClick={handleExport}
              disabled={items.length === 0}
              title="Скачать все сниппеты одним JSON-файлом"
            >
              ⬇ Экспорт
            </button>
            <button
              type="button"
              className="snippets__tool-btn"
              onClick={handleImportClick}
              title="Прочитать JSON-файл и добавить сниппеты"
            >
              ⬆ Импорт
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              style={{ display: 'none' }}
            />
          </div>

          {gitCfg && (
            <div className="snippets__git">
              <div className="snippets__git-label">
                git: <b>{gitCfg.owner}/{gitCfg.repo}</b>
              </div>
              <div className="snippets__toolbar">
                <button
                  type="button"
                  className="snippets__tool-btn"
                  onClick={handlePushGit}
                  disabled={syncing || items.length === 0}
                  title="Отправить весь список в bslexicon-snippets.json"
                >
                  ↑ В git
                </button>
                <button
                  type="button"
                  className="snippets__tool-btn"
                  onClick={handlePullGit}
                  disabled={syncing}
                  title="Загрузить из bslexicon-snippets.json (заменит текущий список)"
                >
                  ↓ Из git
                </button>
              </div>
            </div>
          )}

          {flash && <div className="snippets__flash">{flash}</div>}
        </div>
      )}
    </div>
  );
}

function canUseStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm} ${hh}:${mi}`;
}
