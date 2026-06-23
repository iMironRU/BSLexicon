/**
 * Извлечение СТРУКТУРНЫХ ФАКТОВ из выгрузки синтакс-помощника 1С
 * (справочник «ЭлементыДокументации» в формате _1CV8DtUD).
 *
 * Для нового рабочего источника — `.hbk` родного формата 1С —
 * используется `extract-hbk.ts`; этот скрипт оставлен как альтернатива
 * для пользователей, у которых на руках XML-выгрузка.
 *
 * ВАЖНО (лицензия): тексты СП — собственность «1С». Берём только факты —
 * имена ru/en, сигнатуры, параметры (тип/обязательность), возвращаемый тип,
 * доступность, категорию. Описания и примеры 1С НЕ извлекаем (пишем свои).
 *
 * Источник (~110 МБ) в репозиторий не коммитим. По умолчанию берётся
 * reference/source/syntax-help-export.xml; путь можно переопределить через
 * BSL_SP_EXPORT или первым аргументом. Результат — public/reference/syntax-help.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTION_OWNERS,
  GLOBAL,
  extractSections,
  globalCategory,
  parsePageTitle,
} from './lib/syntax-html';
import type { Entry } from './lib/syntax-html';

const root = fileURLToPath(new URL('..', import.meta.url));
const source =
  process.env.BSL_SP_EXPORT ??
  process.argv[2] ??
  join(root, 'reference', 'source', 'syntax-help-export.xml');
const outPath = join(root, 'public', 'reference', 'syntax-help.json');

if (!existsSync(source)) {
  console.error(`Не найдена выгрузка: ${source}\nУкажите путь: BSL_SP_EXPORT=/path/export.xml npm run extract:sp`);
  process.exit(1);
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Значение тега; терпит атрибуты (например, у Ref/Parent есть xsi:type). */
function field(record: string, tag: string): string | null {
  const m = record.match(new RegExp(`<v8:${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</v8:${tag}>`));
  return m ? m[1] : null;
}

const xml = readFileSync(source, 'utf8').replace(/^﻿/, '');
const records = xml.split('<v8:CatalogObject.ЭлементыДокументации>').slice(1);

// Пред-проход: Ref → Description (для резолва категории по папке-родителю).
const refDescription = new Map<string, string>();
for (const record of records) {
  const ref = field(record, 'Ref');
  const desc = field(record, 'Description');
  if (ref && desc) refDescription.set(ref, desc);
}

const entries: Entry[] = [];
let skipped = 0;

for (const record of records) {
  if (field(record, 'IsFolder') === 'true') continue;
  const htmlRaw = field(record, 'ТекстHTML');
  if (!htmlRaw) continue;
  const html = xmlUnescape(htmlRaw);

  const title = html.match(/<h1 class="V8SH_pagetitle">([^<]*)<\/h1>/);
  if (!title) {
    skipped += 1;
    continue;
  }
  const parsed = parsePageTitle(title[1]);
  if (!parsed) {
    skipped += 1;
    continue;
  }
  const { owner, nameRu, ownerEn, nameEn } = parsed;

  let category: string | null;
  if (owner === GLOBAL) {
    const parentRef = field(record, 'Parent');
    category = globalCategory(parentRef ? refDescription.get(parentRef) : undefined, nameRu);
  } else if (COLLECTION_OWNERS.has(owner)) {
    category = 'Коллекции';
  } else {
    category = null;
  }
  if (!category) continue;

  const path = field(record, 'ПутьКHTML') ?? '';
  const kind: Entry['kind'] =
    owner === GLOBAL ? 'function' : path.includes('/properties/') ? 'property' : 'method';

  entries.push({
    owner,
    ownerEn,
    kind,
    category,
    nameRu,
    nameEn,
    ...extractSections(html, kind),
  });
}

entries.sort((a, b) =>
  a.category === b.category
    ? a.nameRu.localeCompare(b.nameRu)
    : a.category.localeCompare(b.category),
);

const byCategory = new Map<string, number>();
for (const e of entries) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      note: 'Курированное учебное подмножество синтакс-помощника 1С. Только структурные факты (описания/примеры — собственность «1С» — не извлекаются).',
      total: entries.length,
      entries,
    },
    null,
    2,
  ),
);

console.log(`✓ Извлечено ${entries.length} учебных записей (пропущено без заголовка: ${skipped}).`);
for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${cat}`);
}
console.log('  → public/reference/syntax-help.json');
