import { useEffect, useState } from 'react';
import {
  clearGitConfig,
  loadGitConfig,
  parseRepoLink,
  repoUrl,
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

/**
 * Модалка настроек GitHub-подключения. Форма минимальна: ссылка на репо
 * (полный URL или короткая `user/repo`) + fine-grained PAT. Ветку и
 * подпапку — только по запросу под спойлером «Дополнительно».
 *
 * «Проверить и подключиться» парсит ссылку, дёргает /repos/:owner/:repo
 * и сохраняет конфиг только при 200.
 */
export function GitSettingsModal({ onClose, onConnected }: GitSettingsModalProps) {
  const initial = loadGitConfig();
  const isConnected = initial !== null;

  // Единое поле «ссылка на репо» — если уже подключено, реконструируем
  // URL из сохранённых owner/repo, чтобы пользователю не нужно было
  // вводить его повторно.
  const [linkInput, setLinkInput] = useState(() =>
    initial ? repoUrl(initial) : '',
  );
  const [token, setToken] = useState(initial?.token ?? '');
  const [branch, setBranch] = useState(initial?.branch ?? 'main');
  const [path, setPath] = useState(initial?.path ?? '');
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initial?.path));
  const [showToken, setShowToken] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [copyFlash, setCopyFlash] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copyFlash) return undefined;
    const id = window.setTimeout(() => setCopyFlash(false), 1500);
    return () => window.clearTimeout(id);
  }, [copyFlash]);

  const handleConnect = async (): Promise<void> => {
    const parsed = parseRepoLink(linkInput);
    if (!parsed) {
      setStatus({ kind: 'error', message: 'Не распознал ссылку. Ожидаю https://github.com/user/repo или user/repo.' });
      return;
    }
    const cfg: GitConfig = {
      owner: parsed.owner,
      repo: parsed.repo,
      branch: (parsed.branch || branch || 'main').trim(),
      path: parsed.path ?? path,
      token: token.trim(),
    };
    setStatus({ kind: 'testing' });
    try {
      const info = await testConnection(cfg);
      if (info.permissions && !info.permissions.push) {
        setStatus({ kind: 'error', message: 'Токен принят, но у него нет прав на запись (push). Проверь Contents: Read and write.' });
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
    setLinkInput('');
    setToken('');
    setBranch('main');
    setPath('');
    setStatus({ kind: 'idle' });
    onConnected();
  };

  const handleCopyRepo = async (): Promise<void> => {
    if (!initial) return;
    const url = repoUrl(initial);
    try {
      await navigator.clipboard?.writeText(url);
      setCopyFlash(true);
    } catch {
      window.prompt('Скопируй ссылку:', url);
    }
  };

  const canSubmit = linkInput.trim() && token.trim() && status.kind !== 'testing';

  return (
    <div className="git-modal__backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="git-modal" onClick={(e) => e.stopPropagation()}>
        <div className="git-modal__header">
          <h2 className="git-modal__title">Подключение к GitHub</h2>
          <button type="button" className="git-modal__close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        <p className="git-modal__lead">
          Сохраняй код в свой репозиторий на GitHub. Push/pull делаются одной кнопкой
          из меню «📂 Мои». Файл в репо — <code>bslexicon-snippets.json</code>{path && <> в папке <code>{path}/</code></>}.
        </p>

        {isConnected && initial && (
          <div className="git-modal__connected">
            <span className="git-modal__connected-label">Сейчас подключено:</span>
            <a
              className="git-modal__connected-repo"
              href={repoUrl(initial)}
              target="_blank"
              rel="noopener noreferrer"
              title="Открыть на GitHub"
            >
              {initial.owner}/{initial.repo}
            </a>
            <button
              type="button"
              className="git-modal__copy"
              onClick={handleCopyRepo}
              title="Скопировать ссылку на репо"
            >
              {copyFlash ? '✓ Скопировано' : '📋 Копировать'}
            </button>
          </div>
        )}

        <details className="git-modal__howto" open={!isConnected}>
          <summary>Как получить безопасный токен (fine-grained PAT)</summary>
          <ol className="git-modal__steps">
            <li>
              <b>Сначала заведи новый пустой репозиторий</b> — только для этих сниппетов
              (например <code>bslexicon-snippets</code>). Можно private, README/license не нужны.
              Ссылка:{' '}
              <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">
                github.com/new
              </a>.
            </li>
            <li>
              Теперь открой{' '}
              <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                github.com/settings/personal-access-tokens/new
              </a>{' '}
              (это <b>fine-grained</b> PAT, а не classic).
            </li>
            <li><b>Token name:</b> BSLexicon snippets. <b>Expiration:</b> 90 дней (или дольше).</li>
            <li>
              <b>Repository access → Only select repositories</b> → выбери
              из выпадающего списка тот самый репозиторий, что завёл на шаге 1.
            </li>
            <li><b>Repository permissions → Contents → Read and write.</b> Больше ничего.</li>
            <li>Generate token → скопируй → вставь в поле «Personal Access Token» ниже.</li>
          </ol>
          <p className="git-modal__warn">
            ⚠ Токен лежит в localStorage этого браузера. Если браузер скомпрометирован — злоумышленник получит доступ ко всему, что разрешает токен.
            Поэтому давай токену минимальные права (Contents: Read/Write) и только на один репо.
          </p>
        </details>

        <div className="git-modal__form">
          <label className="git-modal__field">
            <span>Ссылка на репозиторий</span>
            <input
              type="text"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="https://github.com/username/bslexicon-snippets"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="git-modal__field">
            <span>Personal Access Token</span>
            <div className="git-modal__token-row">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
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

          <div className="git-modal__advanced">
            <button
              type="button"
              className="git-modal__advanced-toggle"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? '▾' : '▸'} Дополнительно (ветка, папка)
            </button>
            {showAdvanced && (
              <div className="git-modal__row">
                <label className="git-modal__field git-modal__field--half">
                  <span>Ветка</span>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    autoComplete="off"
                  />
                </label>
                <label className="git-modal__field git-modal__field--half">
                  <span>Папка (необязательно)</span>
                  <input
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="learn"
                    autoComplete="off"
                  />
                </label>
              </div>
            )}
          </div>
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
