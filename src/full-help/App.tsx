import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SyntaxEntry } from '../app/reference/types';
import { ALL_CONTEXTS, CONTEXT_LABELS } from '../help/target';
import { SearchOverlay } from './SearchOverlay';
import { entryId, loadFullReference } from './loader';
import { search } from './search';
import type { FullHit } from './search';

const TRAINER_URL = import.meta.env.BASE_URL;
const HELP_URL = `${import.meta.env.BASE_URL}help/`;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const HOTKEY_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K';

type Route = { kind: 'home' } | { kind: 'entry'; id: string };

function parseHash(hash: string): Route {
  const trimmed = hash.replace(/^#\/?/, '');
  if (trimmed === '') return { kind: 'home' };
  try {
    return { kind: 'entry', id: decodeURIComponent(trimmed) };
  } catch {
    return { kind: 'home' };
  }
}

function formatHash(route: Route): string {
  if (route.kind === 'home') return '#/';
  return `#/${encodeURIComponent(route.id)}`;
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const [entries, setEntries] = useState<SyntaxEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const route = useHashRoute();

  useEffect(() => {
    let alive = true;
    loadFullReference()
      .then((data) => alive && setEntries(data))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  // Глобальный ⌘K / Ctrl+K и `/` (вне инпутов) — переключение overlay'я.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      } else if (e.key === '/' && !searchOpen) {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault();
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen]);

  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const hrefFor = useCallback(
    (e: SyntaxEntry) => formatHash({ kind: 'entry', id: entryId(e) }),
    [],
  );

  // Индекс id → запись, чтобы deep-link отрабатывал O(1).
  const byId = useMemo(() => {
    const m = new Map<string, SyntaxEntry>();
    if (entries) for (const e of entries) m.set(entryId(e), e);
    return m;
  }, [entries]);

  const entry = route.kind === 'entry' ? byId.get(route.id) ?? null : null;

  useEffect(() => {
    document.title = entry
      ? `${entryId(entry)} — Полный синтакс-помощник BSL`
      : 'Полный синтакс-помощник BSL';
  }, [entry]);

  return (
    <div className="help">
      <header className="help__header">
        <a className="help__brand" href={TRAINER_URL} title="К тренажёру">
          <span className="help__logo">BSLexicon</span>
          <span className="help__tagline">Полный синтакс-помощник</span>
        </a>
        <div className="help__head-actions">
          {entries && (
            <button
              type="button"
              className="help__search-btn"
              onClick={() => setSearchOpen(true)}
              title={`Поиск (${HOTKEY_LABEL})`}
            >
              <span aria-hidden="true">🔎</span>
              <span className="help__search-label">Поиск</span>
              <kbd className="help__kbd">{HOTKEY_LABEL}</kbd>
            </button>
          )}
          <a className="help__back" href={HELP_URL} title="Учебный режим (~180 записей с тренажёром)">
            Учебный режим
          </a>
          <a className="help__back" href={`${TRAINER_URL}help/events/`} title="Каталог событий 1С">
            События
          </a>
          <a className="help__back" href={TRAINER_URL}>← Тренажёр</a>
        </div>
      </header>

      <main className="help__body fhelp__body">
        <section className="help__content fhelp__content">
          {error && <div className="help__missing"><h1>Ошибка</h1><p>{error}</p></div>}
          {!entries && !error && <Loading />}
          {entries && route.kind === 'home' && <Home entries={entries} />}
          {entries && route.kind === 'entry' && entry && <FullCard entry={entry} />}
          {entries && route.kind === 'entry' && !entry && (
            <div className="help__missing">
              <h1>Не нашёл запись</h1>
              <p>В выгрузке нет элемента <code>{route.id}</code>.</p>
              <p><a href={formatHash({ kind: 'home' })}>На главную</a></p>
            </div>
          )}
        </section>
      </main>

      {searchOpen && entries && (
        <SearchOverlay
          entries={entries}
          hrefFor={hrefFor}
          placeholder={`Поиск по ${entries.length.toLocaleString('ru')} записям…`}
          onClose={closeSearch}
        />
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="fhelp__loading">
      <h1>Загружаю полный синтакс-помощник…</h1>
      <p>
        Около 20 тыс. записей всей платформы 1С: типы, методы, свойства, функции.
        Один раз ~600 КБ — потом браузер кэширует.
      </p>
    </div>
  );
}

function Home({ entries }: { entries: SyntaxEntry[] }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const hits = useMemo(() => (query.trim() === '' ? [] : search(entries, query, 100)), [entries, query]);

  useEffect(() => setSelected(0), [query]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[selected];
      if (hit) window.location.hash = formatHash({ kind: 'entry', id: entryId(hit.entry) });
    }
  };

  // Уникальные владельцы для подсказки (топ-20 по числу членов).
  const tops = useMemo(() => {
    const cnt = new Map<string, number>();
    for (const e of entries) cnt.set(e.owner, (cnt.get(e.owner) ?? 0) + 1);
    return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [entries]);

  return (
    <div className="fhelp__home" onKeyDown={onKey}>
      <h1 className="fhelp__title">Полный синтакс-помощник BSL</h1>
      <p className="fhelp__lead">
        Все <b>{entries.length.toLocaleString('ru')}</b> записей синтакс-помощника 1С:
        типы платформы, методы, свойства, функции. Структурные факты —
        полные описания и примеры по ссылке на сайте 1С.
      </p>

      <input
        className="fhelp__search"
        type="search"
        placeholder="Начните печатать… имя ru/en или Тип.Член"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {query.trim() === '' ? (
        <div className="fhelp__chips">
          {tops.map(([owner, n]) => (
            <button
              key={owner}
              type="button"
              className="chip"
              onClick={() => setQuery(owner + '.')}
              title={`${n} членов`}
            >
              {owner} <span className="chip__n">{n}</span>
            </button>
          ))}
        </div>
      ) : (
        <ResultsList hits={hits} selected={selected} onHover={setSelected} query={query} />
      )}
    </div>
  );
}

function ResultsList({
  hits,
  selected,
  onHover,
  query,
}: {
  hits: FullHit[];
  selected: number;
  onHover: (i: number) => void;
  query: string;
}) {
  if (hits.length === 0) return <p className="fhelp__none">Ничего не нашлось.</p>;
  return (
    <ul className="fhelp__results">
      {hits.map((h, i) => {
        const id = entryId(h.entry);
        return (
          <li
            key={id}
            className={'fhelp__result' + (i === selected ? ' fhelp__result--active' : '')}
            onMouseEnter={() => onHover(i)}
          >
            <a href={formatHash({ kind: 'entry', id })}>
              <span className="fhelp__r-kind">{h.entry.kind}</span>
              <span className="fhelp__r-name">
                <Highlight text={id} index={h.matchIndex} q={query} />
              </span>
              <span className="fhelp__r-en">{h.entry.nameEn}</span>
              <span className="fhelp__r-owner">
                {h.entry.kind === 'function' ? 'Глобальный контекст' : h.entry.owner}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Highlight({ text, index, q }: { text: string; index: number; q: string }) {
  if (index < 0) return <>{text}</>;
  const ql = q.trim().length;
  return (
    <>
      {text.slice(0, index)}
      <mark className="fhelp__mark">{text.slice(index, index + ql)}</mark>
      {text.slice(index + ql)}
    </>
  );
}

function FullCard({ entry }: { entry: SyntaxEntry }) {
  const id = entryId(entry);
  const available = new Set(entry.availabilityKeys);
  return (
    <article className="card">
      <nav className="crumbs">
        <a href="#/">Главная</a>
        <span className="crumbs__sep"> / </span>
        {entry.kind !== 'function' && (
          <>
            <span>{entry.owner}</span>
            <span className="crumbs__sep"> / </span>
          </>
        )}
        <span className="crumbs__active">{entry.nameRu}</span>
      </nav>

      <header className="card__head">
        <h1 className="card__title">
          {entry.kind === 'function' ? entry.nameRu : `${entry.owner}.${entry.nameRu}`}
          <span className="card__en">({entry.kind === 'function' ? entry.nameEn : `${entry.ownerEn}.${entry.nameEn}`})</span>
        </h1>
        <span className="card__kind">{entry.kind}</span>
        <span className="card__category">· {entry.owner}</span>
      </header>

      {entry.signature && <pre className="card__sig">{entry.signature}</pre>}

      {entry.params.length > 0 && (
        <table className="params">
          <thead>
            <tr><th>Имя</th><th>Тип</th><th>Обязательность</th></tr>
          </thead>
          <tbody>
            {entry.params.map((p) => (
              <tr key={p.name}>
                <td className="params__name">{p.name}</td>
                <td className="params__type">{p.type ?? '—'}</td>
                <td className="params__opt">{p.optional ? 'необязательный' : 'обязательный'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entry.returnType && (
        <div className="card__returns">
          <span className="card__label">Возвращает:</span> <span className="typeLink">{entry.returnType}</span>
        </div>
      )}

      <section className="card__avail">
        <h2 className="card__avail-title">Доступность</h2>
        {entry.since && (
          <div className="card__avail-since">Доступен с версии <b>{entry.since}</b></div>
        )}
        <ul className="card__avail-matrix">
          {ALL_CONTEXTS.map((ctx) => {
            const has = available.has(ctx);
            return (
              <li key={ctx} className={'card__ctx' + (has ? ' card__ctx--has' : ' card__ctx--no')}>
                <span aria-hidden="true" className="card__ctx-icon">{has ? '✓' : '✗'}</span>
                <span className="card__ctx-label">{CONTEXT_LABELS[ctx]}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {entry.referenceUrl && (
        <section className="card__source">
          <a
            href={entry.referenceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="card__source-link"
            title="Открыть статью в онлайн-синтакс-помощнике 1С"
          >
            📖 Описание и примеры на сайте 1С →
          </a>
          <p className="card__source-note">
            Тексты и примеры синтакс-помощника — собственность «1С». Здесь
            только структурные факты, полные описания — по ссылке.
          </p>
        </section>
      )}

      <p className="fhelp__id">id для шаринга: <code>{id}</code></p>
    </article>
  );
}
