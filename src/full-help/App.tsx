import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SyntaxEntry } from '../app/reference/types';
import { ALL_CONTEXTS, CONTEXT_LABELS } from '../help/target';
import { SearchOverlay } from './SearchOverlay';
import { Sidebar } from './Sidebar';
import { TypeRef } from './TypeRef';
import { HelpFooter } from '../help/HelpFooter';
import { NavMenu } from '../help/NavMenu';
import { entryId, loadFullReference } from './loader';
import { search } from './search';
import type { FullHit } from './search';
import { buildTree } from './tree';

const TRAINER_URL = import.meta.env.BASE_URL;
const HELP_URL = `${import.meta.env.BASE_URL}help/`;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const HOTKEY_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K';

type Route =
  | { kind: 'home' }
  | { kind: 'owner'; owner: string }
  | { kind: 'entry'; id: string };

function parseHash(hash: string): Route {
  const t = hash.replace(/^#\/?/, '');
  if (t === '') return { kind: 'home' };
  if (t.startsWith('owner/')) {
    try {
      return { kind: 'owner', owner: decodeURIComponent(t.slice('owner/'.length)) };
    } catch {
      return { kind: 'home' };
    }
  }
  try {
    return { kind: 'entry', id: decodeURIComponent(t) };
  } catch {
    return { kind: 'home' };
  }
}

function formatHash(route: Route): string {
  if (route.kind === 'home') return '#/';
  if (route.kind === 'owner') return `#/owner/${encodeURIComponent(route.owner)}`;
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
  const [data, setData] = useState<Awaited<ReturnType<typeof loadFullReference>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const route = useHashRoute();

  useEffect(() => {
    let alive = true;
    loadFullReference()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const entries: SyntaxEntry[] = data?.entries ?? [];

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
  const ownerHref = useCallback(
    (owner: string) => formatHash({ kind: 'owner', owner }),
    [],
  );

  // Индекс id → запись, чтобы deep-link отрабатывал O(1).
  const byId = useMemo(() => {
    const m = new Map<string, SyntaxEntry>();
    for (const e of entries) m.set(entryId(e), e);
    return m;
  }, [entries]);

  // owner → его записи, для страницы типа.
  const byOwner = useMemo(() => {
    const m = new Map<string, SyntaxEntry[]>();
    for (const e of entries) {
      const list = m.get(e.owner) ?? [];
      list.push(e);
      m.set(e.owner, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
    return m;
  }, [entries]);

  // Множество имён типов, у которых есть своя страница `#/owner/<имя>`.
  // Используется для превращения текста типа в кликабельную ссылку.
  const knownOwners = useMemo(
    () => new Set([...byOwner.keys(), ...Object.keys(data?.ownerPaths ?? {})]),
    [byOwner, data],
  );

  // Дерево разделов — строится один раз после загрузки.
  const tree = useMemo(() => {
    if (!data) return [];
    return buildTree({
      ownerPaths: data.ownerPaths,
      categoryNames: data.categoryNames,
      entriesByOwner: new Map([...byOwner.entries()].map(([o, l]) => [o, l.length])),
    });
  }, [data, byOwner]);

  const entry = route.kind === 'entry' ? byId.get(route.id) ?? null : null;
  const activeOwner =
    route.kind === 'owner' ? route.owner :
    entry ? entry.owner :
    null;

  useEffect(() => {
    if (entry) {
      document.title = `${entryId(entry)} — Полный синтакс-помощник BSL`;
    } else if (route.kind === 'owner') {
      document.title = `${route.owner} — Полный синтакс-помощник BSL`;
    } else {
      document.title = 'Полный синтакс-помощник BSL';
    }
  }, [entry, route]);

  return (
    <div className="help">
      <header className="help__header">
        <a className="help__brand" href={TRAINER_URL} title="К тренажёру">
          <span className="help__logo">BSLexicon</span>
          <span className="help__tagline">Полный синтакс-помощник</span>
        </a>
        <div className="help__head-actions">
          {entries.length > 0 && (
            <button
              type="button"
              className="help__search-btn"
              onClick={() => setSearchOpen(true)}
              title={`Поиск (${HOTKEY_LABEL})`}
            >
              <span aria-hidden="true">🔎</span>
              <span className="help__search-label">
                Поиск по {entries.length.toLocaleString('ru')} записям — например, «ТабличныйДокумент.Записать»…
              </span>
              <kbd className="help__kbd">{HOTKEY_LABEL}</kbd>
            </button>
          )}
          <NavMenu
            links={[
              { label: 'Полный СП', href: `${TRAINER_URL}help/full/`, current: true, hint: 'Все ~20 тыс. записей платформы' },
              { label: 'Учебный режим', href: HELP_URL, hint: '~180 записей с тренажёром' },
              { label: 'События 1С', href: `${TRAINER_URL}help/events/`, hint: '670 событий + lifecycle' },
              { label: '← Тренажёр', href: TRAINER_URL, hint: 'Писать и отлаживать BSL' },
            ]}
          />
        </div>
      </header>

      <main className="help__body">
        <section className="help__content fhelp__content">
          {error && <div className="help__missing"><h1>Ошибка</h1><p>{error}</p></div>}
          {!data && !error && <Loading />}
          {data && route.kind === 'home' && <Home entries={entries} />}
          {data && route.kind === 'owner' && (
            <OwnerView owner={route.owner} entries={byOwner.get(route.owner) ?? []} />
          )}
          {data && route.kind === 'entry' && entry && (
            <FullCard entry={entry} knownOwners={knownOwners} />
          )}
          {data && route.kind === 'entry' && !entry && (
            <div className="help__missing">
              <h1>Не нашёл запись</h1>
              <p>В выгрузке нет элемента <code>{route.id}</code>.</p>
              <p><a href={formatHash({ kind: 'home' })}>На главную</a></p>
            </div>
          )}
        </section>
        {data && tree.length > 0 && (
          <Sidebar tree={tree} activeOwner={activeOwner} ownerHref={ownerHref} />
        )}
      </main>

      <HelpFooter hint={`Полный синтакс-помощник · ${entries.length.toLocaleString('ru')} записей · ${HOTKEY_LABEL} — поиск`} />

      {searchOpen && entries.length > 0 && (
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

function FullCard({ entry, knownOwners }: { entry: SyntaxEntry; knownOwners: ReadonlySet<string> }) {
  const id = entryId(entry);
  const available = new Set(entry.availabilityKeys);
  return (
    <article className="card">
      <nav className="crumbs">
        <a href="#/">Главная</a>
        <span className="crumbs__sep"> / </span>
        {entry.kind !== 'function' && (
          <>
            {knownOwners.has(entry.owner) ? (
              <a href={`#/owner/${encodeURIComponent(entry.owner)}`}>{entry.owner}</a>
            ) : (
              <span>{entry.owner}</span>
            )}
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
                <td className="params__type">
                  <TypeRef type={p.type} knownOwners={knownOwners} />
                </td>
                <td className="params__opt">{p.optional ? 'необязательный' : 'обязательный'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entry.returnType && (
        <div className="card__returns">
          <span className="card__label">Возвращает:</span>{' '}
          <TypeRef type={entry.returnType} knownOwners={knownOwners} />
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

const KIND_BLOCK_LABEL: Record<SyntaxEntry['kind'], string> = {
  function: 'Функции',
  method: 'Методы',
  property: 'Свойства',
  event: 'События',
};

const KIND_BLOCK_ORDER: SyntaxEntry['kind'][] = ['method', 'property', 'event', 'function'];

function OwnerView({ owner, entries }: { owner: string; entries: SyntaxEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="help__missing">
        <h1>{owner}</h1>
        <p>В выгрузке нет членов этого типа.</p>
      </div>
    );
  }
  const byKind = new Map<SyntaxEntry['kind'], SyntaxEntry[]>();
  for (const e of entries) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }
  const ownerEn = entries[0].ownerEn;
  return (
    <article className="fhelp__owner">
      <nav className="crumbs">
        <a href="#/">Главная</a>
        <span className="crumbs__sep"> / </span>
        <span className="crumbs__active">{owner}</span>
      </nav>
      <h1 className="fhelp__owner-title">
        {owner} <span className="fhelp__owner-en">({ownerEn})</span>
      </h1>
      <p className="fhelp__owner-meta">{entries.length} членов</p>
      {KIND_BLOCK_ORDER.map((k) => {
        const list = byKind.get(k);
        if (!list || list.length === 0) return null;
        return (
          <section key={k} className="fhelp__owner-block">
            <h2 className="fhelp__owner-block-title">
              {KIND_BLOCK_LABEL[k]} <span className="fhelp__owner-block-n">{list.length}</span>
            </h2>
            <ul className="fhelp__owner-list">
              {list.map((e) => (
                <li key={entryId(e)}>
                  <a className="fhelp__owner-item" href={formatHash({ kind: 'entry', id: entryId(e) })}>
                    <span className="fhelp__owner-item-name">{e.nameRu}</span>
                    <span className="fhelp__owner-item-en">{e.nameEn}</span>
                    {e.signature && (
                      <span className="fhelp__owner-item-sig" title={e.signature}>
                        {shortSig(e.signature)}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </article>
  );
}

function shortSig(sig: string): string {
  const m = sig.match(/\(([^)]*)\)/);
  return m ? `(${m[1]})` : '';
}
