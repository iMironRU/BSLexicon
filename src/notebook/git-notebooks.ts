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
 *
 * Сериализация ячеек — через `cell-codec.ts` (общий с draft и URL). Здесь
 * добавлены solution-специфичные поля (`role`, `source`, snapshot spec
 * для task/query-task) — они не входят в canonical StoredCell, потому
 * что живут только в файлах-решениях этого модуля.
 */

import { listDirectory, readFile, writeFile } from '../app/git-storage';
import type { GitConfig } from '../app/git-config';
import type { Cell, Notebook } from './types';
import { fromStored, toStored, type DecodeDefaults, type StoredCell } from './cell-codec';
import { DEFAULT_QUERY_TASK, DEFAULT_TASK, EMPTY_QUERY_DATA, EMPTY_QUERY_SCHEMA } from './cell-defaults';

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
  const payload: StoredNotebook = { v: 1, cells: nb.cells.map(toStored) };
  return JSON.stringify(payload, null, 2);
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `g${idCounter}`;
}

const DECODE_DEFAULTS: DecodeDefaults = {
  task: DEFAULT_TASK,
  queryTask: DEFAULT_QUERY_TASK,
  querySchema: EMPTY_QUERY_SCHEMA,
  queryData: EMPTY_QUERY_DATA,
};

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
 * task-cell вместо `task` там `task_snapshot` (аналогично `query_task`).
 * cell-codec.ts принимает и то, и другое: snapshot побеждает у него в
 * fromStored, если он есть. См. `docs/education/README.md` §4.3 и #31.
 *
 * Кидает при битом JSON / неверной схеме.
 */
export function parseAnyFile(text: string): ParsedFile {
  const parsed = JSON.parse(text) as StoredNotebook;
  if (parsed.v !== 1 || !Array.isArray(parsed.cells)) {
    throw new Error('Не поддерживаемая схема ноутбука (не v: 1)');
  }
  const isSolution = parsed.role === 'solution';
  const cells: Cell[] = [];
  for (const c of parsed.cells) {
    // Битая query-task ячейка без spec — не крашим ноутбук, показываем как
    // markdown с текстом ошибки. Это специфика git-файлов: educator мог
    // руками поправить spec неправильно и мы всё равно должны открыться.
    if (c.t === 'query-task' && !c.query_task && !c.query_task_snapshot && !c.task) {
      cells.push({ id: nextId(), type: 'markdown', source: '⚠ query-task ячейка без спеки — файл повреждён.' });
      continue;
    }
    cells.push(fromStored(c, nextId, DECODE_DEFAULTS));
  }
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
