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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { extractSections, parsePageTitle } from './lib/syntax-html';
import type { Entry } from './lib/syntax-html';

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

  // События — отдельный kind: лежат в .../<TYPE>/events/<Event><ID>.html
  if (kindFolder === 'events') return { kind: 'event', ownerFromPath };

  if (ownerFromPath === 'Global context') return { kind: 'function', ownerFromPath };
  return {
    kind: kindFolder === 'properties' ? 'property' : 'method',
    ownerFromPath,
  };
}

const entries: Entry[] = [];
let skipped = 0;

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
  entries.push({
    owner: parsed.owner,
    ownerEn: parsed.ownerEn,
    kind: cls.kind,
    category: parsed.owner, // в полной версии «категория» = имя типа-владельца
    nameRu: parsed.nameRu,
    nameEn: parsed.nameEn,
    ...extractSections(html, cls.kind),
  });
}

entries.sort((a, b) =>
  a.owner === b.owner
    ? a.nameRu.localeCompare(b.nameRu, 'ru')
    : a.owner.localeCompare(b.owner, 'ru'),
);

mkdirSync(dirname(outPath), { recursive: true });
// Без отступов — экономим ~30% объёма JSON. UI всё равно парсит через JSON.parse.
writeFileSync(outPath, JSON.stringify({ total: entries.length, entries }));

const byKind = new Map<string, number>();
for (const e of entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);

console.log(
  `\n✓ Извлечено ${entries.length} записей (пропущено без заголовка/parsePageTitle: ${skipped}).`,
);
for (const [k, n] of byKind) console.log(`  ${String(n).padStart(6)}  ${k}`);
console.log(`  → ${outPath.slice(root.length + 1)}`);
