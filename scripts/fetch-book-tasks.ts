/**
 * Загрузка задач Judge из релиз-ассетов книг. Тонкая обёртка над
 * `src/judge/book-fetch` — читает `catalog/books.yaml`, скачивает
 * `tasks.json` из релиза каждой enabled-книги, валидирует и кладёт
 * в `public/reference/judge-<book_id>.json`.
 *
 * Ошибка на любом шаге для enabled-книги = ненулевой exit → CI красный.
 * Читатель не должен видеть битую задачу.
 *
 * Запускается автоматически на prebuild. Ручной запуск: `npm run fetch:book-tasks`.
 * `SKIP_BOOK_FETCH=1` пропускает шаг — для локальных сборок с уже кэшированными задачами.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetUrl, parseRegistry, validateTasksJson, type BookRecord } from '../src/judge/book-fetch';

const root = fileURLToPath(new URL('..', import.meta.url));
const registryPath = join(root, 'judge', 'books.yaml');
const schemaPath = join(root, 'docs', 'book-integration', 'task-schema.json');
const outDir = join(root, 'public', 'reference');

if (process.env.SKIP_BOOK_FETCH === '1') {
  console.log('→ SKIP_BOOK_FETCH=1: пропускаем загрузку задач из книг');
  process.exit(0);
}

if (!existsSync(registryPath)) {
  console.error(`judge/books.yaml не найден по пути ${registryPath}`);
  process.exit(1);
}
if (!existsSync(schemaPath)) {
  console.error(`docs/book-integration/task-schema.json не найден по пути ${schemaPath}`);
  process.exit(1);
}

const registry = parseRegistry(readFileSync(registryPath, 'utf8'));
const enabled = registry.filter((b) => b.enabled);
if (enabled.length === 0) {
  console.log('→ В catalog/books.yaml нет активных книг — нечего качать');
  process.exit(0);
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
mkdirSync(outDir, { recursive: true });

let hadFailure = false;
for (const book of enabled) {
  try {
    await fetchOne(book);
    console.log(`  ✓ ${book.id} (${book.repo}@${book.pinned_tag})`);
  } catch (e) {
    hadFailure = true;
    console.error(`  ✗ ${book.id}: ${(e as Error).message}`);
  }
}

if (hadFailure) {
  console.error('\n✗ Хотя бы одна книга не прошла загрузку/валидацию. Сборка прервана.');
  process.exit(1);
}
console.log(`\n✓ Загружено книг: ${enabled.length}`);

async function fetchOne(book: BookRecord): Promise<void> {
  const url = assetUrl(book);
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${r.statusText}`);
  const text = await r.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`tasks.json не парсится как JSON: ${(e as Error).message}`);
  }
  const file = validateTasksJson(raw, schema, book);
  writeFileSync(join(outDir, `judge-${book.id}.json`), JSON.stringify(file));
}
