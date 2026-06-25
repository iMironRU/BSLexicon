/**
 * Общая HTML-логика индексации статей синтакс-помощника 1С.
 *
 * Используется и `extract-syntax-help.ts` (вход — XML-выгрузка
 * справочника `ЭлементыДокументации`), и `extract-hbk.ts` (вход — ZIP
 * из родного `.hbk`-файла). Сам формат внутренних HTML-статей одинаков
 * в обоих источниках, поэтому парсеры общие.
 *
 * ВАЖНО (лицензия): тексты СП — собственность «1С». Берём только факты —
 * имена ru/en, сигнатуры, параметры (тип/обязательность), возвращаемый
 * тип, доступность, категорию. Описания и примеры 1С НЕ извлекаем.
 */

export const GLOBAL = 'Глобальный контекст';

/** Типы-владельцы (коллекции), чьи члены оставляем целиком. */
export const COLLECTION_OWNERS = new Set([
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
export const CATEGORY_LABELS: Record<string, string> = {
  'Функции работы со значениями типа Строка': 'Строки',
  'Функции работы со значениями типа Дата': 'Даты',
  'Функции работы со значениями типа Число': 'Числа',
  'Функции работы со значениями типа Тип': 'Тип',
  'Функции преобразования значений': 'Преобразование',
  'Функции форматирования': 'Форматирование',
};

/** «Прочие процедуры и функции» — сборная; берём только эти. */
export const MISC_CATEGORY = 'Прочие процедуры и функции';
export const MISC_ALLOW = new Set(
  ['Макс', 'Мин', 'ОписаниеОшибки', 'ИнформацияОбОшибке', 'ЗначениеЗаполнено', 'Вычислить'].map(
    (s) => s.toLowerCase(),
  ),
);

export interface Param {
  name: string;
  type: string | null;
  optional: boolean;
}

export interface Entry {
  owner: string;
  ownerEn: string;
  kind: 'function' | 'method' | 'property' | 'event';
  category: string;
  nameRu: string;
  nameEn: string;
  signature: string | null;
  params: Param[];
  returnType: string | null;
  /** Контексты исполнения как в HTML (для отображения). */
  availability: string[];
  /** Контексты в нормализованных ключах для сравнения и фильтра. */
  availabilityKeys: string[];
  /** Версия платформы, с которой запись доступна (`"8.3.18"`); `null` — если не указана. */
  since: string | null;
  /** Публичная ссылка на онлайн-синтакс-помощник 1С (источник описаний и примеров). */
  referenceUrl: string | null;
  /** Наше описание (BSLexicon, не из 1С). Заполняется на этапе extract. */
  bslNote?: string | null;
  /** Наш пример (BSLexicon, doctest-проверенный). */
  bslExample?: { code: string; expect?: string } | null;
}

/** Снимает HTML-теги и декодирует HTML-сущности до читаемого текста. */
export function htmlToText(html: string): string {
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

/** Делит тело статьи на секции по заголовкам V8SH_chapter. */
export function sections(bodyHtml: string): Map<string, string> {
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
export function parseType(html: string | undefined): string | null {
  if (!html) return null;
  const text = htmlToText(html);
  const m = text.match(/Тип:\s*([^.,\n]+)/);
  return m ? m[1].trim() : null;
}

export function parseParams(html: string | undefined): Param[] {
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

export function parseAvailability(html: string | undefined): string[] {
  if (!html) return [];
  return htmlToText(html)
    .split(',')
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter(Boolean);
}

/**
 * Маппинг текстового имени контекста исполнения 1С на стабильный ключ.
 * Сравнение регистронезависимое, скобки/пробелы нормализуются. Возвращает
 * `null`, если строка не сматчилась ни одному известному варианту —
 * вызывающий код решит, логировать ли это (отлов новых формулировок).
 */
const CONTEXT_MAP: Record<string, string> = {
  'тонкий клиент': 'thin',
  'веб-клиент': 'web',
  'веб клиент': 'web',
  'мобильный клиент': 'mobile-thin',
  'сервер': 'server',
  'толстый клиент': 'thick',
  'внешнее соединение': 'external',
  'мобильное приложение (клиент)': 'mobile-client',
  'мобильное приложение (сервер)': 'mobile-server',
  'мобильный автономный сервер': 'mobile-standalone',
};

export function normalizeContext(raw: string): string | null {
  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return CONTEXT_MAP[key] ?? null;
}

/**
 * Извлекает версию «начиная с …» из секции «Использование в версии:»
 * (`<p class="V8SH_versionInfo">Доступен, начиная с версии 8.3.18.</p>`).
 * Возвращает строку версии (`"8.0"`, `"8.3.18"`) или `null`.
 */
export function parseSince(html: string): string | null {
  // Сначала ищем разметку V8SH_versionInfo — самый надёжный источник.
  const struct = html.match(/<p class="V8SH_versionInfo">[^<]*?версии\s+([\d.]+)/);
  if (struct) return struct[1].replace(/\.$/, '');
  // Резерв — параграф `not_used` в шапке статьи (всегда присутствует).
  const fallback = html.match(/<p class="not_used">[^<]*?версии\s+([\d.]+)/);
  return fallback ? fallback[1].replace(/\.$/, '') : null;
}

/**
 * Публичная deep-ссылка на онлайн-синтакс-помощник 1С (нижний колонтитул
 * каждой статьи). Это ресурс самой 1С, на лицензию текста СП не подпадает —
 * мы можем ссылаться. Возвращает URL или `null`.
 */
export function parseReferenceUrl(html: string): string | null {
  // Атрибут href без кавычек, URL содержит `"` внутри: захватываем до пробела/>.
  const m = html.match(/href=(https?:\/\/[^\s>]*1centerprise\.com\/devlinks[^\s>]*)/i);
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, '').trim() || null;
}

/**
 * Парсит заголовок статьи (V8SH_pagetitle) формата «Владелец.Имя (OwnerEN.NameEN)».
 * Возвращает 4 поля или `null`, если шаблон не сматчился (например, статья — раздел).
 */
export interface PageTitle {
  owner: string;
  nameRu: string;
  ownerEn: string;
  nameEn: string;
}
export function parsePageTitle(rawTitleHtml: string): PageTitle | null {
  const t = htmlToText(rawTitleHtml);
  const m = t.match(/^(.+?)\.([^.(]+?)\s*\(([^.]+?)\.([^)]+?)\)\s*$/);
  if (!m) return null;
  return { owner: m[1].trim(), nameRu: m[2].trim(), ownerEn: m[3].trim(), nameEn: m[4].trim() };
}

/** Категория-ярлык учебной глобальной функции, либо `null` (отбрасываем). */
export function globalCategory(rawCategory: string | undefined, nameRu: string): string | null {
  if (!rawCategory) return null;
  const label = CATEGORY_LABELS[rawCategory];
  if (label) return label;
  if (rawCategory === MISC_CATEGORY && MISC_ALLOW.has(nameRu.toLowerCase())) return 'Прочее';
  return null;
}

/** Извлекает все стандартные секции статьи. */
export function extractSections(
  html: string,
  kind: Entry['kind'],
): Pick<Entry, 'signature' | 'params' | 'returnType' | 'availability' | 'availabilityKeys' | 'since' | 'referenceUrl'> {
  const secs = sections(html);
  const signature = secs.has('Синтаксис')
    ? htmlToText(secs.get('Синтаксис') as string).replace(/\s+/g, ' ').trim() || null
    : null;
  const availability = parseAvailability(secs.get('Доступность'));
  const availabilityKeys: string[] = [];
  for (const raw of availability) {
    const key = normalizeContext(raw);
    if (key && !availabilityKeys.includes(key)) availabilityKeys.push(key);
  }
  return {
    signature,
    params: kind === 'property' ? [] : parseParams(secs.get('Параметры')),
    returnType: parseType(secs.get('Возвращаемое значение')),
    availability,
    availabilityKeys,
    since: parseSince(html),
    referenceUrl: parseReferenceUrl(html),
  };
}
