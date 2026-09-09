/**
 * Загрузка notebook'а по прямой git-ссылке — параметр `?nb-src=` (см. #30).
 *
 * Ученик получил от педагога URL с raw-ссылкой на `.nb.json` в его репо;
 * тренажёр:
 *  1. Разбирает raw URL → owner/repo/branch/path.
 *  2. Загружает `.nb.json` без авторизации (публичный репо — CORS ok).
 *  3. Резолвит `ref` в task-cell'ах относительно корня репо → грузит YAML.
 *  4. Фиксирует git-SHA репо на момент открытия (для будущего snapshot
 *     решения в #31).
 *
 * Приватные репо не поддерживаем в MVP: token ученика имеет доступ только
 * к его собственному репо (для сохранения решений в #31), а не к репо
 * педагога. Педагог держит `tasks/`+`notebooks/` в публичном.
 */

import type { Notebook, Cell } from './types';
import { parseTaskYaml } from './task-loader';
import { parseAnyFile, type SolutionMeta } from './git-notebooks';

const RAW_HOST = 'https://raw.githubusercontent.com';
const API_HOST = 'https://api.github.com';

export interface NbSource {
  owner: string;
  repo: string;
  branch: string;
  /** Путь в репо к `.nb.json`, начиная от корня, без ведущего `/`. */
  path: string;
}

export interface NbLoadResult {
  /** 'lesson' — обычный урок, 'solution' — файл-решение ученика (#31/#32). */
  kind: 'lesson' | 'solution';
  notebook: Notebook;
  source: NbSource;
  /**
   * SHA коммита ветки на момент открытия. `null` если не удалось
   * узнать (нет токена на приватный репо, GitHub API rate-limit).
   * Используется в #31 для snapshot решения.
   */
  sha: string | null;
  /**
   * Сообщения о ref-ячейках, которые не удалось загрузить. Пусто в успешном
   * случае; UI показывает как warnings — ноутбук всё равно открывается,
   * проблемные task-cell'ы работают на inline-fallback (см. #28).
   */
  refWarnings: string[];
  /** Только для kind='solution' — метаданные исходного урока педагога. */
  solutionMeta?: SolutionMeta;
}

/**
 * Разобрать `?nb-src=<url>` в структуру. Поддерживает форматы:
 *  - `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`
 *  - `https://github.com/<owner>/<repo>/blob/<branch>/<path>` (redirect на raw)
 *  - `https://github.com/<owner>/<repo>/raw/<branch>/<path>` (то же)
 *
 * Возвращает null для не-github ссылок или битого формата — вызывающий
 * покажет ученику понятную ошибку.
 */
export function parseNbSrcUrl(url: string): NbSource | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.replace(/^\/+/, '').split('/');
  if (u.hostname === 'raw.githubusercontent.com') {
    // /<owner>/<repo>/<branch>/<...path>
    if (parts.length < 4) return null;
    return { owner: parts[0], repo: parts[1], branch: parts[2], path: parts.slice(3).join('/') };
  }
  if (u.hostname === 'github.com') {
    // /<owner>/<repo>/(blob|raw)/<branch>/<...path>
    if (parts.length < 5) return null;
    if (parts[2] !== 'blob' && parts[2] !== 'raw') return null;
    return { owner: parts[0], repo: parts[1], branch: parts[3], path: parts.slice(4).join('/') };
  }
  return null;
}

/** Полный raw URL для файла в репо (относительно корня). */
export function rawUrlOf(src: NbSource, pathInRepo: string): string {
  return `${RAW_HOST}/${src.owner}/${src.repo}/${src.branch}/${pathInRepo}`;
}

/**
 * Резолвит `ref` task-ячейки в полный raw URL. `ref` — путь относительно
 * корня репо (`tasks/x.task.yaml`).
 */
export function resolveRefUrl(src: NbSource, ref: string): string {
  return rawUrlOf(src, ref);
}

/**
 * Основная точка: получить URL от ученика, вернуть готовый Notebook
 * с подтянутыми spec задач из ref-ячеек и фиксированным SHA.
 */
