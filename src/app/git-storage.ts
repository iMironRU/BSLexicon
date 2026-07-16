/**
 * Работа с GitHub Contents API — минимально необходимая часть.
 * Всё через fetch, никаких клиентских библиотек.
 *
 * Использует fine-grained Personal Access Token — см. src/app/git-config.ts.
 * Правильный scope: Contents: Read/Write НА ОДИН репозиторий.
 *
 * API-документация: https://docs.github.com/en/rest/repos/contents
 */

import type { GitConfig } from './git-config';

const API = 'https://api.github.com';

export class GitApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'GitApiError';
  }
}

export interface RepoInfo {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  permissions: { push: boolean } | null;
}

/**
 * Проверить, что токен работает и репо доступен на запись. Используется
 * страницей настроек — «Проверить и подключиться».
 */
export async function testConnection(cfg: GitConfig, fetchFn: typeof fetch = fetch): Promise<RepoInfo> {
  const r = await fetchFn(`${API}/repos/${enc(cfg.owner)}/${enc(cfg.repo)}`, {
    headers: gitHeaders(cfg.token),
  });
  if (r.status === 401) throw new GitApiError(401, 'Токен не принят GitHub (401). Проверь, что он не истёк и имеет доступ к репо.');
  if (r.status === 404) throw new GitApiError(404, `Репо ${cfg.owner}/${cfg.repo} не найден или токен не имеет к нему доступа.`);
  if (!r.ok) throw new GitApiError(r.status, `GitHub вернул ${r.status}: ${await safeText(r)}`);
  const j = (await r.json()) as Record<string, unknown>;
  const perms = j.permissions as { push?: boolean } | undefined;
  return {
    fullName: String(j.full_name),
    defaultBranch: String(j.default_branch),
    private: Boolean(j.private),
    permissions: perms ? { push: Boolean(perms.push) } : null,
  };
}

export interface FileContent {
  /** Декодированный UTF-8 текст файла. */
  text: string;
  /** SHA blob — нужен для последующей записи (иначе GitHub вернёт 409). */
  sha: string;
}

/**
 * Прочитать содержимое файла в репо. Возвращает null если файла нет
 * (первый push — файл ещё не создан).
 */
export async function readFile(
  cfg: GitConfig,
  filePath: string,
  fetchFn: typeof fetch = fetch,
): Promise<FileContent | null> {
  const url = `${API}/repos/${enc(cfg.owner)}/${enc(cfg.repo)}/contents/${encPath(filePath)}?ref=${enc(cfg.branch)}`;
  const r = await fetchFn(url, { headers: gitHeaders(cfg.token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new GitApiError(r.status, `Не удалось прочитать ${filePath}: ${await safeText(r)}`);
  const j = (await r.json()) as Record<string, unknown>;
  if (Array.isArray(j)) {
    // По этому пути лежит директория, а не файл
    throw new GitApiError(400, `${filePath} — директория, а не файл.`);
  }
  if (typeof j.content !== 'string' || j.encoding !== 'base64') {
    throw new GitApiError(500, 'GitHub вернул неожиданный формат ответа.');
  }
  return {
    text: b64Decode(j.content),
    sha: String(j.sha),
  };
}

/**
 * Создать или обновить файл. Если файл уже есть — обязательно передать
 * `prevSha` (иначе GitHub 409). Возвращает новый sha.
 */
export async function writeFile(
  cfg: GitConfig,
  filePath: string,
  text: string,
  message: string,
  prevSha: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const url = `${API}/repos/${enc(cfg.owner)}/${enc(cfg.repo)}/contents/${encPath(filePath)}`;
  const body: Record<string, unknown> = {
    message,
    content: b64Encode(text),
    branch: cfg.branch,
  };
  if (prevSha) body.sha = prevSha;
  const r = await fetchFn(url, {
    method: 'PUT',
    headers: { ...gitHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 409) throw new GitApiError(409, 'В репо появился более свежий коммит. Загрузи из git и попробуй снова.');
  if (!r.ok) throw new GitApiError(r.status, `Не удалось записать ${filePath}: ${await safeText(r)}`);
  const j = (await r.json()) as Record<string, unknown>;
  const content = j.content as { sha?: string } | undefined;
  if (!content?.sha) throw new GitApiError(500, 'GitHub не вернул sha нового файла.');
  return content.sha;
}

// ── Служебные ────────────────────────────────────────────────────────

function gitHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

/** Кодирует каждый сегмент пути отдельно, чтобы `/` не был экранирован. */
function encPath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

async function safeText(r: Response): Promise<string> {
  try {
    const j = (await r.json()) as { message?: string };
    return j.message ?? r.statusText;
  } catch {
    return r.statusText || `HTTP ${r.status}`;
  }
}

/**
 * base64 (стандартный, не URL-safe) UTF-8 текста — то что ожидает GitHub API.
 * atob/btoa работают только с латиницей, поэтому явно кодируем через
 * TextEncoder.
 */
function b64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64Decode(b64: string): string {
  // GitHub может вернуть с переносами строк — уберём.
  const clean = b64.replace(/\s/g, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Полный путь к нашему файлу-манифесту сниппетов в репо. Например
 * `learn/bslexicon-snippets.json` если path=`learn`, иначе просто
 * имя файла в корне.
 */
export function snippetsFilePath(cfg: GitConfig): string {
  const dir = cfg.path;
  return dir ? `${dir}/bslexicon-snippets.json` : 'bslexicon-snippets.json';
}
