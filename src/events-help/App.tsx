import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SyntaxEntry } from '../app/reference/types';
import { ALL_CONTEXTS, CONTEXT_LABELS } from '../help/target';
import { entryId, loadFullReference } from '../full-help/loader';
import { SearchOverlay } from '../full-help/SearchOverlay';
import { TypeRef } from '../full-help/TypeRef';
import { NavMenu } from '../help/NavMenu';
import { LifecycleDiagram } from './LifecycleDiagram';
import { SCENARIOS, scenarioById } from './lifecycle';
import {
  PHASE_LABELS,
  PHASE_ORDER,
  buildGroups,
  groupOf,
  isEvent,
  phaseOf,
} from './events';
import type { EventGroup, GroupKey, Phase } from './events';

const TRAINER_URL = import.meta.env.BASE_URL;
const HELP_URL = `${import.meta.env.BASE_URL}help/`;
const FULL_URL = `${import.meta.env.BASE_URL}help/full/`;
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const HOTKEY_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K';

/**
 * Route — выбор «что показать»:
 *   home    — приветствие / список групп
 *   owner   — все события owner-а (например, ДокументОбъект)
 *   entry   — карточка одного события (deep-link)
 */
type Route =
  | { kind: 'home' }
  | { kind: 'owner'; owner: string }
  | { kind: 'entry'; id: string }
  | { kind: 'lifecycle'; scenarioId: string };

