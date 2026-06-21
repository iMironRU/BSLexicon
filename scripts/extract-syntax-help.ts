/**
 * Извлечение СТРУКТУРНЫХ ФАКТОВ из выгрузки синтакс-помощника 1С
 * (справочник «ЭлементыДокументации» в формате _1CV8DtUD).
 *
 * ВАЖНО (лицензия): тексты СП — собственность «1С». Берём только факты —
 * имена ru/en, сигнатуры, параметры (тип/обязательность), возвращаемый тип,
 * доступность, категорию. Описания и примеры 1С НЕ извлекаем (пишем свои).
 *
 * КУРАЦИЯ: тренажёр учит ЯЗЫКУ, не платформе. Поэтому оставляем только учебные
 * категории глобальных функций (строки/числа/даты/тип/преобразование/
 * форматирование + точечный allow-list из «Прочих») и все коллекции; всё
 * платформенное (файлы, ИБ, сеанс, XML/JSON, крипто, транзакции, формы…) — вон.
 *
 * Источник (~110 МБ) в репозиторий не коммитим. По умолчанию берётся
 * reference/source/syntax-help-export.xml; путь можно переопределить через
 * BSL_SP_EXPORT или первым аргументом. Результат — public/reference/syntax-help.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const GLOBAL = 'Глобальный контекст';

/** Типы-владельцы (коллекции), чьи члены оставляем целиком. */
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

/** Учебные категории глобальных функций (папка-родитель в help → короткий ярлык). */
const CATEGORY_LABELS: Record<string, string> = {
  'Функции работы со значениями типа Строка': 'Строки',
  'Функции работы со значениями типа Дата': 'Даты',
  'Функции работы со значениями типа Число': 'Числа',
  'Функции работы со значениями типа Тип': 'Тип',
  'Функции преобразования значений': 'Преобразование',
  'Функции форматирования': 'Форматирование',
};

/** «Прочие процедуры и функции» — сборная; берём только эти. */
const MISC_CATEGORY = 'Прочие процедуры и функции';
const MISC_ALLOW = new Set(
  ['Макс', 'Мин', 'ОписаниеОшибки', 'ИнформацияОбОшибке', 'ЗначениеЗаполнено', 'Вычислить'].map(
    (s) => s.toLowerCase(),
  ),
);

interface Param {
  name: string;
  type: string | null;
  optional: boolean;
}
interface Entry {
  owner: string;
  ownerEn: string;
  kind: 'function' | 'method' | 'property';
  category: string;
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
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

/** Значение тега; терпит атрибуты (например, у Ref/Parent есть xsi:type). */
function field(record: string, tag: string): string | null {
  const m = record.match(new RegExp(`<v8:${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</v8:${tag}>`));
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

/** Категория-ярлык учебной глобальной функции, либо null (отбрасываем). */
function globalCategory(rawCategory: string | undefined, nameRu: string): string | null {
  if (!rawCategory) return null;
  const label = CATEGORY_LABELS[rawCategory];
  if (label) return label;
  if (rawCategory === MISC_CATEGORY && MISC_ALLOW.has(nameRu.toLowerCase())) return 'Прочее';
  return null;
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
  // «Владелец.Имя (OwnerEN.NameEN)»
  const t = htmlToText(title[1]);
  const parsed = t.match(/^(.+?)\.([^.(]+?)\s*\(([^.]+?)\.([^)]+?)\)\s*$/);
  if (!parsed) {
    skipped += 1;
    continue;
  }
  const [, owner, nameRu, ownerEn, nameEn] = parsed.map((s) => s.trim());

  let category: string | null;
  if (owner === GLOBAL) {
    const parentRef = field(record, 'Parent');
    category = globalCategory(parentRef ? refDescription.get(parentRef) : undefined, nameRu);
  } else if (COLLECTION_OWNERS.has(owner)) {
    category = 'Коллекции';
  } else {
    category = null;
  }
  if (!category) continue; // не учебное — отбрасываем

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
    category,
    nameRu,
    nameEn,
    signature,
    params: kind === 'property' ? [] : parseParams(secs.get('Параметры')),
    returnType: parseType(secs.get('Возвращаемое значение')),
    availability: parseAvailability(secs.get('Доступность')),
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
