import { useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, CatalogEntry } from '@core/index';
import type { SyntaxEntry } from '../app/reference/types';
import { formatHash } from './router';
import { loadRecent, pushRecent } from './recent';
import { search } from './search';
import type { SearchHit } from './search';
import { isAvailable } from './target';
import type { Target } from './target';

interface SearchOverlayProps {
  catalog: Catalog;
  syntaxIndex: Map<string, SyntaxEntry>;
  target: Target;
  onClose: () => void;
}

const KIND_LABEL: Record<CatalogEntry['kind'], string> = {
  function: 'функция',
  type: 'тип',
  method: 'метод',
  property: 'свойство',
};

const KIND_FILTERS: { id: CatalogEntry['kind'] | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'function', label: 'Функции' },
  { id: 'type', label: 'Типы' },
  { id: 'method', label: 'Методы' },
  { id: 'property', label: 'Свойства' },
];

export function SearchOverlay({ catalog, syntaxIndex, target, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CatalogEntry['kind'] | 'all'>('all');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Все хиты (до фильтра): для пустого запроса показываем историю.
  const recentHits = useMemo(() => {
    if (query.trim() !== '') return null;
    return loadRecent()
      .map((id) => catalog.byId.get(id))
      .filter((e): e is CatalogEntry => !!e)
      .map<SearchHit>((entry) => ({ entry, score: 0, match: 'exact-name', matchIndex: 0 }));
  }, [catalog, query]);

  const searchHits = useMemo(() => {
    if (query.trim() === '') return [];
    return search(catalog, query, 100);
  }, [catalog, query]);

  const hits = useMemo(() => {
    const source = recentHits ?? searchHits;
    if (filter === 'all') return source;
    return source.filter((h) => h.entry.kind === filter);
  }, [recentHits, searchHits, filter]);

  // Авто-фокус на инпут при открытии. Esc / Cmd+K — закрытие (родитель).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Сбросить selected при смене запроса/фильтра.
  useEffect(() => {
    setSelected(0);
  }, [query, filter]);

  // Скроллить активный пункт в видимую область.
  useEffect(() => {
    const li = listRef.current?.querySelector<HTMLLIElement>(`li[data-i="${selected}"]`);
    li?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, hits.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[selected];
      if (hit) go(hit.entry);
    }
  };

  const go = (entry: CatalogEntry): void => {
    pushRecent(entry.id);
    window.location.hash = formatHash({ kind: 'entry', entryKind: entry.kind, id: entry.id });
    onClose();
  };

  return (
    <div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Поиск по справочнику"
    >
      <div className="overlay__panel">
        <input
          ref={inputRef}
          className="overlay__input"
          type="search"
          placeholder="Поиск: имя ru/en или фраза в описании…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />

        <nav className="overlay__filters" aria-label="Фильтр по типу">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={'overlay__chip' + (filter === f.id ? ' overlay__chip--active' : '')}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </nav>

        {recentHits !== null && recentHits.length > 0 && (
          <div className="overlay__hint">Недавнее (Ctrl+K — открыть/закрыть)</div>
        )}
        {recentHits !== null && recentHits.length === 0 && (
          <div className="overlay__hint">Начните печатать. ↑/↓ — выбор, Enter — открыть, Esc — закрыть.</div>
        )}
        {query.trim() !== '' && (
          <div className="overlay__hint">
            {hits.length === 0 ? 'Ничего не нашлось' : `${hits.length} результат${plural(hits.length)}`}
          </div>
        )}

        <ul className="overlay__list" ref={listRef}>
          {hits.map((h, i) => {
            const syntax = syntaxIndex.get(h.entry.id);
            const v = syntax ? isAvailable(syntax, target) : 'unknown';
            return (
              <li
                key={h.entry.id}
                data-i={i}
                className={
                  'overlay__item' +
                  (i === selected ? ' overlay__item--active' : '') +
                  (v === 'no' ? ' overlay__item--blocked' : '')
                }
                onMouseEnter={() => setSelected(i)}
                onClick={() => go(h.entry)}
              >
                <span className="overlay__kind">{KIND_LABEL[h.entry.kind]}</span>
                <span className="overlay__name">
                  {v !== 'unknown' && <span className={`dot dot--${v}`} aria-hidden="true" />}
                  <HighlightedName id={h.entry.id} hit={h} query={query} />
                </span>
                <span className="overlay__en">{h.entry.names.en}</span>
                <span className="overlay__cat">{h.entry.category}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function HighlightedName({ id, hit, query }: { id: string; hit: SearchHit; query: string }) {
  if (hit.match === 'exact-name' || hit.match === 'name-start' || hit.match === 'name-substr') {
    if (hit.matchIndex >= 0) {
      const q = query.trim();
      // matchIndex считается по lowercase, но длина запроса одинакова в любом регистре
      const before = id.slice(0, hit.matchIndex);
      const match = id.slice(hit.matchIndex, hit.matchIndex + q.length);
      const after = id.slice(hit.matchIndex + q.length);
      return (
        <>
          {before}
          <mark className="overlay__mark">{match}</mark>
          {after}
        </>
      );
    }
  }
  return <>{id}</>;
}

function plural(n: number): string {
  // Простая русская плюрализация для «результат[а/ов]».
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return '';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'а';
  return 'ов';
}
