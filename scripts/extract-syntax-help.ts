/**
 * Извлечение СТРУКТУРНЫХ ФАКТОВ из выгрузки синтакс-помощника 1С
 * (справочник «ЭлементыДокументации» в формате _1CV8DtUD).
 *
 * ВАЖНО (лицензия): тексты СП — собственность «1С». Берём только факты —
 * имена ru/en, сигнатуры, параметры (тип/обязательность), возвращаемый тип,
 * доступность. Описания и примеры 1С НЕ извлекаем (пишем свои).
 *
 * Источник (~110 МБ) в репозиторий не коммитим. Путь — через переменную
 * окружения BSL_SP_EXPORT или первым аргументом:
 *   BSL_SP_EXPORT=/path/to/export.xml npm run extract:sp
 *
 * Результат — reference/syntax-help.json (факты, можно коммитить).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.env.BSL_SP_EXPORT ?? process.argv[2];
if (!source) {
  console.error('Укажите путь к выгрузке: BSL_SP_EXPORT=/path/export.xml npm run extract:sp');
  process.exit(1);
}

// Корень репозитория: на уровень выше папки scripts/.
const root = fileURLToPath(new URL('..', import.meta.url));
// В public/ — чтобы Vite отдавал статикой, а панель-справочник грузила лениво (fetch).
const outPath = join(root, 'public', 'reference', 'syntax-help.json');

/** Типы-владельцы, чьи члены нас интересуют (помимо глобального контекста). */
const COLLECTION_OWNERS = new Set([
  'Массив',
  'Структура',
  'Соответствие',
  'СписокЗначений',
  'ЭлементСпискаЗначений',
  'ТаблицаЗначений',
  'СтрокаТаблицыЗначений',
  'КолонкаТаблицыЗначений',
  'КоллекцияКолонокТаблицыЗначений',
  'КлючИЗначение',
]);
const GLOBAL = 'Глобальный контекст';

interface Param {
  name: string;
  type: string | null;
  optional: boolean;
}
interface Entry {
  owner: string;
  ownerEn: string;
  kind: 'function' | 'method' | 'property';
  nameRu: string;
  nameEn: string;
  signature: string | null;
  params: Param[];
  returnType: string | null;
  availability: string[];
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Снимает HTML-теги и декодирует HTML-сущности до читаемого текста. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

function field(record: string, tag: string): string | null {
  const m = record.match(new RegExp(`<v8:${tag}>([\\s\\S]*?)</v8:${tag}>`));
  return m ? m[1] : null;
}

/** Делит тело статьи на секции по заголовкам V8SH_chapter. */
function sections(bodyHtml: string): Map<string, string> {
  const re = /<p class="V8SH_chapter">\s*([^<:]+?)\s*:?\s*<\/p>/g;
  const marks: { title: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml))) {
    marks.push({ title: m[1].trim(), start: m.index, end: re.lastIndex });
  }
  const out = new Map<string, string>();
  for (let i = 0; i < marks.length; i++) {
    const contentStart = marks[i].end;
    const contentEnd = i + 1 < marks.length ? marks[i + 1].start : bodyHtml.length;
    out.set(marks[i].title, bodyHtml.slice(contentStart, contentEnd));
  }
  return out;
}

/** Тип из фрагмента «Тип: <a>Строка</a>.» */
function parseType(html: string | undefined): string | null {
  if (!html) return null;
  const text = htmlToText(html);
  const m = text.match(/Тип:\s*([^.,\n]+)/);
  return m ? m[1].trim() : null;
}

function parseParams(html: string | undefined): Param[] {
  if (!html) return [];
  const params: Param[] = [];
  const blocks = html.split(/<div class="V8SH_rubric">/).slice(1);
  for (const block of blocks) {
    const rubricEnd = block.indexOf('</div>');
    const rubric = htmlToText(rubricEnd >= 0 ? block.slice(0, rubricEnd) : block);
    const rest = rubricEnd >= 0 ? block.slice(rubricEnd + 6) : '';
    // «<Имя> (обязательный)» или «Имя (необязательный)»
    const nm = rubric.match(/^<?([A-Za-zА-Яа-яЁё0-9_]+)>?/);
    if (!nm) continue;
    const optional = /необязательный/i.test(rubric);
    params.push({ name: nm[1], type: parseType(rest), optional });
  }
  return params;
}

function parseAvailability(html: string | undefined): string[] {
  if (!html) return [];
  return htmlToText(html)
    .split(',')
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

const xml = readFileSync(source, 'utf8').replace(/^﻿/, '');
const records = xml.split('<v8:CatalogObject.ЭлементыДокументации>').slice(1);

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
  // «Владелец.Имя (OwnerEN.NameEN)»
  const t = htmlToText(title[1]);
  const parsed = t.match(/^(.+?)\.([^.(]+?)\s*\(([^.]+?)\.([^)]+?)\)\s*$/);
  if (!parsed) {
    skipped += 1;
    continue;
  }
  const [, owner, nameRu, ownerEn, nameEn] = parsed.map((s) => s.trim());

  if (owner !== GLOBAL && !COLLECTION_OWNERS.has(owner)) continue;

  const path = field(record, 'ПутьКHTML') ?? '';
  const kind: Entry['kind'] =
    owner === GLOBAL ? 'function' : path.includes('/properties/') ? 'property' : 'method';

  const secs = sections(html);
  const signature = secs.has('Синтаксис')
    ? htmlToText(secs.get('Синтаксис')!).replace(/\s+/g, ' ').trim() || null
    : null;

  entries.push({
    owner,
    ownerEn,
    kind,
    nameRu,
    nameEn,
    signature,
    params: kind === 'property' ? [] : parseParams(secs.get('Параметры')),
    returnType: parseType(secs.get('Возвращаемое значение')),
    availability: parseAvailability(secs.get('Доступность')),
  });
}

entries.sort((a, b) =>
  a.owner === b.owner ? a.nameRu.localeCompare(b.nameRu) : a.owner.localeCompare(b.owner),
);

const byOwner = new Map<string, number>();
for (const e of entries) byOwner.set(e.owner, (byOwner.get(e.owner) ?? 0) + 1);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      note: 'Только структурные факты из синтакс-помощника 1С. Описания/примеры не извлекаются (тексты — собственность «1С»).',
      total: entries.length,
      entries,
    },
    null,
    2,
  ),
);

console.log(`✓ Извлечено ${entries.length} записей (пропущено без заголовка: ${skipped}).`);
console.log(`  Глобальных функций: ${byOwner.get(GLOBAL) ?? 0}`);
for (const owner of COLLECTION_OWNERS) {
  if (byOwner.get(owner)) console.log(`  ${owner}: ${byOwner.get(owner)}`);
}
console.log('  → public/reference/syntax-help.json');