export async function fetchNotebookFromSrc(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<NbLoadResult> {
  const source = parseNbSrcUrl(url);
  if (!source) {
    throw new Error(
      'Ссылка не распознана. Ожидается raw-ссылка GitHub на .nb.json ' +
        '(вида raw.githubusercontent.com/owner/repo/branch/notebooks/lesson.nb.json).',
    );
  }

  // 1. Notebook
  const nbUrl = rawUrlOf(source, source.path);
  const r = await fetchFn(nbUrl);
  if (r.status === 404) throw new Error(`Файл не найден: ${source.path}`);
  if (!r.ok) throw new Error(`Не удалось загрузить ноутбук: HTTP ${r.status}`);
  const text = await r.text();
  let parsed: ReturnType<typeof parseAnyFile>;
  try {
    parsed = parseAnyFile(text);
  } catch (e) {
    throw new Error(`Битый .nb.json: ${(e as Error).message}`);
  }
  const notebook: Notebook = parsed.notebook;

  // Для файла-решения ref НЕ резолвим — spec уже зашит в task_snapshot,
  // это же snapshot (см. §4.3). Педагог видит РЕАЛЬНО ТУ версию задачи
  // с которой ученик работал, а не свежий HEAD своего `tasks/`.
  if (parsed.kind === 'solution') {
    return {
      kind: 'solution',
      notebook,
      source,
      sha: null,
      refWarnings: [],
      solutionMeta: parsed.solutionMeta,
    };
  }

  // 2. Резолвим ref в task-ячейках параллельно.
  const refWarnings: string[] = [];
  const refCells = notebook.cells
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c.type === 'task' && c.ref);
  const resolved = await Promise.all(
    refCells.map(async ({ c, idx }) => {
      const ref = (c as { ref?: string }).ref!;
      try {
        const yr = await fetchFn(resolveRefUrl(source, ref));
        if (yr.status === 404) throw new Error(`не найден`);
        if (!yr.ok) throw new Error(`HTTP ${yr.status}`);
        const yaml = await yr.text();
        const parsed = parseTaskYaml(yaml);
        if (!parsed.ok) throw new Error(parsed.error);
        return { idx, spec: parsed.spec };
      } catch (e) {
        refWarnings.push(`${ref}: ${(e as Error).message}`);
        return { idx, spec: null };
      }
    }),
  );
  const cells: Cell[] = notebook.cells.slice();
  for (const { idx, spec } of resolved) {
    const cell = cells[idx];
    if (cell.type !== 'task' || !spec) continue;
    // Подменяем task на подгруженный spec — рендерится обычной TaskCell
    // как inline-задача. `ref` СОХРАНЯЕМ: он нужен при отправке решения
    // (#31) чтобы в файле-снапшоте было и «что за задача» (task_snapshot),
    // и «откуда пришла» (ref). Для TaskCell приоритет: если spec подтянут
    // (task заполнен) — рендерим как inline; placeholder про ref больше
    // не показываем (спрятан ниже в App при наличии подтянутого spec).
    cells[idx] = { ...cell, task: spec } as Cell;
  }

  // 2b. Резолвим ref в query-ячейках. Ref без расширения → пара .schema.yaml +
  // .data.yaml. Если что-то одно из пары не подгрузилось, оба поля
  // сохраняем как inline (обычно inline — это `mini-erp`, дефолт),
  // и добавляем warning; ячейка работает на дефолте.
  const queryCells = cells
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c.type === 'query' && c.ref);
  const queryResolved = await Promise.all(
    queryCells.map(async ({ idx, c }) => {
      const ref = (c as { ref?: string }).ref!;
      const schemaUrl = resolveRefUrl(source, `${ref}.schema.yaml`);
      const dataUrl = resolveRefUrl(source, `${ref}.data.yaml`);
      try {
        const [sr, dr] = await Promise.all([fetchFn(schemaUrl), fetchFn(dataUrl)]);
        if (!sr.ok) throw new Error(`.schema.yaml: HTTP ${sr.status}`);
        if (!dr.ok) throw new Error(`.data.yaml: HTTP ${dr.status}`);
        const [schema, data] = await Promise.all([sr.text(), dr.text()]);
        return { idx, schema, data };
      } catch (e) {
        refWarnings.push(`${ref}: ${(e as Error).message}`);
        return { idx, schema: null, data: null };
      }
    }),
  );
  for (const { idx, schema, data } of queryResolved) {
    if (schema === null || data === null) continue;
    const cell = cells[idx];
    if (cell.type !== 'query') continue;
    cells[idx] = { ...cell, schema, data } as Cell;
  }

  // 3. SHA ветки (best-effort, без токена). Rate-limit публичного API
  // ~60 req/hour на IP — на MVP приемлемо.
  let sha: string | null = null;
  try {
    const shaRes = await fetchFn(
      `${API_HOST}/repos/${source.owner}/${source.repo}/branches/${source.branch}`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (shaRes.ok) {
      const j = (await shaRes.json()) as { commit?: { sha?: string } };
      sha = j.commit?.sha ?? null;
    }
  } catch {
    /* сеть/API — не критично, SHA останется null */
  }

  return { kind: 'lesson', notebook: { cells }, source, sha, refWarnings };
}