function parseHash(hash: string): Route {
  const t = hash.replace(/^#\/?/, '');
  if (t === '') return { kind: 'home' };
  if (t.startsWith('lifecycle/')) {
    try {
      return { kind: 'lifecycle', scenarioId: decodeURIComponent(t.slice('lifecycle/'.length)) };
    } catch {
      return { kind: 'home' };
    }
  }
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
  if (route.kind === 'lifecycle') return `#/lifecycle/${encodeURIComponent(route.scenarioId)}`;
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
  const [entries, setEntries] = useState<SyntaxEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const route = useHashRoute();

  useEffect(() => {
    let alive = true;
    loadFullReference()
      .then((d) => alive && setEntries(d.entries))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  // Только методы-события из полной выгрузки.
  const events = useMemo(() => (entries ? entries.filter(isEvent) : []), [entries]);

  // Имена всех типов, у которых есть страница в полном СП — для ссылок
  // на тип из параметров/возврата события.
  const knownOwners = useMemo(
    () => new Set((entries ?? []).map((e) => e.owner)),
    [entries],
  );
  const typeHref = useCallback(
    (owner: string) =>
      `${import.meta.env.BASE_URL}help/full/#/owner/${encodeURIComponent(owner)}`,
    [],
  );

  // Глобальный ⌘K / Ctrl+K — переключение поиска по событиям.
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
  const groups = useMemo(() => buildGroups(events), [events]);

  // owner → его события (для центральной секции и навигации внутри)
  const eventsByOwner = useMemo(() => {
    const m = new Map<string, SyntaxEntry[]>();
    for (const e of events) {
      const list = m.get(e.owner) ?? [];
      list.push(e);
      m.set(e.owner, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
    }
    return m;
  }, [events]);

  const byId = useMemo(() => {
    const m = new Map<string, SyntaxEntry>();
    for (const e of events) m.set(entryId(e), e);
    return m;
  }, [events]);

  const currentEntry = route.kind === 'entry' ? byId.get(route.id) ?? null : null;
  const currentOwner =
    route.kind === 'owner' ? route.owner : currentEntry ? currentEntry.owner : null;

  useEffect(() => {
    if (currentEntry) {
      document.title = `${entryId(currentEntry)} — События 1С`;
    } else if (currentOwner) {
      document.title = `${currentOwner} — События 1С`;
    } else {
      document.title = 'События 1С — каталог';
    }
  }, [currentEntry, currentOwner]);

  return (
    <div className="help">
      <header className="help__header">
        <a className="help__brand" href={TRAINER_URL} title="К тренажёру">
          <span className="help__logo">BSLexicon</span>
          <span className="help__tagline">События 1С</span>
        </a>
        <div className="help__head-actions">
          {events.length > 0 && (
            <button
              type="button"
              className="help__search-btn"
              onClick={() => setSearchOpen(true)}
              title={`Поиск по событиям (${HOTKEY_LABEL})`}
            >
              <span aria-hidden="true">🔎</span>
              <span className="help__search-label">
                Поиск по {events.length} событиям — например, «ПередЗаписью»…
              </span>
              <kbd className="help__kbd">{HOTKEY_LABEL}</kbd>
            </button>
          )}
          <NavMenu
            links={[
              { label: 'События 1С', href: `${TRAINER_URL}help/events/`, current: true, hint: '670 событий + lifecycle' },
              { label: 'Учебный режим', href: HELP_URL, hint: '~180 записей с тренажёром' },
              { label: 'Полный СП', href: FULL_URL, hint: 'Все ~20 тыс. записей платформы' },
              { label: '← Тренажёр', href: TRAINER_URL, hint: 'Писать и отлаживать BSL' },
            ]}
          />
        </div>
      </header>

      <main className="help__body">
        <section className="help__content events__content">
          {error && <div className="help__missing"><h1>Ошибка</h1><p>{error}</p></div>}
          {!entries && !error && (
            <div className="fhelp__loading">
              <h1>Загружаю каталог событий…</h1>
              <p>~600 КБ единожды, дальше браузер кэширует.</p>
            </div>
          )}
          {entries && route.kind === 'home' && <Home groups={groups} totalEvents={events.length} />}
          {entries && route.kind === 'owner' && (
            <OwnerView
              owner={route.owner}
              events={eventsByOwner.get(route.owner) ?? []}
            />
          )}
          {entries && route.kind === 'lifecycle' && (
            <LifecycleView scenarioId={route.scenarioId} />
          )}
          {entries && route.kind === 'entry' && currentEntry && (
            <EventCard
              entry={currentEntry}
              owner={currentEntry.owner}
              knownOwners={knownOwners}
              typeHref={typeHref}
            />
          )}
          {entries && route.kind === 'entry' && !currentEntry && (
            <div className="help__missing">
              <h1>Не нашёл событие</h1>
              <p>В выгрузке нет элемента <code>{route.id}</code>.</p>
              <p><a href="#/">На главную событий</a></p>
            </div>
          )}
        </section>
        {entries && <Sidebar groups={groups} route={route} />}
      </main>

      {searchOpen && events.length > 0 && (
        <SearchOverlay
          entries={events}
          hrefFor={hrefFor}
          placeholder={`Поиск по ${events.length} событиям…`}
          onClose={closeSearch}
        />
      )}
    </div>
  );
}

function Sidebar({ groups, route }: { groups: EventGroup[]; route: Route }) {
  const activeOwner =
    route.kind === 'owner' ? route.owner :
    route.kind === 'entry' ? route.id.split('.', 1)[0] :
    null;
  const activeGroup = activeOwner ? groupOfRoute(activeOwner, groups) : null;
  const initial = useMemo(() => {
    const s = new Set<string>();
    if (activeGroup) s.add(activeGroup);
    return s;
  }, [activeGroup]);
  const [open, setOpen] = useState<Set<string>>(initial);

  useEffect(() => {
    if (activeGroup && !open.has(activeGroup)) {
      const n = new Set(open);
      n.add(activeGroup);
      setOpen(n);
    }
  }, [activeGroup, open]);

  const toggle = (k: string): void => {
    const n = new Set(open);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setOpen(n);
  };

  return (
    <nav className="sb" aria-label="Группы объектов 1С с событиями">
      <a className={'sb__home' + (route.kind === 'home' ? ' sb__home--active' : '')} href="#/">
        Главная
      </a>
      <ul className="sb__list">
        {groups.map((g) => {
          const isOpen = open.has(g.key);
          return (
            <li key={g.key} className="sb__group">
              <button
                type="button"
                className={'sb__groupHead' + (isOpen ? ' sb__groupHead--open' : '')}
                onClick={() => toggle(g.key)}
                aria-expanded={isOpen}
              >
                <span className="sb__chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span className="sb__groupName">{g.label}</span>
                <span className="sb__groupCount">{g.total}</span>
              </button>
              {isOpen && (
                <ul className="sb__entries">
                  {g.owners.map((o) => {
                    const active = activeOwner === o.name;
                    return (
                      <li key={o.name}>
                        <a
                          className={'sb__entry' + (active ? ' sb__entry--active' : '')}
                          href={formatHash({ kind: 'owner', owner: o.name })}
                          title={`${o.count} событий`}
                        >
                          {o.name}
                          <span className="events__owner-n">{o.count}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function groupOfRoute(owner: string, groups: EventGroup[]): GroupKey | null {
  for (const g of groups) {
    if (g.owners.some((o) => o.name === owner)) return g.key;
  }
  return null;
}

function Home({ groups, totalEvents }: { groups: EventGroup[]; totalEvents: number }) {
  return (
    <article className="events__home">
      <h1 className="events__title">События 1С</h1>
      <p className="events__lead">
        Каталог всех «При / Перед / После / Обработка» событий из синтакс-помощника 1С:{' '}
        <b>{totalEvents.toLocaleString('ru')}</b> событий по{' '}
        <b>{groups.reduce((n, g) => n + g.owners.length, 0)}</b> объектам.
        Выберите группу слева и владельца — увидите события, сгруппированные по фазам
        (Перед / При / После / Обработка).
      </p>
      <ul className="events__group-grid">
        {groups.map((g) => (
          <li key={g.key} className="events__group-card">
            <div className="events__group-card-title">{g.label}</div>
            <div className="events__group-card-num">{g.total}</div>
            <div className="events__group-card-owners">{g.owners.length} объект(ов)</div>
          </li>
        ))}
      </ul>

      <section className="events__lifecycles">
        <h2 className="events__lifecycles-title">Жизненный цикл — типичные сценарии</h2>
        <p className="events__lifecycles-lead">
          Курированные диаграммы: что и в каком порядке срабатывает при типичных
          действиях пользователя. Клик по шагу — карточка события.
        </p>
        <ul className="events__lifecycles-list">
          {SCENARIOS.map((s) => (
            <li key={s.id}>
              <a
                className="events__lifecycle-link"
                href={`#/lifecycle/${encodeURIComponent(s.id)}`}
              >
                <span className="events__lifecycle-title">{s.title}</span>
                <span className="events__lifecycle-meta">{s.steps.length} шагов</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function LifecycleView({ scenarioId }: { scenarioId: string }) {
  const scenario = scenarioById(scenarioId);
  if (!scenario) {
    return (
      <div className="help__missing">
        <h1>Сценарий не найден</h1>
        <p>Нет сценария с id <code>{scenarioId}</code>.</p>
        <p><a href="#/">На главную событий</a></p>
      </div>
    );
  }
  return (
    <article className="lifecycle">
      <nav className="crumbs">
        <a href="#/">События</a>
        <span className="crumbs__sep"> / </span>
        <span className="crumbs__active">{scenario.title}</span>
      </nav>
      <h1 className="lifecycle__title">{scenario.title}</h1>
      <p className="lifecycle__desc">{scenario.description}</p>
      <div className="lifecycle__diagram-wrap">
        <LifecycleDiagram
          scenario={scenario}
          hrefForEvent={(eventId) => `#/${encodeURIComponent(eventId)}`}
        />
      </div>
      <section className="lifecycle__steps">
        <h2 className="lifecycle__steps-title">Шаги с пояснениями</h2>
        <ol className="lifecycle__steps-list">
          {scenario.steps.map((step, i) => (
            <li key={step.id} className="lifecycle__step-row">
              <div className="lifecycle__step-num">{i + 1}</div>
              <div className="lifecycle__step-body">
                <a
                  className="lifecycle__step-link"
                  href={`#/${encodeURIComponent(step.event)}`}
                >
                  {step.displayName ?? step.event}
                </a>
                <span className="lifecycle__step-lane">
                  · {scenario.swimlanes.find((l) => l.id === step.swimlane)?.label}
                </span>
                {step.note && <p className="lifecycle__step-note">{step.note}</p>}
                {step.cancel && (
                  <p className="lifecycle__step-cancel">✗ {step.cancel}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function OwnerView({ owner, events }: { owner: string; events: SyntaxEntry[] }) {
  // Группируем события owner-а по фазе
  const byPhase = useMemo(() => {
    const m = new Map<Phase, SyntaxEntry[]>();
    for (const e of events) {
      const p = phaseOf(e.nameRu);
      const list = m.get(p) ?? [];
      list.push(e);
      m.set(p, list);
    }
    return m;
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="help__missing">
        <h1>{owner}</h1>
        <p>У этого объекта нет событий в выгрузке.</p>
      </div>
    );
  }

  return (
    <article className="events__owner">
      <nav className="crumbs">
        <a href="#/">События</a>
        <span className="crumbs__sep"> / </span>
        <span className="crumbs__active">{owner}</span>
      </nav>
      <h1 className="events__owner-title">{owner}</h1>
      <p className="events__owner-meta">{events.length} событий, сгруппированы по фазе.</p>
      {PHASE_ORDER.map((phase) => {
        const list = byPhase.get(phase);
        if (!list || list.length === 0) return null;
        return (
          <section key={phase} className="events__phase">
            <h2 className={`events__phase-title events__phase-title--${phase}`}>
              {PHASE_LABELS[phase]} <span className="events__phase-n">{list.length}</span>
            </h2>
            <ul className="events__list">
              {list.map((e) => (
                <li key={entryId(e)}>
                  <a className="events__item" href={formatHash({ kind: 'entry', id: entryId(e) })}>
                    <span className="events__item-name">{e.nameRu}</span>
                    <span className="events__item-en">{e.nameEn}</span>
                    {e.signature && (
                      <span className="events__item-sig" title={e.signature}>
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
  // Только список параметров для компактного отображения
  const m = sig.match(/\(([^)]*)\)/);
  return m ? `(${m[1]})` : '';
}

function EventCard({
  entry,
  owner,
  knownOwners,
  typeHref,
}: {
  entry: SyntaxEntry;
  owner: string;
  knownOwners: ReadonlySet<string>;
  typeHref: (owner: string) => string;
}) {
  void groupOf; // импорт-shake защита от пустого использования в production
  const available = new Set(entry.availabilityKeys);
  return (
    <article className="card">
      <nav className="crumbs">
        <a href="#/">События</a>
        <span className="crumbs__sep"> / </span>
        <a href={formatHash({ kind: 'owner', owner })}>{owner}</a>
        <span className="crumbs__sep"> / </span>
        <span className="crumbs__active">{entry.nameRu}</span>
      </nav>

      <header className="card__head">
        <h1 className="card__title">
          {owner}.{entry.nameRu}
          <span className="card__en">({entry.ownerEn}.{entry.nameEn})</span>
        </h1>
        <span className="card__kind">событие · {PHASE_LABELS[phaseOf(entry.nameRu)]}</span>
      </header>

      {entry.signature && <pre className="card__sig">{entry.signature}</pre>}

      {entry.params.length > 0 && (
        <table className="params">
          <thead>
            <tr><th>Параметр</th><th>Тип</th><th>Обязательность</th></tr>
          </thead>
          <tbody>
            {entry.params.map((p) => (
              <tr key={p.name}>
                <td className="params__name">{p.name}</td>
                <td className="params__type">
                  <TypeRef type={p.type} knownOwners={knownOwners} hrefFor={typeHref} />
                </td>
                <td className="params__opt">{p.optional ? 'необязательный' : 'обязательный'}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
          >
            📖 Описание и пример на сайте 1С →
          </a>
          <p className="card__source-note">
            Тексты и примеры синтакс-помощника — собственность «1С». Полное описание — по ссылке.
          </p>
        </section>
      )}
    </article>
  );
}
