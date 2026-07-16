import { useEffect, useState } from 'react';
import {
  clearGitConfig,
  loadGitConfig,
  saveGitConfig,
  type GitConfig,
} from '../git-config';
import { GitApiError, testConnection, type RepoInfo } from '../git-storage';

interface GitSettingsModalProps {
  onClose: () => void;
  onConnected: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; info: RepoInfo }
  | { kind: 'error'; message: string };

const EMPTY: GitConfig = { owner: '', repo: '', branch: 'main', path: '', token: '' };

/**
 * Модалка настроек подключения к GitHub-репо. Открывается по клику
 * на индикатор в шапке. Мысль: минимум магии — форма owner/repo/token,
 * кнопка «Проверить и подключиться» дёргает /repos/:owner/:repo и
 * сохраняет только если пришёл 200. Инструкция по fine-grained token —
 * прямо тут же, без внешней документации.
 */
export function GitSettingsModal({ onClose, onConnected }: GitSettingsModalProps) {
  const initial = loadGitConfig();
  const [cfg, setCfg] = useState<GitConfig>(initial ?? EMPTY);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [showToken, setShowToken] = useState(false);
  const isConnected = initial !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleConnect = async (): Promise<void> => {
    setStatus({ kind: 'testing' });
    try {
      const info = await testConnection(cfg);
      if (info.permissions && !info.permissions.push) {
        setStatus({ kind: 'error', message: 'Токен есть, но у него нет прав на запись (push). Проверь Contents: Read and write.' });
        return;
      }
      saveGitConfig(cfg);
      setStatus({ kind: 'ok', info });
      onConnected();
    } catch (e) {
      const msg = e instanceof GitApiError ? e.message : (e as Error).message;
      setStatus({ kind: 'error', message: msg });
    }
  };

  const handleDisconnect = (): void => {
    if (!window.confirm('Отключить репо? Токен будет удалён из этого браузера. Сниппеты в localStorage останутся.')) return;
    clearGitConfig();
    setCfg(EMPTY);
    setStatus({ kind: 'idle' });
    onConnected();
  };

  const canSubmit = cfg.owner && cfg.repo && cfg.token && status.kind !== 'testing';

  return (
    <div className="git-modal__backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="git-modal" onClick={(e) => e.stopPropagation()}>
        <div className="git-modal__header">
          <h2 className="git-modal__title">Подключение к GitHub</h2>
          <button type="button" className="git-modal__close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <p className="git-modal__lead">
          Сохраняй код в свой репозиторий на GitHub. Push/pull делаются одной кнопкой
          из меню «📂 Мои». Файл в репо — <code>bslexicon-snippets.json</code>{cfg.path && <> в папке <code>{cfg.path}/</code></>}.
        </p>

        <details className="git-modal__howto" open={!isConnected}>
          <summary>Как получить безопасный токен (fine-grained PAT)</summary>
          <ol className="git-modal__steps">
            <li>
              Открой{' '}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                github.com/settings/personal-access-tokens/new
              </a>{' '}
              (это <b>fine-grained</b> PAT, а не classic).
            </li>
            <li>Заведи отдельный репозиторий, только для BSLexicon (например <code>bslexicon-snippets</code>).</li>
            <li><b>Token name:</b> BSLexicon snippets. <b>Expiration:</b> 90 дней (или дольше).</li>
            <li><b>Repository access → Only select repositories → выбери один</b> тот самый репозиторий.</li>
            <li><b>Repository permissions → Contents → Read and write.</b> Больше ничего.</li>
            <li>Generate token → скопируй → вставь в поле ниже.</li>
          </ol>
          <p className="git-modal__warn">
            ⚠ Токен лежит в localStorage этого браузера. Если браузер скомпрометирован — злоумышленник получит доступ ко всему, что разрешает токен.
            Поэтому давай токену минимальные права (Contents: Read/Write) и только на один репо.
          </p>
        </details>

        <div className="git-modal__form">
          <label className="git-modal__field">
            <span>Owner (username или org)</span>
            <input
              type="text"
              value={cfg.owner}
              onChange={(e) => setCfg({ ...cfg, owner: e.target.value })}
              placeholder="iMironRU"
              autoComplete="off"
            />
          </label>

          <label className="git-modal__field">
            <span>Репозиторий</span>
            <input
              type="text"
              value={cfg.repo}
              onChange={(e) => setCfg({ ...cfg, repo: e.target.value })}
              placeholder="bslexicon-snippets"
              autoComplete="off"
            />
          </label>

          <div className="git-modal__row">
            <label className="git-modal__field git-modal__field--half">
              <span>Ветка</span>
              <input
                type="text"
                value={cfg.branch}
                onChange={(e) => setCfg({ ...cfg, branch: e.target.value })}
                placeholder="main"
                autoComplete="off"
              />
            </label>
            <label className="git-modal__field git-modal__field--half">
              <span>Папка (необязательно)</span>
              <input
                type="text"
                value={cfg.path}
                onChange={(e) => setCfg({ ...cfg, path: e.target.value })}
                placeholder="learn"
                autoComplete="off"
              />
            </label>
          </div>

          <label className="git-modal__field">
            <span>Personal Access Token</span>
            <div className="git-modal__token-row">
              <input
                type={showToken ? 'text' : 'password'}
                value={cfg.token}
                onChange={(e) => setCfg({ ...cfg, token: e.target.value })}
                placeholder="github_pat_..."
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="git-modal__eye"
                onClick={() => setShowToken((v) => !v)}
                title={showToken ? 'Скрыть' : 'Показать'}
              >
                {showToken ? '🙈' : '👁'}
              </button>
            </div>
          </label>
        </div>

        {status.kind === 'error' && (
          <div className="git-modal__status git-modal__status--error">✗ {status.message}</div>
        )}
        {status.kind === 'ok' && (
          <div className="git-modal__status git-modal__status--ok">
            ✓ Подключено: <b>{status.info.fullName}</b> · default branch: <code>{status.info.defaultBranch}</code>
          </div>
        )}

        <div className="git-modal__actions">
          {isConnected && (
            <button type="button" className="git-modal__btn git-modal__btn--danger" onClick={handleDisconnect}>
              Отключить
            </button>
          )}
          <div className="git-modal__actions-right">
            <button type="button" className="git-modal__btn" onClick={onClose}>Закрыть</button>
            <button
              type="button"
              className="git-modal__btn git-modal__btn--primary"
              onClick={handleConnect}
              disabled={!canSubmit}
            >
              {status.kind === 'testing' ? 'Проверяю…' : 'Проверить и подключиться'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
