import { useEffect, useMemo, useState } from 'react';
import type { Catalog } from '@core/index';
import { loadReference } from '../reference/load';
import type { SyntaxEntry } from '../reference/types';

interface ReferencePanelProps {
  /** Рантайм-каталог: на нём строится мост «исполняется / только справка». */
  catalog: Catalog;
  onClose: () => void;
}

const KIND_LABEL: Record<SyntaxEntry['kind'], string> = {
  function: 'функция',
  method: 'метод',
  property: 'свойство',
};

/** Стабильный порядок категорий: сначала самое массовое и часто нужное. */
const CATEGORY_ORDER = [
  'Строки',
  'Числа',
  'Даты',
  'Коллекции',
  'Преобразование',
  'Форматирование',
  'Тип',
  'Прочее',
];

/** Идентификатор записи в рантайм-каталоге: «СтрНайти» или «Массив.Добавить». */
function runtimeId(entry: SyntaxEntry): string {
  return entry.kind === 'method' ? `${entry.owner}.${entry.nameRu}` : entry.nameRu;
}

/** Есть ли запись в рантайме (значит, в тренажёре реально исполняется). */
function isRuntime(entry: SyntaxEntry, catalog: Catalog): boolean {
  return catalog.byId.has(runtimeId(entry));
}

export function ReferencePanel({ catalog, onClose }: ReferencePanelProps) {
  const [entries, setEntries] = useState<SyntaxEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<SyntaxEntry | null>(null);

  useEffect(() => {
    let alive = true;
    loadReference()
      .then((data) => alive && setEntries(data))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  /** Категории, реально встречающиеся в датасете, в каноническом порядке. */
  const categories = useMemo(() => {
    if (!entries) return [] as { name: string; total: number; runtime: number }[];
    const tally = new Map<string, { total: number; runtime: number }>();
    for (const e of entries) {
      const acc = tally.get(e.category) ?? { total: 0, runtime: 0 };
      acc.total += 1;
      if (isRuntime(e, catalog)) acc.runtime += 1;
      tally.set(e.category, acc);
    }
    const ordered = CATEGORY_ORDER.filter((c) => tally.has(c));
    for (const c of tally.keys()) if (!ordered.includes(c)) ordered.push(c);
    return ordered.map((name) => ({ name, ...(tally.get(name) as { total: number; runtime: number }) }));
  }, [entries, catalog]);

  /** Суммарная статистика «исполняется / всего» для шапки. */
  const totalStats = useMemo(() => {
    if (!entries) return { total: 0, runtime: 0 };
    let runtime = 0;
    for (const e of entries) if (isRuntime(e, catalog)) runtime += 1;
    return { total: entries.length, runtime };
  }, [entries, catalog]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeCategory && e.category !== activeCategory) return false;
      if (!q) return true;
      return (
        e.nameRu.toLowerCase().includes(q) ||
        e.nameEn.toLowerCase().includes(q) ||
        e.owner.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q)
      );
    });
  }, [entries, query, activeCategory]);

  return (
    <aside className="ref">
      <div className="ref__head">
        <span className="ref__title">Справочник</span>
        {entries && (
          <span className="ref__stats" title="Реально исполняется в тренажёре / всего в справочнике">
            <span className="ref__dot ref__dot--on" /> {totalStats.runtime} / {totalStats.total}
          </span>
        )}
        <button className="ref__close" onClick={onClose} type="button" title="Закрыть">
          ✕
        </button>
      </div>

      <input
        className="ref__search"
        type="search"
        placeholder="Поиск: имя ru/en, тип или категория…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {categories.length > 0 && (
        <nav className="ref__cats" aria-label="Категории">
          <button
            className={'ref__cat' + (activeCategory === null ? ' ref__cat--active' : '')}
            onClick={() => setActiveCategory(null)}
            type="button"
          >
            Все <span className="ref__cat-n">{totalStats.total}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              className={'ref__cat' + (activeCategory === c.name ? ' ref__cat--active' : '')}
              onClick={() => setActiveCategory(c.name)}
              type="button"
              title={`Исполняется ${c.runtime} из ${c.total}`}
            >
              {c.name} <span className="ref__cat-n">{c.total}</span>
            </button>
          ))}
        </nav>
      )}

      {error && <div className="ref__error">{error}</div>}
      {!entries && !error && <div className="ref__hint">Загрузка справочника…</div>}

      {selected && <ReferenceCard entry={selected} runtime={isRuntime(selected, catalog)} />}

      {entries && (
        <>
          <ul className="ref__list">
            {filtered.slice(0, 400).map((e) => {
              const runtime = isRuntime(e, catalog);
              return (
                <li key={`${e.owner}.${e.nameRu}`}>
                  <button
                    className={
                      'ref__item' +
                      (selected?.nameRu === e.nameRu && selected.owner === e.owner
                        ? ' ref__item--active'
                        : '')
                    }
                    onClick={() => setSelected(e)}
                    type="button"
                    title={runtime ? 'Реально исполняется в тренажёре' : 'Только справка'}
                  >
                    <span
                      className={'ref__dot ' + (runtime ? 'ref__dot--on' : 'ref__dot--off')}
                      aria-hidden="true"
                    />
                    <span className="ref__name">{e.nameRu}</span>
                    <span className="ref__en">{e.nameEn}</span>
                    <span className="ref__owner">
                      {e.owner === 'Глобальный контекст' ? e.category : e.owner}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="ref__count">
            {filtered.length > 400
              ? `показаны первые 400 из ${filtered.length}`
              : `${filtered.length} записей`}
          </div>
        </>
      )}
    </aside>
  );
}

function ReferenceCard({ entry, runtime }: { entry: SyntaxEntry; runtime: boolean }) {
  return (
    <div className="ref__card">
      <div className="ref__card-title">
        {entry.owner === 'Глобальный контекст' ? '' : `${entry.owner}.`}
        {entry.nameRu} <span className="ref__card-en">({entry.nameEn})</span>
        <span className="ref__kind">{KIND_LABEL[entry.kind]}</span>
      </div>

      <div className={'ref__status ' + (runtime ? 'ref__status--on' : 'ref__status--off')}>
        <span className={'ref__dot ' + (runtime ? 'ref__dot--on' : 'ref__dot--off')} />
        {runtime ? 'Реально исполняется в тренажёре' : 'Только справка — в рантайме пока нет'}
        <span className="ref__card-cat">· {entry.category}</span>
      </div>

      {entry.signature && <pre className="ref__sig">{entry.signature}</pre>}

      {entry.params.length > 0 && (
        <table className="ref__params">
          <tbody>
            {entry.params.map((p) => (
              <tr key={p.name}>
                <td className="ref__pname">{p.name}</td>
                <td className="ref__ptype">{p.type ?? '—'}</td>
                <td className="ref__popt">{p.optional ? 'необязательный' : 'обязательный'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entry.returnType && (
        <div className="ref__return">
          Возвращает: <b>{entry.returnType}</b>
        </div>
      )}

      {entry.availability.length > 0 && (
        <div className="ref__avail">Доступность: {entry.availability.join(', ')}</div>
      )}
    </div>
  );
}
