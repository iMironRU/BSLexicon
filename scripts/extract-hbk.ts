/**
 * Индексация СТРУКТУРНЫХ ФАКТОВ из .hbk-выгрузки синтакс-помощника 1С.
 *
 * `.hbk` это родной формат справки 1С: бинарный контейнер с упакованной
 * базой. Реальный носитель статей внутри — `FileStorage.data`, который
 * под капотом обычный ZIP (`PK\x03\x04`) с ~50k файлов в дереве:
 *
 *   objects/Global context/methods/<catalogId>/<Name><ID>.html  — функция
 *   objects/<TYPE>/methods/<...>.html                            — метод типа
 *   objects/<TYPE>/properties/<...>.html                         — свойство типа
 *   objects/<catalogId>.html                                     — заголовок категории
 *
 * Внутри HTML — те же V8SH_pagetitle / V8SH_chapter секции, что и в
 * XML-варианте; парсинг переиспользуется из `scripts/lib/syntax-html.ts`.
 *
 * ВАЖНО (лицензия): тексты СП — собственность «1С». Берём только факты —
 * имена ru/en, сигнатуры, параметры (тип/обязательность), возвращаемый тип,
 * доступность, категорию. Описания и примеры 1С НЕ извлекаем.
 *
 * Источник (~120 МБ) в репозиторий не коммитим. По умолчанию ищется
 * reference/source/8.3.18_shcntx_ru/source/FileStorage.data;
 * путь можно переопределить через BSL_HBK_ZIP или первым аргументом.
 * Результат — public/reference/syntax-help.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
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
  process.env.BSL_HBK_ZIP ??
  process.argv[2] ??
  join(root, 'reference', 'source', '8.3.18_shcntx_ru', 'source', 'FileStorage.data');
const outPath = join(root, 'public', 'reference', 'syntax-help.json');

if (!existsSync(source)) {
  console.error(
    `Не найден ZIP справки: ${source}\n` +
      `Укажите путь к FileStorage.data: BSL_HBK_ZIP=/path/FileStorage.data npm run extract:hbk`,
  );
  process.exit(1);
}

console.log(`→ читаем ${source}`);
const buf = readFileSync(source);
const zip = await JSZip.loadAsync(buf);

interface ZipFile {
  path: string;
  read(): Promise<string>;
}
const htmlFiles: ZipFile[] = [];
zip.forEach((path, file) => {
  if (file.dir) return;
  if (!path.endsWith('.html')) return;
  htmlFiles.push({ path, read: () => file.async('string') });
});
console.log(`→ всего .html в архиве: ${htmlFiles.length}`);

const PAGETITLE_RE = /<h1 class="V8SH_pagetitle">([^<]*)<\/h1>/;

// ── Пред-проход: catalogId → исходное имя категории (русское) ─────────
const categoryById = new Map<string, string>();
for (const f of htmlFiles) {
  const m = f.path.match(/^objects\/[^/]+\/methods\/(catalog\d+)\.html$/);
  if (!m) continue;
  const html = (await f.read()).replace(/^﻿/, '');
  const tm = html.match(PAGETITLE_RE);
  if (tm) categoryById.set(m[1], tm[1].trim());
}
console.log(`→ распознано категорий: ${categoryById.size}`);

// ── Основной проход: статьи функций/методов/свойств ──────────────────
const entries: Entry[] = [];
let skippedNoTitle = 0;
let skippedCategory = 0;

interface ClassifiedPath {
  /** Имя владельца, как оно лежит в архиве (английское или «Global context»). */
  ownerFromPath: string;
  kind: Entry['kind'];
  /** ID каталога-категории для глобальных функций (`catalog4838` → «Строки»). */
  catalogId: string | null;
}

/**
 * Классифицирует HTML-путь в архиве. `null` — пропускаем (не статья метода/функции/свойства).
 *
 * Архив 1С использует англоязычные имена типов в путях
 * (`Array`, `Structure`, `ValueTable`), но статья внутри HTML несёт русский
 * заголовок «Массив.Добавить (Array.Add)» — на нём строится `owner`
 * для курации. Здесь же нам важно лишь определить kind и контекст.
 */
function classify(path: string): ClassifiedPath | null {
  const parts = path.split('/');
  if (parts.length < 4 || !parts[parts.length - 1].endsWith('.html')) return null;

  // Ищем сегмент 'methods'/'properties' от конца (kindFolder), а владелец —
  // непосредственно перед ним.
  let i = parts.length - 2;
  while (i > 0 && parts[i] !== 'methods' && parts[i] !== 'properties') i -= 1;
  if (i <= 0) return null;

  const kindFolder = parts[i];
  const ownerFromPath = parts[i - 1];

  // Заголовок раздела вида `objects/<TYPE>/methods/__categories__` или
  // `objects/.../methods/catalog<N>.html` — это «папка» в дереве; статья
  // самой функции/метода лежит на уровень ниже.
  const tail = parts[parts.length - 1];
  if (tail === '__categories__') return null;

  if (ownerFromPath === 'Global context') {
    // Категория глобальной функции — папка между `methods` и финальным файлом.
    const catFolder = parts[i + 1];
    const catalogId = catFolder && catFolder.startsWith('catalog') ? catFolder : null;
    return { ownerFromPath, kind: 'function', catalogId };
  }

  return {
    ownerFromPath,
    kind: kindFolder === 'properties' ? 'property' : 'method',
    catalogId: null,
  };
}

for (const f of htmlFiles) {
  const cls = classify(f.path);
  if (!cls) continue;

  const html = (await f.read()).replace(/^﻿/, '');
  const tm = html.match(PAGETITLE_RE);
  if (!tm) {
    skippedNoTitle += 1;
    continue;
  }
  const parsed = parsePageTitle(tm[1]);
  if (!parsed) {
    // Заголовок не в формате «Владелец.Имя (OwnerEN.NameEN)» — статья
    // раздела или иная не-целевая страница (тоже фильтр).
    skippedNoTitle += 1;
    continue;
  }
  const { owner, nameRu, ownerEn, nameEn } = parsed;

  let category: string | null;
  if (owner === GLOBAL) {
    const rawCategory = cls.catalogId ? categoryById.get(cls.catalogId) : undefined;
    category = globalCategory(rawCategory, nameRu);
  } else if (COLLECTION_OWNERS.has(owner)) {
    category = 'Коллекции';
  } else {
    category = null;
  }
  if (!category) {
    skippedCategory += 1;
    continue;
  }

  entries.push({
    owner,
    ownerEn,
    kind: cls.kind,
    category,
    nameRu,
    nameEn,
    ...extractSections(html, cls.kind),
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

console.log(
  `\n✓ Извлечено ${entries.length} учебных записей ` +
    `(пропущено без заголовка: ${skippedNoTitle}, по нецелевой категории: ${skippedCategory}).`,
);
for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${cat}`);
}
console.log('  → public/reference/syntax-help.json');
