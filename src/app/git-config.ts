/**
 * Настройки подключения к пользовательскому GitHub-репозиторию.
 * Токен — fine-grained Personal Access Token с правами Contents: Read/Write
 * НА ОДИН репозиторий (это критично для безопасности; см. `docs/git-sync.md`
 * или страницу настроек в приложении).
 *
 * Всё лежит в localStorage. При очистке хранилища токен стирается вместе с
 * остальными настройками.
 */

const KEY = 'bslexicon:git:config';

export interface GitConfig {
  /** GitHub-имя пользователя или организации (owner). */
  owner: string;
  /** Название репозитория. */
  repo: string;
  /** Ветка (default: main). */
  branch: string;
  /**
   * Путь к директории внутри репо, куда пишем/откуда читаем. Пусто — корень.
   * Не должен начинаться и заканчиваться на `/` — храним нормализованным.
   */
  path: string;
  /** Fine-grained Personal Access Token (только на этот репо). */
  token: string;
}

export function loadGitConfig(): GitConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isConfig(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGitConfig(cfg: GitConfig): void {
  const normalized: GitConfig = {
    owner: cfg.owner.trim(),
    repo: cfg.repo.trim(),
    branch: (cfg.branch || 'main').trim(),
    path: normalizePath(cfg.path),
    token: cfg.token.trim(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(normalized));
  } catch {
    // storage недоступен — молча
  }
}

export function clearGitConfig(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function normalizePath(p: string): string {
  return (p || '').trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function isConfig(v: unknown): v is GitConfig {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.owner === 'string' &&
    typeof o.repo === 'string' &&
    typeof o.branch === 'string' &&
    typeof o.path === 'string' &&
    typeof o.token === 'string'
  );
}
