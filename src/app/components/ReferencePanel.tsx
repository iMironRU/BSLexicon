import { useEffect, useMemo, useState } from 'react';
import { loadReference } from '../reference/load';
import type { SyntaxEntry } from '../reference/types';

interface ReferencePanelProps {
  onClose: () => void;
}

const KIND_LABEL: Record<SyntaxEntry['kind'], string> = {
  function: 'функция',
  method: 'метод',
  property: 'свойство',
};

export function ReferencePanel({ onClose }: ReferencePanelProps) {
  const [entries, setEntries] = useState<SyntaxEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.nameRu.toLowerCase().includes(q) ||
        e.nameEn.toLowerCase().includes(q) ||
        e.owner.toLowerCase().includes(q),
    );
  }, [entries, query]);

  return (
    <aside className="ref">
      <div className="ref__head">
        <span className="ref__title">Справочник</span>
        <button className="ref__close" onClick={onClose} type="button" title="Закрыть">
          ✕
        </button>
      </div>

      <input
        className="ref__search"
        type="search"
        placeholder="Поиск: имя ru/en или тип…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {error && <div className="ref__error">{error}</div>}
      {!entries && !error && <div className="ref__hint">Загрузка справочника…</div>}

      {selected && <ReferenceCard entry={selected} />}

      {entries && (
        <>
          <ul className="ref__list">
            {filtered.slice(0, 400).map((e) => (
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
                >
                  <span className="ref__name">{e.nameRu}</span>
                  <span className="ref__en">{e.nameEn}</span>
                  <span className="ref__owner">{e.owner === 'Глобальный контекст' ? 'глоб.' : e.owner}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="ref__count">
            {filtered.length > 400 ? `показаны первые 400 из ${filtered.length}` : `${filtered.length} записей`}
          </div>
        </>
      )}
    </aside>
  );
}

function ReferenceCard({ entry }: { entry: SyntaxEntry }) {
  return (
    <div className="ref__card">
      <div className="ref__card-title">
        {entry.owner === 'Глобальный контекст' ? '' : `${entry.owner}.`}
        {entry.nameRu} <span className="ref__card-en">({entry.nameEn})</span>
        <span className="ref__kind">{KIND_LABEL[entry.kind]}</span>
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
