/**
 * Текст типа с deep-link на его карточку, если такой тип есть в выгрузке.
 *
 * Тип параметра/возврата вроде «Поток», «КоллекцияВложенийPDF» — это
 * реальный owner полного СП. Если он есть в `knownOwners`, делаем
 * `<a href="#/owner/<имя>">` — пользователь кликает и видит карточку
 * типа. Если нет (примитивы, шаблонные `<Имя поля>`) — обычный текст.
 */

interface TypeRefProps {
  /** Имя типа из data (`p.type` / `entry.returnType`); может быть `null`/`undefined`. */
  type: string | null | undefined;
  /** Множество owner-имён, у которых есть своя страница `#/owner/<имя>`. */
  knownOwners: ReadonlySet<string>;
  /**
   * Формирователь href по имени owner-а. По умолчанию — hash-ссылка
   * внутри `/help/full/` (`#/owner/<имя>`). Из `/help/events/` нужен
   * абсолютный путь в full-help (другая страница).
   */
  hrefFor?: (owner: string) => string;
}

const defaultHref = (owner: string): string => `#/owner/${encodeURIComponent(owner)}`;

/**
 * Резолв «короткого» имени типа в шаблонный owner. В параметрах СП 1С
 * часто пишет «ДокументОбъект», а полный owner — «ДокументОбъект.<Имя
 * документа>». Возвращает имя шаблонного owner-а (для линка) либо null.
 */
function resolveTemplated(type: string, knownOwners: ReadonlySet<string>): string | null {
  const prefix = type + '.<';
  for (const o of knownOwners) {
    if (o.startsWith(prefix) && o.endsWith('>')) return o;
  }
  return null;
}

export function TypeRef({ type, knownOwners, hrefFor = defaultHref }: TypeRefProps) {
  if (!type) return <>—</>;
  const clean = type.trim();
  if (!clean) return <>—</>;
  if (knownOwners.has(clean)) {
    return (
      <a className="typeLink" href={hrefFor(clean)}>
        {clean}
      </a>
    );
  }
  // Шаблонный fallback: ДокументОбъект → ДокументОбъект.<Имя документа>
  const templated = resolveTemplated(clean, knownOwners);
  if (templated) {
    return (
      <a
        className="typeLink"
        href={hrefFor(templated)}
        title={`Открыть карточку «${templated}»`}
      >
        {clean}
      </a>
    );
  }
  return <span className="typeLink typeLink--plain">{clean}</span>;
}
