/**
 * Текст типа с deep-link на его карточку.
 *
 * Резолвер ссылки идёт по приоритетам:
 *   1. Прямой match в `knownOwners` (тип лежит как owner в выгрузке).
 *   2. Шаблонный fallback (`ДокументОбъект` → `ДокументОбъект.<Имя документа>`).
 *   3. Курированный примитив/коллекция (`Строка`, `Массив`, …) — линк в `/help/`.
 *   4. Иначе — обычный текст.
 *
 * Дополнительно поддержан union вида `Форма; Элемент управления` и
 * `… или …` — каждая часть линкуется независимо.
 */

interface TypeRefProps {
  type: string | null | undefined;
  knownOwners: ReadonlySet<string>;
  /** Формирователь href для owner-а полной выгрузки (на /help/full/). */
  hrefFor?: (owner: string) => string;
}

const defaultFullHref = (owner: string): string =>
  `#/owner/${encodeURIComponent(owner)}`;

/**
 * Курированные типы (примитивы + коллекции) с собственной карточкой
 * в /help/. На лету (без загрузки YAML) — список зафиксирован вручную,
 * он практически не меняется. Если расширим catalog/types/*.yaml — сюда
 * добавить.
 */
const CURATED_TYPES = new Set([
  'Число', 'Строка', 'Булево', 'Дата', 'Неопределено', 'Null', 'Тип',
  'Массив', 'Структура', 'Соответствие', 'КлючИЗначение',
  'СписокЗначений', 'ЭлементСпискаЗначений',
  'ТаблицаЗначений', 'СтрокаТаблицыЗначений',
  'КолонкаТаблицыЗначений', 'КоллекцияКолонокТаблицыЗначений',
]);

function curatedTypeHref(type: string): string {
  // /help/ всегда абсолютным путём — он другой Vite-entry.
  return `${import.meta.env.BASE_URL}help/#/type/${encodeURIComponent(type)}`;
}

function resolveTemplated(type: string, knownOwners: ReadonlySet<string>): string | null {
  const prefix = type + '.<';
  for (const o of knownOwners) {
    if (o.startsWith(prefix) && o.endsWith('>')) return o;
  }
  return null;
}

/** Разрезает union вида `A; B`, `A, B`, `A или B` на части с разделителями. */
function splitUnion(raw: string): { text: string; isSeparator: boolean }[] {
  const re = /(\s*(?:;|,| или )\s*)/i;
  const parts = raw.split(re);
  return parts.map((p) => ({ text: p, isSeparator: re.test(p) }));
}

export function TypeRef({ type, knownOwners, hrefFor = defaultFullHref }: TypeRefProps) {
  if (!type) return <>—</>;
  const clean = type.trim();
  if (!clean) return <>—</>;

  const parts = splitUnion(clean);
  // Если split дал больше одной не-разделительной части — это union.
  const isUnion = parts.filter((p) => !p.isSeparator).length > 1;
  if (!isUnion) {
    return <SingleTypeRef raw={clean} knownOwners={knownOwners} hrefFor={hrefFor} />;
  }
  return (
    <>
      {parts.map((p, i) =>
        p.isSeparator ? (
          <span key={i}>{p.text}</span>
        ) : (
          <SingleTypeRef
            key={i}
            raw={p.text.trim()}
            knownOwners={knownOwners}
            hrefFor={hrefFor}
          />
        ),
      )}
    </>
  );
}

function SingleTypeRef({
  raw,
  knownOwners,
  hrefFor,
}: {
  raw: string;
  knownOwners: ReadonlySet<string>;
  hrefFor: (owner: string) => string;
}) {
  if (!raw) return null;
  if (knownOwners.has(raw)) {
    return <a className="typeLink" href={hrefFor(raw)}>{raw}</a>;
  }
  const templated = resolveTemplated(raw, knownOwners);
  if (templated) {
    return (
      <a className="typeLink" href={hrefFor(templated)} title={`Открыть карточку «${templated}»`}>
        {raw}
      </a>
    );
  }
  if (CURATED_TYPES.has(raw)) {
    return (
      <a className="typeLink" href={curatedTypeHref(raw)} title="Открыть в учебном справочнике">
        {raw}
      </a>
    );
  }
  return <span className="typeLink typeLink--plain">{raw}</span>;
}
