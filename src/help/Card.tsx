import type { Catalog, CatalogEntry, CatalogExample, CatalogParam } from '@core/index';
import { builtinIds, methodIds, methodTypeOf, propertyIds } from '@core/index';
import type { SyntaxEntry } from '../app/reference/types';
import { encodeCodeParam } from '../app/url-params';
import { formatHash } from './router';
import { ALL_CONTEXTS, CONTEXT_LABELS, verdict } from './target';
import type { Target } from './target';

/** Кэш id-сетов рантайма — для определения «исполняется / только справка». */
const RUNTIME_IDS = new Set<string>([...builtinIds, ...methodIds, ...propertyIds]);

function isRuntimeEntry(entry: CatalogEntry): boolean {
  if (entry.kind === 'type') return true; // тип — всегда «есть в рантайме», если он в каталоге
  return RUNTIME_IDS.has(entry.id);
}

const KIND_LABEL: Record<CatalogEntry['kind'], string> = {
  function: 'функция',
  type: 'тип',
  method: 'метод',
  property: 'свойство',
};

interface CardProps {
  catalog: Catalog;
  entry: CatalogEntry;
  syntax: SyntaxEntry | null;
  target: Target;
}

export function Card({ catalog, entry, syntax, target }: CardProps) {
  const availabilityVerdict = syntax ? verdict(syntax, target) : null;

  return (
    <article className="card">
      <Breadcrumbs catalog={catalog} entry={entry} />
      <header className="card__head">
        <h1 className="card__title">
          {entry.names.ru}
          <span className="card__en">({entry.names.en})</span>
        </h1>
        <span className="card__kind">{KIND_LABEL[entry.kind]}</span>
        <span className="card__category">· {entry.category}</span>
        {!isRuntimeEntry(entry) && (
          <span
            className="card__stub-badge"
            title="Запись только в справочнике — рантайм тренажёра её не исполняет"
          >
            только справка
          </span>
        )}
        {availabilityVerdict && availabilityVerdict.verdict !== 'unknown' && (
          <AvailabilityBadge verdict={availabilityVerdict} />
        )}
      </header>

      {entry.signature && <pre className="card__sig">{entry.signature}</pre>}

      {entry.description && <p className="card__desc">{entry.description}</p>}

      {entry.params && entry.params.length > 0 && <Params catalog={catalog} params={entry.params} />}

      {entry.returns && (
        <div className="card__returns">
          <span className="card__label">Возвращает:</span>{' '}
          <TypeLink catalog={catalog} typeName={entry.returns.type} />
          {entry.returns.description && <span> — {entry.returns.description}</span>}
        </div>
      )}

      {entry.kind === 'type' && <TypeMembers catalog={catalog} entry={entry} />}

      {syntax && <AvailabilitySection syntax={syntax} target={target} />}

      {entry.examples && entry.examples.length > 0 && <Examples examples={entry.examples} />}

      {syntax?.referenceUrl && (
        <section className="card__source">
          <a
            href={syntax.referenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="card__source-link"
            title="Открыть статью в онлайн-синтакс-помощнике 1С"
          >
            📖 Описание и примеры на сайте 1С →
          </a>
          <p className="card__source-note">
            Тексты и примеры синтакс-помощника — собственность «1С».
            Мы храним только структурные факты (имена, сигнатуры, типы),
            а полные описания — по ссылке.
          </p>
        </section>
      )}
    </article>
  );
}

function AvailabilityBadge({ verdict: v }: { verdict: ReturnType<typeof verdict> }) {
  if (v.verdict === 'yes') {
    return <span className="card__avail-badge card__avail-badge--yes">✓ доступно у вас</span>;
  }
  if (v.reason.needsVersion) {
    return (
      <span className="card__avail-badge card__avail-badge--no">
        ✗ требует {v.reason.needsVersion}
      </span>
    );
  }
  if (v.reason.missingContexts && v.reason.missingContexts.length > 0) {
    const labels = v.reason.missingContexts.map((c) => CONTEXT_LABELS[c]).join(', ');
    return (
      <span className="card__avail-badge card__avail-badge--no" title={`Не работает: ${labels}`}>
        ✗ не подходит контекст
      </span>
    );
  }
  return null;
}

function AvailabilitySection({ syntax, target }: { syntax: SyntaxEntry; target: Target }) {
  const available = new Set(syntax.availabilityKeys);
  return (
    <section className="card__avail">
      <h2 className="card__avail-title">Доступность</h2>
      {syntax.since && (
        <div className="card__avail-since">
          Доступен с версии <b>{syntax.since}</b>
        </div>
      )}
      <ul className="card__avail-matrix">
        {ALL_CONTEXTS.map((ctx) => {
          const has = available.has(ctx);
          const targeted = target.contexts.has(ctx);
          return (
            <li
              key={ctx}
              className={
                'card__ctx' +
                (has ? ' card__ctx--has' : ' card__ctx--no') +
                (targeted ? ' card__ctx--targeted' : '')
              }
              title={targeted ? 'Включено в вашей цели' : undefined}
            >
              <span aria-hidden="true" className="card__ctx-icon">{has ? '✓' : '✗'}</span>
              <span className="card__ctx-label">{CONTEXT_LABELS[ctx]}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Breadcrumbs({ catalog, entry }: { catalog: Catalog; entry: CatalogEntry }) {
  const crumbs: { label: string; href?: string }[] = [{ label: 'Главная', href: '#/' }];
  if (entry.kind === 'method' || entry.kind === 'property') {
    const typeName = methodTypeOf(entry.id);
    const typeEntry = typeName ? catalog.byId.get(typeName) : null;
    if (typeEntry) {
      crumbs.push({
        label: typeEntry.names.ru,
        href: formatHash({ kind: 'entry', entryKind: 'type', id: typeEntry.id }),
      });
    }
  }
  crumbs.push({ label: entry.names.ru });
  return (
    <nav className="crumbs" aria-label="Хлебные крошки">
      {crumbs.map((c, i) => (
        <span key={i} className="crumbs__item">
          {c.href ? <a href={c.href}>{c.label}</a> : <span className="crumbs__active">{c.label}</span>}
          {i < crumbs.length - 1 && <span className="crumbs__sep"> / </span>}
        </span>
      ))}
    </nav>
  );
}

function Params({ catalog, params }: { catalog: Catalog; params: CatalogParam[] }) {
  return (
    <table className="params">
      <thead>
        <tr>
          <th>Имя</th>
          <th>Тип</th>
          <th>Обязательность</th>
          <th>Описание</th>
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.name}>
            <td className="params__name">{p.name}</td>
            <td className="params__type">
              <TypeLink catalog={catalog} typeName={p.type} />
            </td>
            <td className="params__opt">{p.optional ? 'необязательный' : 'обязательный'}</td>
            <td className="params__desc">{p.description ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TypeLink({ catalog, typeName }: { catalog: Catalog; typeName: string }) {
  const target = catalog.byId.get(typeName);
  if (target && target.kind === 'type') {
    return (
      <a className="typeLink" href={formatHash({ kind: 'entry', entryKind: 'type', id: target.id })}>
        {typeName}
      </a>
    );
  }
  return <span className="typeLink typeLink--plain">{typeName}</span>;
}

/** Для карточки типа — таблицы методов и свойств с deep-link. */
function TypeMembers({ catalog, entry }: { catalog: Catalog; entry: CatalogEntry }) {
  const members = catalog.methodsByType.get(entry.id) ?? [];
  const methods = members.filter((m) => m.kind === 'method').sort((a, b) => a.names.ru.localeCompare(b.names.ru, 'ru'));
  const properties = members
    .filter((m) => m.kind === 'property')
    .sort((a, b) => a.names.ru.localeCompare(b.names.ru, 'ru'));
  return (
    <>
      {methods.length > 0 && (
        <section className="members">
          <h2 className="members__title">Методы</h2>
          <ul className="members__list">
            {methods.map((m) => (
              <li key={m.id}>
                <a href={formatHash({ kind: 'entry', entryKind: 'method', id: m.id })}>
                  {m.names.ru}
                </a>
                {m.description && <span className="members__desc"> — {firstSentence(m.description)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {properties.length > 0 && (
        <section className="members">
          <h2 className="members__title">Свойства</h2>
          <ul className="members__list">
            {properties.map((p) => (
              <li key={p.id}>
                <a href={formatHash({ kind: 'entry', entryKind: 'property', id: p.id })}>
                  {p.names.ru}
                </a>
                {p.description && <span className="members__desc"> — {firstSentence(p.description)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Examples({ examples }: { examples: CatalogExample[] }) {
  return (
    <section className="examples">
      <h2 className="examples__title">Примеры</h2>
      {examples.map((ex, i) => (
        <div key={i} className="example">
          {ex.title && <div className="example__title">{ex.title}</div>}
          <pre className="example__code">{ex.code}</pre>
          {ex.expect !== undefined && (
            <div className="example__expect">
              <span className="example__label">Ожидаемый вывод:</span>
              <pre>{ex.expect}</pre>
            </div>
          )}
          <a
            className="example__open"
            href={`${import.meta.env.BASE_URL}?code=${encodeCodeParam(ex.code)}`}
            target="_self"
            title="Открыть код в тренажёре"
          >
            ▶ В тренажёре
          </a>
        </div>
      ))}
    </section>
  );
}

function firstSentence(text: string): string {
  const m = text.match(/^[^.!?\n]+[.!?]?/);
  return m ? m[0].trim() : text;
}
