/**
 * Push/pull коллекции сниппетов из/в пользовательский GitHub-репозиторий.
 *
 * Тонкий склеиватель над `git-storage` (GitHub Contents API) и `snippets`
 * (localStorage-хранилище). Всё чистые функции — легко тестируется:
 * можно передать mock-fetch и получить полный round-trip.
 */

import type { GitConfig } from './git-config';
import { GitApiError, readFile, snippetsFilePath, writeFile } from './git-storage';
import { exportAll, importAll, type Snippet } from './snippets';

export interface PushResult {
  path: string;
  sha: string;
  message: string;
}

/**
 * Отправить весь список сниппетов в репо. Читает текущее содержимое
 * файла (для получения sha — иначе GitHub 409), пишет обратно с новой
 * версией. Возвращает новый sha и итоговый путь.
 */
export async function syncPush(
  cfg: GitConfig,
  items: Snippet[],
  fetchFn: typeof fetch = fetch,
): Promise<PushResult> {
  const path = snippetsFilePath(cfg);
  const existing = await readFile(cfg, path, fetchFn);
  const body = exportAll(items);
  const message = `BSLexicon: sync ${items.length} snippet${items.length === 1 ? '' : 's'}`;
  const sha = await writeFile(cfg, path, body, message, existing?.sha ?? null, fetchFn);
  return { path, sha, message };
}

export type PullResult =
  | { kind: 'empty'; path: string }
  | { kind: 'ok'; added: number; skipped: number; items: Snippet[] };

/**
 * Забрать сниппеты из репо, распарсить и **записать в localStorage
 * поверх текущего списка** (mode='replace'). Возвращает разбор
 * результата — вызывающему остаётся только показать UI-сообщение.
 *
 * `kind: 'empty'` — файла в репо ещё нет (первый push не был сделан).
 * `throws GitApiError` — сеть/токен/права.
 */
export async function syncPull(
  cfg: GitConfig,
  fetchFn: typeof fetch = fetch,
): Promise<PullResult> {
  const path = snippetsFilePath(cfg);
  const existing = await readFile(cfg, path, fetchFn);
  if (!existing) return { kind: 'empty', path };

  const result = importAll(existing.text, 'replace');
  if (result.error) throw new GitApiError(400, `Не удалось разобрать ${path}: ${result.error}`);

  // importAll уже записал в localStorage — вернём разбор + актуальный список
  // из storage, чтобы UI-компонент мог отрендерить без дополнительного вызова.
  return {
    kind: 'ok',
    added: result.added,
    skipped: result.skipped,
    items: parseItemsFromExport(existing.text),
  };
}

/** Возвращает items из JSON-экспорта — для показа в UI после pull. */
function parseItemsFromExport(json: string): Snippet[] {
  try {
    const parsed = JSON.parse(json) as { items?: unknown };
    if (Array.isArray(parsed.items)) return parsed.items as Snippet[];
  } catch {
    // ignore — уже отфильтровано в importAll
  }
  return [];
}
