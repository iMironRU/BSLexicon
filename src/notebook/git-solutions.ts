/**
 * Сохранение решения ученика в его собственный git-репо (см. #31
 * учебной платформы, `docs/education/README.md` §4.3, §6).
 *
 * Формат — расширенный `.nb.json` с двумя дополнениями:
 *   - корневой `source: { repo, sha, nb_path }` — откуда пришёл урок;
 *   - `task_snapshot` в каждой task-cell — spec задачи на момент
 *     открытия. Тесты решения ГОНЯЮТ ПО SNAPSHOT, а не по свежему
 *     `ref`. Это защита от «моё решение перестало проходить» когда
 *     педагог обновил `.task.yaml` в своём репо.
 *
 * Пушим в `solutions/<name>.nb.json` собственного репо ученика.
 * Ученику после сохранения показываем raw-ссылку решения — он копирует
 * и отдаёт педагогу вручную (в мессенджер / email).
 */

import { writeFile } from '../app/git-storage';
import type { GitConfig } from '../app/git-config';
import type { Notebook, TaskSpec } from './types';
import type { NbSource } from './nb-src';

const SOLUTIONS_SUBDIR = 'solutions';
const NB_EXT = '.nb.json';

export interface SolutionSource {
  /** `owner/repo`. */
  repo: string;
  /** SHA ветки на момент открытия. Может быть null (не удалось узнать). */
  sha: string | null;
  /** Путь к `.nb.json` педагога в его репо. */
  nb_path: string;
  /** Ветка. */
  branch: string;
}

interface StoredSolutionCell {
  t: 'md' | 'code' | 'task';
  s: string;
  /** Ссылка на `.task.yaml` в репо педагога (относительно корня). */
  ref?: string;
  /** Snapshot spec на момент открытия — источник истины для прогонки. */
  task_snapshot?: TaskSpec;
}

interface StoredSolution {
  v: 1;
  /** Метка «это файл-решение, а не файл-урок» — педагогу для детекта в #32. */
  role: 'solution';
  source: SolutionSource;
  cells: StoredSolutionCell[];
}

/** Собрать snapshot текущего ноутбука для сдачи. */
export function serializeSolution(nb: Notebook, source: SolutionSource): string {
  const payload: StoredSolution = {
    v: 1,
    role: 'solution',
    source,
    cells: nb.cells.map((c) => {
      if (c.type === 'task') {
        return {
          t: 'task',
          s: c.source,
          ...(c.ref ? { ref: c.ref } : {}),
          task_snapshot: c.task,
        };
      }
      return { t: c.type === 'markdown' ? 'md' : 'code', s: c.source };
    }),
  };
  return JSON.stringify(payload, null, 2);
}

/** Полный path решения в репо ученика. Учитывает `path` из git-config. */
export function solutionPath(cfg: GitConfig, name: string): string {
  const base = cfg.path ? `${cfg.path}/${SOLUTIONS_SUBDIR}` : SOLUTIONS_SUBDIR;
  return `${base}/${name}${NB_EXT}`;
}

/** Raw URL решения — для копирования в буфер и отправки педагогу. */
export function solutionRawUrl(cfg: GitConfig, name: string): string {
  const path = solutionPath(cfg, name);
  return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${path}`;
}

/**
 * Сохранить решение в `solutions/<name>.nb.json` в репо ученика.
 * Возвращает raw-URL для показа/копирования.
 */
export async function pushSolution(
  cfg: GitConfig,
  name: string,
  nb: Notebook,
  source: NbSource,
  sha: string | null,
  prevSha: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<{ path: string; rawUrl: string; sha: string }> {
  const path = solutionPath(cfg, name);
  const text = serializeSolution(nb, {
    repo: `${source.owner}/${source.repo}`,
    sha,
    nb_path: source.path,
    branch: source.branch,
  });
  const message = prevSha
    ? `BSLexicon: обновление решения ${name}`
    : `BSLexicon: решение ${name} (${source.owner}/${source.repo}${sha ? `@${sha.slice(0, 7)}` : ''})`;
  const newSha = await writeFile(cfg, path, text, message, prevSha, fetchFn);
  return { path, rawUrl: solutionRawUrl(cfg, name), sha: newSha };
}

/**
 * Автогенерация имени файла решения из имени урока педагога:
 * `notebooks/lesson-01-basics.nb.json` → `lesson-01-basics`.
 * Fallback если формат неожиданный — `solution-<timestamp>`.
 */
export function suggestSolutionName(nbPath: string): string {
  const base = nbPath.split('/').pop() ?? '';
  const m = base.match(/^(.+)\.nb\.json$/);
  if (m) return m[1];
  return `solution-${Date.now()}`;
}
