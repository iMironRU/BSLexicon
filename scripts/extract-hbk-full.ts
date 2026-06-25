/**
 * ПОЛНЫЙ срез синтакс-помощника 1С — без кураторской фильтрации.
 *
 * В отличие от `extract-hbk.ts` (~178 учебных записей для тренажёра),
 * этот скрипт извлекает ВСЁ что есть в выгрузке: глобальные функции,
 * методы и свойства всех типов платформы 1С — формы, метаданные, файлы,
 * запросы, XML/JSON, HTTP, графики, СКД и т.п. Около 20 тыс. записей.
 *
 * Результат — `public/reference/syntax-help-full.json` (~12 МБ unminified,
 * ~600 КБ gzip). Используется отдельной страницей справочника `/help/full/`
 * (самостоятельный продукт для тех, кто уже знает язык и ищет полный СП
 * удобнее встроенного).
 *
 * ВАЖНО (лицензия): описания и примеры 1С НЕ извлекаем — только структурные
 * факты (имена, сигнатуры, типы, доступность) + публичная ссылка на сайт 1С.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { load as yamlLoad } from 'js-yaml';
import { extractSections, parsePageTitle } from './lib/syntax-html';
import type { Entry } from './lib/syntax-html';

interface BslAnnotation {
  note: string;
  example: { code: string; expect?: string } | null;
}

/**
 * Прочитать курированный catalog/*.yaml рекурсивно, собрать index
 * `id → { note, example }`. Описания и примеры здесь — НАШИ (BSLexicon),
 * НЕ извлечённые из текстов 1С: их можно публиковать как угодно.
 */
function loadAnnotations(catalogRoot: string): Map<string, BslAnnotation> {
  const out = new Map<string, BslAnnotation>();
  if (!existsSync(catalogRoot)) return out;

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!name.endsWith('.yaml')) continue;
      const raw = readFileSync(p, 'utf8');
      const parsed = yamlLoad(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const e = item as Record<string, unknown>;
        const id = typeof e.id === 'string' ? e.id : null;
        const note = typeof e.description === 'string' ? e.description : null;
        if (!id || !note) continue;
        let example: BslAnnotation['example'] = null;
        const exs = e.examples;
        if (Array.isArray(exs) && exs.length > 0) {
          const x = exs[0] as Record<string, unknown>;
          const code = typeof x?.code === 'string' ? x.code.trim() : null;
          const expect = typeof x?.expect === 'string' ? x.expect : undefined;
          if (code) example = { code, ...(expect ? { expect } : {}) };
        }
        out.set(id, { note, example });
      }
    }
  };
  walk(catalogRoot);
  return out;
}

const root = fileURLToPath(new URL('..', import.meta.url));
const source =
  process.env.BSL_HBK_ZIP ??
  process.argv[2] ??
  join(root, 'reference', 'source', '8.3.18_shcntx_ru', 'source', 'FileStorage.data');
const outPath = join(root, 'public', 'reference', 'syntax-help-full.json');

