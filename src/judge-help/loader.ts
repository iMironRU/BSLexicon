/**
 * Загрузка judge-index.json и по нужде — judge-<book_id>.json.
 * Индекс лежит в bundle (сгенерирован prebuild-скриптом), задачи каждой
 * книги — отдельный JSON, тянется по запросу. Разово кэшируем промисом.
 */

import type { Task, TasksFile } from '../judge/types';

export interface BookIndexEntry {
  id: string;
  title: string;
  version: string;
  repo: string;
  site?: string;
  taskCount: number;
}

export interface JudgeIndex {
  books: BookIndexEntry[];
}

const BASE = import.meta.env.BASE_URL;

let indexCache: Promise<JudgeIndex> | null = null;
const bookCache = new Map<string, Promise<TasksFile>>();

export function loadJudgeIndex(): Promise<JudgeIndex> {
  if (!indexCache) {
    indexCache = fetch(`${BASE}reference/judge-index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Не удалось загрузить judge-index.json (${r.status})`);
        return r.json() as Promise<JudgeIndex>;
      })
      .catch((e) => {
        indexCache = null;
        throw e;
      });
  }
  return indexCache;
}

export function loadBookTasks(bookId: string): Promise<TasksFile> {
  const cached = bookCache.get(bookId);
  if (cached) return cached;
  const p = fetch(`${BASE}reference/judge-${bookId}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Не удалось загрузить judge-${bookId}.json (${r.status})`);
      return r.json() as Promise<TasksFile>;
    })
    .catch((e) => {
      bookCache.delete(bookId);
      throw e;
    });
  bookCache.set(bookId, p);
  return p;
}

/** Найти задачу в уже загруженной книге. */
export function findTask(file: TasksFile, taskId: string): Task | null {
  return file.tasks.find((t) => t.id === taskId) ?? null;
}
