/**
 * Работа с папкой `notebooks/` в подключённом git-репо педагога
 * (см. #29 учебной платформы).
 *
 * Тонкая обёртка над `git-storage`: list / load / save конкретных
 * `.nb.json` файлов. Формат содержимого — сериализованный Notebook
 * (JSON, не gzip: локально в репо удобнее читаемое).
 *
 * `path` в GitConfig — учитывается: если педагог задал в настройках
 * git-connect подпапку (например `bslexicon/`), то `notebooks/` резолвится
 * относительно неё: `bslexicon/notebooks/`.
 */

import { listDirectory, readFile, writeFile } from '../app/git-storage';
import type { GitConfig } from '../app/git-config';
import type { Cell, Notebook, TaskSpec } from './types';
import type { QueryTaskSpec } from '../query/task-format';
import type { QueryParamEntry } from '../query/parameters';

const NOTEBOOKS_SUBDIR = 'notebooks';
const NB_EXT = '.nb.json';

export interface GitNotebookFile {
  /** Имя без пути и расширения — то что видит педагог. */
  name: string;
  /** Полный path в репо (relative to root). */
  path: string;
  /** SHA blob — нужен для записи. */
  sha: string;
  /** Размер файла в байтах. */
  size?: number;
}

export interface LoadedNotebook {
  notebook: Notebook;
  /** SHA файла — держим в UI для последующего save. */
  sha: string;
  /** Полный path в репо. */
  path: string;
  /** Имя без пути и расширения. */
  name: string;
}

interface StoredCell {
  t: 'md' | 'code' | 'task' | 'query' | 'query-task';
  s: string;
  task?: TaskSpec;
  ref?: string;
  /** Только для файла-решения (#31): spec на момент открытия. */
  task_snapshot?: TaskSpec;
  /** Объяснение решения ученика (#33). */
  explanation?: string;
  /** Query-ячейка (#42): YAML схемы и данных прямо в файле. */
  schema?: string;
  data?: string;
  /** Значения параметров &Имя (issue #53). */
  parameters?: QueryParamEntry[];
  /** Query-задача (#43): полная спека query-task. */
  query_task?: QueryTaskSpec;
  /** Snapshot query-task для файла-решения (аналог task_snapshot). */
  query_task_snapshot?: QueryTaskSpec;
}
interface StoredNotebook {
  v: 1;
  /** Для файлов-решений — 'solution'. Отсутствует у обычных уроков. */
  role?: 'solution';
  source?: {
    repo: string;
    sha: string | null;
    nb_path: string;
    branch: string;
  };
  cells: StoredCell[];
}

/** Полный path директории `notebooks/` c учётом path из git-config. */
function notebooksDir(cfg: GitConfig): string {
  return cfg.path ? `${cfg.path}/${NOTEBOOKS_SUBDIR}` : NOTEBOOKS_SUBDIR;
}

function fileInDir(cfg: GitConfig, name: string): string {
  return `${notebooksDir(cfg)}/${name}${NB_EXT}`;
}