if (!existsSync(source)) {
  console.error(
    `Не найден ZIP справки: ${source}\n` +
      `BSL_HBK_ZIP=/path/FileStorage.data npm run extract:hbk-full`,
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

interface Cls {
  kind: Entry['kind'];
  /** Имя владельца как лежит в архиве (англ. или «Global context»). */
  ownerFromPath: string;
  /** Catalog-сегменты пути ДО владельца — для дерева навигации. */
  catalogPath: string[];
}

function classify(path: string): Cls | null {
  const parts = path.split('/');
  if (parts.length < 4 || !parts[parts.length - 1].endsWith('.html')) return null;
  let i = parts.length - 2;
  while (i > 0 && parts[i] !== 'methods' && parts[i] !== 'properties' && parts[i] !== 'events') {
    i -= 1;
  }
  if (i <= 0) return null;
  const kindFolder = parts[i];
  const ownerFromPath = parts[i - 1];
  if (parts[parts.length - 1] === '__categories__') return null;

  // Catalog-сегменты от `objects/` до владельца (исключая `Global context`).
  // Пример: objects/catalog234/Array/methods/Add772.html → ['catalog234'].
  const catalogPath = parts
    .slice(1, i - 1)
    .filter((p) => p.startsWith('catalog'));

  if (kindFolder === 'events') return { kind: 'event', ownerFromPath, catalogPath };
  if (ownerFromPath === 'Global context') return { kind: 'function', ownerFromPath, catalogPath };
  return {
    kind: kindFolder === 'properties' ? 'property' : 'method',
    ownerFromPath,
    catalogPath,
  };
}

// ── Пред-проход: catalog<N> → его русское имя из V8SH_pagetitle ──────
// Используется UI-деревом: вместо «catalog63» показываем «Общие объекты».
const categoryNames: Record<string, string> = {};
for (const f of htmlFiles) {
  const m = f.path.match(/^objects\/(?:[^/]+\/)*(catalog\d+)\.html$/);
  if (!m) continue;
  const html = (await f.read()).replace(/^﻿/, '');
  const tm = html.match(PAGETITLE_RE);
  if (tm) categoryNames[m[1]] = tm[1].trim();
}
console.log(`→ распознано category-имён: ${Object.keys(categoryNames).length}`);

// Курированные аннотации BSLexicon (наши описания/примеры) для подмеса
// в полную выгрузку. Источник — catalog/**/*.yaml.
const annotations = loadAnnotations(join(root, 'catalog'));
console.log(`→ загружено BSLexicon-аннотаций: ${annotations.size}`);

const entries: Entry[] = [];
// Карта «русское имя owner-а → catalog-путь от корня». Для дерева хватит
// одного пути на owner (даже если он встречается в нескольких разделах —
// в выгрузке это редкость, берём первый).
const ownerPaths: Record<string, string[]> = {};
let skipped = 0;
let annotated = 0;

for (const f of htmlFiles) {
  const cls = classify(f.path);
  if (!cls) continue;
  const html = (await f.read()).replace(/^﻿/, '');
  const tm = html.match(PAGETITLE_RE);
  if (!tm) {
    skipped += 1;
    continue;
  }
  const parsed = parsePageTitle(tm[1]);
  if (!parsed) {
    skipped += 1;
    continue;
  }
  // Сохраняем путь к владельцу один раз
  if (!ownerPaths[parsed.owner]) {
    ownerPaths[parsed.owner] = cls.catalogPath;
  }
  const sections = extractSections(html, cls.kind);
  // id-схема: function — `nameRu`; method/property/event — `owner.nameRu`.
  // Совпадает с тем, что использует /help/full/ и /help/events/.
  const id = cls.kind === 'function' ? parsed.nameRu : `${parsed.owner}.${parsed.nameRu}`;
  const ann = annotations.get(id);
  if (ann) annotated += 1;

  entries.push({
    owner: parsed.owner,
    ownerEn: parsed.ownerEn,
    kind: cls.kind,
    category: parsed.owner, // в полной версии «категория» = имя типа-владельца
    nameRu: parsed.nameRu,
    nameEn: parsed.nameEn,
    ...sections,
    bslNote: ann?.note ?? null,
    bslExample: ann?.example ?? null,
  });
}

entries.sort((a, b) =>
  a.owner === b.owner
    ? a.nameRu.localeCompare(b.nameRu, 'ru')
    : a.owner.localeCompare(b.owner, 'ru'),
);

mkdirSync(dirname(outPath), { recursive: true });
// Без отступов — экономим ~30% объёма JSON. UI всё равно парсит через JSON.parse.
writeFileSync(
  outPath,
  JSON.stringify({ total: entries.length, entries, ownerPaths, categoryNames }),
);

const byKind = new Map<string, number>();
for (const e of entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);

console.log(
  `\n✓ Извлечено ${entries.length} записей (пропущено без заголовка/parsePageTitle: ${skipped}).`,
);
for (const [k, n] of byKind) console.log(`  ${String(n).padStart(6)}  ${k}`);
console.log(`  с BSLexicon-аннотацией: ${annotated} (${((annotated / entries.length) * 100).toFixed(1)}%)`);
console.log(`  → ${outPath.slice(root.length + 1)}`);
