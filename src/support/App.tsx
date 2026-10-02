import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '../app/error-message';
import { BASE_URL, HELP_FULL_URL, HELP_URL, LANDING_URL } from '../app/urls';
import { useHashRoute } from '../app/hash-route';
import {
  ALL_CONTEXTS,
  CONTEXT_LABELS,
  compareVersion,
  type ContextKey,
} from '../help/target';

/**
 * «Поддержка платформы» — витрина в духе caniuse.com для 1С.
 * На входе — тот же `syntax-availability.json`, что тренажёр использует для
 * warning'ов в редакторе. Здесь это не фильтр по target, а наоборот: сетка
 * «запись × версия/контексты», в которую читатель может прицелиться.
 */

interface IndexEntry {
  name: string;
  since?: string;
  contexts?: ContextKey[];
}

interface AvailabilityIndex {
  functions: Record<string, IndexEntry>;
  types: Record<string, IndexEntry>;
}

type Kind = 'function' | 'type';

interface Row {
  kind: Kind;
  name: string;
  since: string;
  contexts: ReadonlySet<ContextKey>;
}

interface Pinned {
  kind: Kind;
  name: string;
}

/** Deep-link: `#function/СокрЛП`, `#type/ТабличныйДокумент`. */
function parsePinned(hash: string): Pinned | null {
  const raw = hash.replace(/^#/, '');
  if (!raw) return null;
  const [k, ...rest] = raw.split('/');
  if (k !== 'function' && k !== 'type') return null;
  try {
    const name = decodeURIComponent(rest.join('/'));
    return name ? { kind: k, name } : null;
  } catch {
    return null;
  }
}

function pinnedHref(p: Pinned): string {
  return `#${p.kind}/${encodeURIComponent(p.name)}`;
}

export function App(): JSX.Element {
  const [data, setData] = useState<AvailabilityIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all');
  const [targetVersion, setTargetVersion] = useState<string>('');
  const [targetContexts, setTargetContexts] = useState<ReadonlySet<ContextKey>>(new Set());
  const pinned = useHashRoute(parsePinned);
  const pinnedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    fetch(`${BASE_URL}reference/syntax-availability.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<AvailabilityIndex>;
      })
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const out: Row[] = [];
    for (const e of Object.values(data.functions)) {
      if (e.since) out.push({ kind: 'function', name: e.name, since: e.since, contexts: new Set(e.contexts ?? []) });
    }
    for (const e of Object.values(data.types)) {
      if (e.since) out.push({ kind: 'type', name: e.name, since: e.since, contexts: new Set(e.contexts ?? []) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return out;
  }, [data]);

  const versions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.since);
    return [...set].sort(compareVersion).reverse();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, kindFilter]);

  const displayed = useMemo(() => {
    const base = filtered.slice(0, 300);
    // Если пришли по deep-link'у на запись, которую обрезало — всё равно
    // показываем её наверху, иначе ссылка бы молча перестала работать.
    if (pinned) {
      const already = base.some((r) => r.kind === pinned.kind && r.name === pinned.name);
      if (!already) {
        const row = rows.find((r) => r.kind === pinned.kind && r.name === pinned.name);
        if (row) return [row, ...base];
      }
    }
    return base;
  }, [filtered, pinned, rows]);

  useEffect(() => {
    if (!pinned) return;
    // Два RAF подряд: один «пропускаем commit», второй — ждём paint.
    // Иначе scrollIntoView ловит промежуточную высоту списка и уезжает мимо.
    let r1 = 0, r2 = 0;
    r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => {
        pinnedRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
      });
    });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [pinned, displayed]);

  if (error) {
    return (
      <div className="sup-shell">
        <p className="sup-error">Не удалось загрузить данные: {error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="sup-shell">
        <p className="sup-loading">Загружаю индекс совместимости…</p>
      </div>
    );
  }

  return (
    <div className="sup-shell">
      <header className="sup-header">
        <a href={LANDING_URL} className="sup-home">← BSLexicon</a>
        <h1>Поддержка платформы</h1>
        <a href={HELP_URL} className="sup-link">/help/</a>
      </header>

      <section className="sup-intro">
        <p>
          Что доступно в платформе 1С: {rows.length} записей (функции и типы) с указанием версии «начиная с»
          и контекстов исполнения. Выбери свою целевую версию и контексты — цветные плашки покажут
          совместимость каждой записи, как на <code>caniuse.com</code>.
        </p>
      </section>

      <section className="sup-filters">
        <div className="sup-filter">
          <label htmlFor="sup-q" className="sup-filter__label">Поиск</label>
          <input
            id="sup-q"
            type="search"
            className="sup-filter__input"
            placeholder="«ОткрытьФорму», «ТабличныйДокумент», «СтрНайти»…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </div>

        <div className="sup-filter">
          <span className="sup-filter__label">Что</span>
          <div className="sup-chipgroup" role="group">
            <KindChip label="Всё"       value="all"      current={kindFilter} onPick={setKindFilter} />
            <KindChip label="Функции"   value="function" current={kindFilter} onPick={setKindFilter} />
            <KindChip label="Типы"      value="type"     current={kindFilter} onPick={setKindFilter} />
          </div>
        </div>

        <div className="sup-filter">
          <label htmlFor="sup-v" className="sup-filter__label">Моя версия</label>
          <select
            id="sup-v"
            className="sup-filter__select"
            value={targetVersion}
            onChange={(e) => setTargetVersion(e.target.value)}
          >
            <option value="">— любая —</option>
            {versions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="sup-filter sup-filter--contexts">
          <span className="sup-filter__label">Контексты</span>
          <div className="sup-chipgroup" role="group">
            {ALL_CONTEXTS.map((c) => (
              <ContextChip
                key={c}
                ctx={c}
                selected={targetContexts.has(c)}
                onToggle={() => {
                  const next = new Set(targetContexts);
                  if (next.has(c)) next.delete(c); else next.add(c);
                  setTargetContexts(next);
                }}
              />
            ))}
            {targetContexts.size > 0 && (
              <button
                type="button"
                className="sup-chip sup-chip--clear"
                onClick={() => setTargetContexts(new Set())}
              >
                сбросить
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="sup-counts">
        Нашлось: <strong>{filtered.length}</strong>
        {filtered.length > displayed.length && (
          <span className="sup-counts__trim"> · показываю первые {displayed.length}, уточни поиск</span>
        )}
      </section>

      <section className="sup-table" aria-label="Совместимость записей с версиями и контекстами 1С">
        <div className="sup-table__head">
          <span className="sup-col sup-col--name">Запись</span>
          <span className="sup-col sup-col--since">С версии</span>
          <span className="sup-col sup-col--verdict">У меня</span>
          <span className="sup-col sup-col--ctx">Контексты</span>
        </div>
        {displayed.map((row) => {
          const isPinned = pinned?.kind === row.kind && pinned.name === row.name;
          return (
            <RowView
              key={`${row.kind}:${row.name}`}
              row={row}
              targetVersion={targetVersion}
              targetContexts={targetContexts}
              pinned={isPinned}
              rowRef={isPinned ? pinnedRef : undefined}
            />
          );
        })}
        {displayed.length === 0 && (
          <p className="sup-empty">По запросу ничего не найдено.</p>
        )}
      </section>

      <footer className="sup-footer">
        <span>
          Полное описание и примеры — в{' '}
          <a href={HELP_URL}>курированном</a> или <a href={HELP_FULL_URL}>полном</a> синтакс-помощнике.
        </span>
        <span className="sup-footer__build">
          сборка {__BUILD_SHA__} · {__BUILD_TIME__}
        </span>
      </footer>
    </div>
  );
}

function KindChip({
  value, label, current, onPick,
}: {
  value: 'all' | Kind;
  label: string;
  current: 'all' | Kind;
  onPick: (v: 'all' | Kind) => void;
}): JSX.Element {
  const active = current === value;
  return (
    <button
      type="button"
      className={'sup-chip' + (active ? ' sup-chip--active' : '')}
      aria-pressed={active}
      onClick={() => onPick(value)}
    >
      {label}
    </button>
  );
}

function ContextChip({
  ctx, selected, onToggle,
}: {
  ctx: ContextKey;
  selected: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={'sup-chip' + (selected ? ' sup-chip--active' : '')}
      aria-pressed={selected}
      onClick={onToggle}
      title={CONTEXT_LABELS[ctx]}
    >
      {CONTEXT_LABELS[ctx]}
    </button>
  );
}

function RowView({
  row, targetVersion, targetContexts, pinned, rowRef,
}: {
  row: Row;
  targetVersion: string;
  targetContexts: ReadonlySet<ContextKey>;
  pinned: boolean;
  rowRef?: React.MutableRefObject<HTMLElement | null>;
}): JSX.Element {
  const verdict = computeVerdict(row, targetVersion, targetContexts);
  // /help/full/ — одна ссылка на обе роли (функция/тип): entryId там это
  // просто `nameRu` для функций и типов, у нас такой же `name`.
  const helpHref = `${HELP_FULL_URL}#/${encodeURIComponent(row.name)}`;
  return (
    <article
      ref={rowRef as React.RefObject<HTMLElement>}
      className={
        `sup-row sup-row--${verdict.kind}` + (pinned ? ' sup-row--pinned' : '')
      }
    >
      <div className="sup-col sup-col--name">
        <a
          className="sup-row__pin"
          href={pinnedHref({ kind: row.kind, name: row.name })}
          title="Прямая ссылка на запись"
        >
          <code>{row.name}</code>
        </a>
        <span className="sup-row__badge">{row.kind === 'function' ? 'ф-ция' : 'тип'}</span>
        <a
          className="sup-row__help"
          href={helpHref}
          target="_blank"
          rel="noopener noreferrer"
          title="Открыть в полном синтакс-помощнике"
        >
          ↗
        </a>
      </div>
      <div className="sup-col sup-col--since">
        <span className="sup-since">{row.since}</span>
      </div>
      <div className="sup-col sup-col--verdict">
        <VerdictPill verdict={verdict} />
      </div>
      <div className="sup-col sup-col--ctx">
        {ALL_CONTEXTS.map((c) => (
          <span
            key={c}
            className={
              'sup-ctx' +
              (row.contexts.has(c) ? ' sup-ctx--on' : ' sup-ctx--off') +
              (targetContexts.has(c) ? ' sup-ctx--picked' : '')
            }
            title={CONTEXT_LABELS[c] + (row.contexts.has(c) ? ' — есть' : ' — нет')}
          >
            {shortCtxLabel(c)}
          </span>
        ))}
      </div>
    </article>
  );
}

interface Verdict {
  kind: 'yes' | 'no' | 'unknown' | 'any';
  reason?: string;
}

function computeVerdict(
  row: Row,
  targetVersion: string,
  targetContexts: ReadonlySet<ContextKey>,
): Verdict {
  if (!targetVersion && targetContexts.size === 0) return { kind: 'any' };
  if (targetVersion && compareVersion(row.since, targetVersion) > 0) {
    return { kind: 'no', reason: `нужно ${row.since}` };
  }
  if (targetContexts.size > 0) {
    const missing: ContextKey[] = [];
    for (const c of targetContexts) if (!row.contexts.has(c)) missing.push(c);
    if (missing.length > 0) return { kind: 'no', reason: `нет в ${missing.map((c) => CONTEXT_LABELS[c]).join(', ')}` };
  }
  return { kind: 'yes' };
}

function VerdictPill({ verdict }: { verdict: Verdict }): JSX.Element {
  if (verdict.kind === 'any') return <span className="sup-pill sup-pill--any">—</span>;
  if (verdict.kind === 'yes') return <span className="sup-pill sup-pill--yes">да</span>;
  if (verdict.kind === 'unknown') return <span className="sup-pill sup-pill--unknown">?</span>;
  return <span className="sup-pill sup-pill--no" title={verdict.reason}>нет</span>;
}

/** 3-символьная аббревиатура контекста — чипы в колонке контекстов узкие. */
function shortCtxLabel(c: ContextKey): string {
  switch (c) {
    case 'thin': return 'ТК';
    case 'thick': return 'ТлК';
    case 'web': return 'ВК';
    case 'server': return 'СВ';
    case 'external': return 'ВС';
    case 'mobile-client': return 'МП';
    case 'mobile-server': return 'МС';
    case 'mobile-standalone': return 'МА';
    case 'mobile-thin': return 'МК';
  }
}
