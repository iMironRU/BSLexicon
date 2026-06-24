/**
 * Импорт «stub-записей» в каталог: всё что есть в выгрузке СП
 * (`public/reference/syntax-help.json`), но отсутствует в курированном
 * YAML, кладётся в `catalog/stubs/<category>.yaml`. Stubs участвуют только
 * в справочнике (`/help/`) — рантайм-инвариант на них не распространяется,
 * описаний/примеров у них нет (тексты СП — собственность «1С»),
 * только ссылка на источник.
 *
 * Идемпотентность: stubs целиком переписываются при каждом запуске;
 * курированные YAML-файлы НЕ трогаем. Если запись добавили в основной
 * каталог — она исчезает из stubs автоматически.
 */
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, dump } from 'js-yaml';
import type { CatalogEntry } from '../src/core/catalog/types';
import type { SyntaxEntry } from '../src/app/reference/types';

const root = fileURLToPath(new URL('..', import.meta.url));
const catalogDir = join(root, 'catalog');
const stubsDir = join(catalogDir, 'stubs');
const jsonPath = join(root, 'public', 'reference', 'syntax-help.json');

/** Идентификатор каталога для SyntaxEntry: «СокрЛП» / «Массив.Добавить». */
function idOf(e: SyntaxEntry): string {
  return e.kind === 'function' ? e.nameRu : `${e.owner}.${e.nameRu}`;
}

/** Все YAML-файлы каталога, КРОМЕ stubs (источник «известных» id). */
function readCuratedIds(): Set<string> {
  const ids = new Set<string>();
  for (const name of readdirSync(catalogDir)) {
    if (name === 'stubs' || name === 'schema.json') continue;
    const sub = join(catalogDir, name);
    if (!statSync(sub).isDirectory()) continue;
    for (const file of readdirSync(sub)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const raw = readFileSync(join(sub, file), 'utf8');
      const data = load(raw);
      if (Array.isArray(data)) {
        for (const e of data as CatalogEntry[]) ids.add(e.id);
      }
    }
  }
  return ids;
}

/** Учебная категория stub-записи (для группировки в YAML-файлы). */
function stubCategory(e: SyntaxEntry): string {
  // Функции — по своей учебной категории; методы/свойства — по типу-владельцу.
  if (e.kind === 'function') return e.category;
  return e.owner; // «Массив», «ТаблицаЗначений», «СписокЗначений», …
}

/** Файл в stubs/ — по slug категории. */
const SLUG: Record<string, string> = {
  Строки: 'strings',
  Числа: 'numbers',
  Даты: 'dates',
  Преобразование: 'conversion',
  Форматирование: 'formatting',
  Тип: 'type',
  Прочее: 'misc',
};
function fileSlug(category: string): string {
  if (SLUG[category]) return SLUG[category];
  // Кириллица → латинская транслитерация. Делать в полную силу не нужно:
  // имена типов уникальны латиницей (Массив = array). Используем nameEn-подобный slug.
  return category
    .toLowerCase()
    .replace(/таблицазначений/g, 'value-table')
    .replace(/строкатаблицызначений/g, 'value-table-row')
    .replace(/колонкатаблицызначений/g, 'value-table-column')
    .replace(/коллекцияколоноктаблицызначений/g, 'value-table-columns')
    .replace(/списокзначений/g, 'value-list')
    .replace(/элементсписказначений/g, 'value-list-item')
    .replace(/ключизначение/g, 'key-and-value')
    .replace(/массив/g, 'array')
    .replace(/структура/g, 'structure')
    .replace(/соответствие/g, 'map')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Превращает SyntaxEntry → CatalogEntry в формате stub. События исключены до этой точки. */
function toCatalogEntry(
  e: SyntaxEntry & { kind: Exclude<SyntaxEntry['kind'], 'event'> },
  ownerCategory: string,
): CatalogEntry {
  // Сигнатура: или из выгрузки (когда есть), или синтез из nameRu+params.
  const signature =
    e.signature?.trim() ||
    `${e.nameRu}(${(e.params ?? []).map((p) => `<${p.name}>`).join(', ')})`;

  const entry: CatalogEntry = {
    id: idOf(e),
    kind: e.kind,
    names: { ru: e.nameRu, en: e.nameEn },
    category: ownerCategory,
    description: '(только справка — полное описание и примеры на сайте 1С по ссылке ниже)',
  };
  entry.signature = signature;
  if (e.params && e.params.length > 0) {
    entry.params = e.params.map((p) => ({
      name: p.name,
      type: p.type ?? 'Произвольный',
      optional: p.optional || undefined,
    })) as CatalogEntry['params'];
  }
  if (e.returnType) entry.returns = { type: e.returnType };
  if (e.referenceUrl) entry.referenceUrl = e.referenceUrl;
  return entry;
}

// ── Основной поток ───────────────────────────────────────────────────

const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as { entries: SyntaxEntry[] };
const curated = readCuratedIds();
console.log(`→ курированных записей в catalog/: ${curated.size}`);
console.log(`→ записей в выгрузке: ${json.entries.length}`);

// События — отдельный домен (страница `/help/events/`); в курированный
// каталог тренажёра не пихаем.
type NonEventSyntax = SyntaxEntry & { kind: Exclude<SyntaxEntry['kind'], 'event'> };
const importable: NonEventSyntax[] = json.entries.filter(
  (e): e is NonEventSyntax => e.kind !== 'event',
);
const missing = importable.filter((e) => !curated.has(idOf(e)));
console.log(`→ stub-кандидатов (есть в выгрузке, нет в каталоге): ${missing.length}`);

// Группируем по учебной категории / типу
const byBucket = new Map<string, CatalogEntry[]>();
for (const e of missing) {
  const cat = stubCategory(e);
  const list = byBucket.get(cat) ?? [];
  list.push(toCatalogEntry(e, cat));
  byBucket.set(cat, list);
}

// Сносим старые stubs и кладём новые с нуля (идемпотентность).
rmSync(stubsDir, { recursive: true, force: true });
mkdirSync(stubsDir, { recursive: true });

if (byBucket.size === 0) {
  console.log('✓ Все записи выгрузки уже в курированном каталоге — stubs не созданы.');
} else {
  for (const [cat, entries] of byBucket) {
    entries.sort((a, b) => a.names.ru.localeCompare(b.names.ru, 'ru'));
    const file = join(stubsDir, `${fileSlug(cat)}.yaml`);
    const header =
      `# Stub-записи категории «${cat}» — только для справочника (/help/).\n` +
      `# Сгенерировано автоматически: scripts/import-stubs.ts.\n` +
      `# При курации переносите запись в основной каталог (catalog/<вид>/...) с\n` +
      `# собственным описанием и runnable-примерами, и она исчезнет отсюда.\n\n`;
    writeFileSync(file, header + dump(entries, { lineWidth: 100, noRefs: true }));
    console.log(`  ${String(entries.length).padStart(4)}  ${cat} → ${file.slice(root.length + 1)}`);
  }
}