/** Список `.nb.json` файлов в репо. Пустой если папки/файлов нет. */
export async function listNotebooks(
  cfg: GitConfig,
  fetchFn: typeof fetch = fetch,
): Promise<GitNotebookFile[]> {
  const entries = await listDirectory(cfg, notebooksDir(cfg), fetchFn);
  return entries
    .filter((e) => e.type === 'file' && e.name.endsWith(NB_EXT))
    .map((e) => ({
      name: e.name.slice(0, -NB_EXT.length),
      path: e.path,
      sha: e.sha,
      size: e.size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/**
 * Загрузить конкретный ноутбук из репо. Возвращает `null` если файла
 * нет (например, педагог удалил его в git между list и load).
 */
export async function loadNotebook(
  cfg: GitConfig,
  name: string,
  fetchFn: typeof fetch = fetch,
): Promise<LoadedNotebook | null> {
  const path = fileInDir(cfg, name);
  const file = await readFile(cfg, path, fetchFn);
  if (!file) return null;
  const nb = parseStoredNotebook(file.text);
  return { notebook: nb, sha: file.sha, path, name };
}

/**
 * Сохранить ноутбук как файл `notebooks/<name>.nb.json`. При обновлении
 * существующего — `prevSha` обязателен (`loadNotebook` его возвращает),
 * иначе GitHub вернёт 409. Возвращает новый SHA.
 */
export async function saveNotebook(
  cfg: GitConfig,
  name: string,
  notebook: Notebook,
  prevSha: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<{ path: string; sha: string }> {
  const path = fileInDir(cfg, name);
  const text = serializeNotebook(notebook);
  const message = prevSha
    ? `BSLexicon: обновление ноутбука ${name}`
    : `BSLexicon: новый ноутбук ${name}`;
  const sha = await writeFile(cfg, path, text, message, prevSha, fetchFn);
  return { path, sha };
}

/**
 * Сериализация Notebook в JSON для git. Формат совпадает с draft.ts
 * (совместим и с URL-контрактом `?nb=`, кроме gzip), плюс поле `ref`
 * для task-ячеек (#28).
 */
export function serializeNotebook(nb: Notebook): string {
  const payload: StoredNotebook = {
    v: 1,
    cells: nb.cells.map((c) => {
      if (c.type === 'task') {
        const cell: StoredCell = { t: 'task', s: c.source, task: c.task };
        if (c.ref) cell.ref = c.ref;
        if (c.explanation) cell.explanation = c.explanation;
        return cell;
      }
      if (c.type === 'query') {
        const cell: StoredCell = { t: 'query', s: c.source, schema: c.schema, data: c.data };
        if (c.ref) cell.ref = c.ref;
        if (c.parameters?.length) cell.parameters = c.parameters;
        return cell;
      }
      if (c.type === 'query-task') {
        const cell: StoredCell = { t: 'query-task', s: c.source, query_task: c.task };
        if (c.ref) cell.ref = c.ref;
        if (c.explanation) cell.explanation = c.explanation;
        return cell;
      }
      return { t: c.type === 'markdown' ? 'md' : 'code', s: c.source };
    }),
  };
  return JSON.stringify(payload, null, 2);
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `g${idCounter}`;
}

export interface SolutionMeta {
  /** owner/repo педагога. */
  repo: string;
  sha: string | null;
  nb_path: string;
  branch: string;
}

export type ParsedFile =
  | { kind: 'lesson'; notebook: Notebook }
  | { kind: 'solution'; notebook: Notebook; solutionMeta: SolutionMeta };

/**
 * Универсальный парсер `.nb.json` — определяет вид файла (урок vs решение
 * ученика). Решение имеет `role: 'solution'` и корневой `source`; в
 * task-cell вместо `task` там `task_snapshot`. См. `docs/education/README.md`
 * §4.3 и #31.
 *
 * Кидает при битом JSON / неверной схеме.
 */
export function parseAnyFile(text: string): ParsedFile {
  const parsed = JSON.parse(text) as StoredNotebook;
  if (parsed.v !== 1 || !Array.isArray(parsed.cells)) {
    throw new Error('Не поддерживаемая схема ноутбука (не v: 1)');
  }
  const isSolution = parsed.role === 'solution';
  const cells: Cell[] = parsed.cells.map((c) => {
    if (c.t === 'task') {
      // Для решения источник spec — task_snapshot; для урока — task или fallback.
      const spec: TaskSpec = c.task_snapshot ?? c.task ?? {
        statement: '## Задача',
        starter: '',
        tests: [{ kind: 'stdout', expect: '' }],
      };
      const cell: Cell = { id: nextId(), type: 'task', source: c.s, task: spec };
      if (c.ref && cell.type === 'task') cell.ref = c.ref;
      if (c.explanation && cell.type === 'task') cell.explanation = c.explanation;
      return cell;
    }
    if (c.t === 'query') {
      const cell: Cell = {
        id: nextId(),
        type: 'query',
        source: c.s,
        schema: c.schema ?? '',
        data: c.data ?? '',
      };
      if (c.ref) (cell as { ref?: string }).ref = c.ref;
      if (c.parameters?.length && cell.type === 'query') cell.parameters = c.parameters;
      return cell;
    }
    if (c.t === 'query-task') {
      const spec = c.query_task_snapshot ?? c.query_task;
      if (!spec) {
        // Битая ячейка — не крашим ноутбук, показываем как markdown с текстом ошибки.
        return { id: nextId(), type: 'markdown', source: '⚠ query-task ячейка без спеки — файл повреждён.' };
      }
      const cell: Cell = { id: nextId(), type: 'query-task', source: c.s, task: spec };
      if (c.ref) (cell as { ref?: string }).ref = c.ref;
      if (c.explanation) (cell as { explanation?: string }).explanation = c.explanation;
      return cell;
    }
    if (c.t === 'md') return { id: nextId(), type: 'markdown', source: c.s };
    return { id: nextId(), type: 'code', source: c.s };
  });
  const notebook: Notebook = { cells };
  if (isSolution && parsed.source) {
    return { kind: 'solution', notebook, solutionMeta: parsed.source };
  }
  return { kind: 'lesson', notebook };
}

/**
 * Старый тонкий парсер только для уроков — оставлен ради тестов и
 * loadNotebook (педагог открывает свой собственный ноутбук из панели
 * «Мои ноутбуки», не решение).
 */
export function parseStoredNotebook(text: string): Notebook {
  const parsed = parseAnyFile(text);
  return parsed.notebook;
}

/**
 * Валидация имени нового ноутбука. Разрешаем латиницу/цифры/дефис/
 * подчёркивание/точку. Проверка ДО отправки в GitHub, чтобы не получить
 * невнятный 422.
 */
export function validateNotebookName(name: string): string | null {
  const s = name.trim();
  if (!s) return 'Введи имя';
  if (s.length > 80) return 'Слишком длинное имя (макс 80 символов)';
  if (!/^[A-Za-z0-9_.-]+$/.test(s)) return 'Только латиница, цифры, `-`, `_`, `.`';
  if (s.startsWith('.') || s.startsWith('-')) return 'Не может начинаться с `.` или `-`';
  return null;
}
