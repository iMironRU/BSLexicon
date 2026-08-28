/**
 * Pure-часть загрузки задач из книг: парсинг реестра, валидация
 * `tasks.json` по JSON Schema, сравнение версий. Сетевой и файловый
 * ввод-вывод — в `scripts/fetch-book-tasks.ts`.
 */

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { load as yamlLoad } from 'js-yaml';
import type { TasksFile } from './types';

export interface BookRecord {
  id: string;
  repo: string;
  pinned_tag: string;
  enabled: boolean;
  min_version?: string;
}

/**
 * Разбор `judge/books.yaml`. Бросает если запись невалидна —
 * реестр читаем один раз при старте скрипта, лучше упасть громко.
 */
export function parseRegistry(yaml: string): BookRecord[] {
  const parsed = yamlLoad(yaml) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('judge/books.yaml должен быть YAML-массивом записей');
  }
  return parsed.map((raw, i) => normalizeRecord(raw, i));
}

function normalizeRecord(raw: unknown, i: number): BookRecord {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Запись #${i + 1}: должна быть объектом`);
  }
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== 'string' || typeof b.repo !== 'string' || typeof b.pinned_tag !== 'string') {
    throw new Error(`Запись #${i + 1}: обязательны id, repo, pinned_tag`);
  }
  return {
    id: b.id,
    repo: b.repo,
    pinned_tag: b.pinned_tag,
    enabled: typeof b.enabled === 'boolean' ? b.enabled : true,
    min_version: typeof b.min_version === 'string' ? b.min_version : undefined,
  };
}

/**
 * Валидация JSON tasks.json по schema + бизнес-инварианты (совпадение
 * `book.id` с реестром, `min_version` если задан). Возвращает
 * типизированный `TasksFile`; бросает `Error` с осмысленным сообщением.
 */
export function validateTasksJson(
  raw: unknown,
  schema: Record<string, unknown>,
  book: BookRecord,
): TasksFile {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv); // подключаем `format: uri` и остальные стандартные
  const validate = ajv.compile(schema);
  const ok = validate(raw);
  if (!ok) {
    const details = (validate.errors ?? []).slice(0, 3).map(formatAjvError).join('; ');
    throw new Error(`не соответствует схеме: ${details}`);
  }
  const file = raw as TasksFile;

  if (file.book.id !== book.id) {
    throw new Error(
      `book.id в tasks.json (${file.book.id}) не совпадает с записью реестра (${book.id})`,
    );
  }
  if (book.min_version && !meetsMinVersion(file.book.version, book.min_version)) {
    throw new Error(
      `book.version=${file.book.version} ниже min_version=${book.min_version} — тег указывает на несовместимую сборку`,
    );
  }

  return file;
}

/**
 * Формирует прямую ссылку на релиз-ассет.
 * `https://github.com/<owner>/<repo>/releases/download/<tag>/tasks.json`.
 */
export function assetUrl(book: BookRecord): string {
  return `https://github.com/${book.repo}/releases/download/${encodeURIComponent(book.pinned_tag)}/tasks.json`;
}

/**
 * Сравнение SemVer-подобных версий по числовым сегментам: `0.2.0`,
 * `1.10.3`. Не полный SemVer — не поддерживает pre-release метки,
 * но нам достаточно.
 */
export function meetsMinVersion(version: string, min: string): boolean {
  const parse = (s: string): number[] =>
    s
      .split(/[^\d]/)
      .filter((x) => x.length > 0)
      .map((n) => Number(n));
  const va = parse(version);
  const mb = parse(min);
  const len = Math.max(va.length, mb.length);
  for (let i = 0; i < len; i += 1) {
    const a = va[i] ?? 0;
    const b = mb[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function formatAjvError(e: {
  instancePath?: string;
  message?: string;
  keyword?: string;
  params?: Record<string, unknown>;
}): string {
  const path = e.instancePath || '(root)';
  return `${path} ${e.message ?? e.keyword ?? 'invalid'}`;
}
