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

export interface ParsedRepoLink {
  owner: string;
  repo: string;
  /** Ветка, если её удалось выцепить из URL вида `/tree/<branch>/…`. */
  branch?: string;
  /** Подпапка из URL вида `/tree/<branch>/<subdir>`. */
  path?: string;
}

/**
 * Разобрать пользовательскую строку в owner/repo (+ опц. branch/path).
 * Поддерживает:
 *   • полный URL   `https://github.com/user/repo`
 *   • URL с веткой `https://github.com/user/repo/tree/dev/some/dir`
 *   • SSH-remote   `git@github.com:user/repo.git`
 *   • короткая     `user/repo`
 *
 * Возвращает `null`, если строка не распознана — вызывающий покажет
 * человеческую ошибку.
 */
export function parseRepoLink(raw: string): ParsedRepoLink | null {
  const s = (raw || '').trim();
  if (!s) return null;

  // Короткая user/repo — приоритетнее URL, чтобы не пытаться его парсить
  const short = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (short && !s.includes('://') && !s.startsWith('git@')) {
    return { owner: short[1], repo: short[2] };
  }

  const ssh = s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  try {
    const url = new URL(s);
    if (!url.hostname.endsWith('github.com')) return null;
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    const owner = parts[0];
    const repo = parts[1];
    // URL с веткой/подпапкой: /tree/<branch>/<subdir…>
    if (parts[2] === 'tree' && parts.length >= 4) {
      const branch = parts[3];
      const path = parts.slice(4).join('/');
      return { owner, repo, branch, ...(path ? { path } : {}) };
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

/**
 * Строка ссылки на репо для показа/копирования — из сохранённой
 * конфигурации собираем `https://github.com/owner/repo` (ветку не
 * добавляем, ветка редко отличается от default и в URL смотрится шумно).
 */
export function repoUrl(cfg: Pick<GitConfig, 'owner' | 'repo'>): string {
  return `https://github.com/${cfg.owner}/${cfg.repo}`;
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
