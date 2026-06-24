import { useEffect, useMemo, useRef, useState } from 'react';
import type { SyntaxEntry } from '../app/reference/types';
import { entryId } from './loader';
import { search } from './search';

interface SearchOverlayProps {
  entries: readonly SyntaxEntry[];
  /** Куда переходить при выборе записи. Возвращает URL (hash или href). */
  hrefFor: (entry: SyntaxEntry) => string;
  /** Опционально — заголовок поиска (что ищем — «по 670 событиям» и т.п.). */
  placeholder?: string;
  onClose: () => void;
}

const KIND_LABEL: Record<SyntaxEntry['kind'], string> = {
  function: 'функция',
  method: 'метод',
  property: 'свойство',
  event: 'событие',
};

/**
 * Общий ⌘K-overlay для /help/full/ и /help/events/. Работает над любыми
 * `SyntaxEntry[]` — каталогом по умолчанию (full) или событиями.
 * Поиск через `full-help/search.ts` (regex-подстрока с ранжированием).
 */
export function SearchOverlay({ entries, hrefFor, placeholder, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const hits = useMemo(() => (query.trim() === '' ? [] : search(entries, query, 100)), [entries, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLLIElement>(`li[data-i="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
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
      if (hit) {
        window.location.href = hrefFor(hit.entry);
        onClose();
      }
    }
  };

  return (
    <div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={onKey}
      role="dialog"
      aria-modal="true"
      aria-label="Поиск"
    >
      <div className="overlay__panel">
        <input
          ref={inputRef}
          className="overlay__input"
          type="search"
          placeholder={placeholder ?? 'Поиск: имя ru/en или Тип.Член'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {query.trim() === '' ? (
          <div className="overlay__hint">Начните печатать. ↑/↓ — выбор, Enter — открыть, Esc — закрыть.</div>
        ) : (
          <div className="overlay__hint">
            {hits.length === 0 ? 'Ничего не нашлось' : `${hits.length} результат${plural(hits.length)}`}
          </div>
        )}
        <ul className="overlay__list" ref={listRef}>
          {hits.map((h, i) => {
            const id = entryId(h.entry);
            return (
              <li
                key={id}
                data-i={i}
                className={'overlay__item' + (i === selected ? ' overlay__item--active' : '')}
                onMouseEnter={() => setSelected(i)}
                onClick={() => {
                  window.location.href = hrefFor(h.entry);
                  onClose();
                }}
              >
                <span className="overlay__kind">{KIND_LABEL[h.entry.kind]}</span>
                <span className="overlay__name">
                  <Highlighted text={id} index={h.matchIndex} ql={query.trim().length} />
                </span>
                <span className="overlay__en">{h.entry.nameEn}</span>
                <span className="overlay__cat">
                  {h.entry.kind === 'function' ? 'Глобальный контекст' : h.entry.owner}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Highlighted({ text, index, ql }: { text: string; index: number; ql: number }) {
  if (index < 0 || ql <= 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="overlay__mark">{text.slice(index, index + ql)}</mark>
      {text.slice(index + ql)}
    </>
  );
}

function plural(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return '';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'а';
  return 'ов';
}
