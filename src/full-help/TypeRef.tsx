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
  return <span className="typeLink typeLink--plain">{clean}</span>;
}
