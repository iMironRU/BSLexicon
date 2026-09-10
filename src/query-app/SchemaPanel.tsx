/**
 * Панель схемы слева от редактора: дерево «Kind → Таблица → поля».
 * Клик по имени таблицы вставляет её в текущую позицию редактора.
 */
import { useMemo, useState } from 'react';
import type { Field, Schema, Table } from '../query/types';

interface SchemaPanelProps {
  schema: Schema;
  /** Ссылка на схему, если база пришла по ней, — чтобы было видно, чем работаем. */
  schemaUrl?: string;
  onInsertText: (text: string) => void;
  /** Клик по строке-таблице — заменить содержимое редактора на `ВЫБРАТЬ * ИЗ Kind.Name`. */
  onShowTable: (ref: string) => void;
}

const KIND_LABEL: { [k in Table['kind']]: string } = {
  'Справочник': 'Справочники',
  'Документ': 'Документы',
  'РегистрНакопления': 'Регистры накопления',
  'РегистрСведений': 'Регистры сведений',
};

const KIND_ORDER: Table['kind'][] = ['Справочник', 'Документ', 'РегистрНакопления', 'РегистрСведений'];

export function SchemaPanel({ schema, schemaUrl, onInsertText, onShowTable }: SchemaPanelProps) {
  const groups = useMemo(() => {
    const map = new Map<Table['kind'], Table[]>();
    for (const t of schema.tables) {
      let arr = map.get(t.kind);
      if (!arr) { arr = []; map.set(t.kind, arr); }
      arr.push(t);
    }
    return map;
  }, [schema]);

  return (
    <div className="qs-schema">
      <div className="qs-schema__head">📚 Схема</div>
      {schemaUrl && (
        <div className="qs-schema__origin">
          база по ссылке ·{' '}
          <a href={schemaUrl} target="_blank" rel="noreferrer noopener">схема</a>
        </div>
      )}
      {KIND_ORDER.map((kind) => {
        const items = groups.get(kind);
        if (!items || items.length === 0) return null;
        return (
          <details key={kind} open className="qs-schema__group">
            <summary>{KIND_LABEL[kind]}</summary>
            <ul className="qs-schema__list">
              {items.map((t) => (
                <TableItem key={t.name} table={t} onInsertText={onInsertText} onShowTable={onShowTable} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function TableItem({ table, onInsertText, onShowTable }: { table: Table; onInsertText: (t: string) => void; onShowTable: (ref: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = `${table.kind}.${table.name}`;
  const fields = fieldsOf(table);
  return (
    <li className="qs-schema__table">
      <div className="qs-schema__table-row">
        <button
          type="button"
          className="qs-schema__expand"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Свернуть' : 'Развернуть'}
        >
          {open ? '▾' : '▸'}
        </button>
        <button
          type="button"
          className="qs-schema__name"
          onClick={() => onInsertText(ref)}
          title={`Вставить: ${ref}`}
        >
          {table.name}
        </button>
        <button
          type="button"
          className="qs-schema__view"
          onClick={() => onShowTable(ref)}
          title="Показать содержимое таблицы (ВЫБРАТЬ * ИЗ …)"
          aria-label="Показать содержимое"
        >
          👁
        </button>
      </div>
      {open && (
        <ul className="qs-schema__fields">
          {fields.map((f) => (
            <li key={f.name} className="qs-schema__field">
              <button
                type="button"
                className="qs-schema__field-btn"
                onClick={() => onInsertText(f.name)}
                title={`Вставить: ${f.name}`}
              >
                {f.name}
              </button>
              <span className="qs-schema__field-type">{typeLabel(f)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function fieldsOf(table: Table): Field[] {
  switch (table.kind) {
    case 'Справочник':
    case 'Документ':
      return table.fields;
    case 'РегистрНакопления':
    case 'РегистрСведений':
      return [...table.dimensions, ...table.resources, ...(table.attributes ?? [])];
  }
}

function typeLabel(f: Field): string {
  const t = f.type;
  switch (t.kind) {
    case 'Строка': return t.length ? `Строка(${t.length})` : 'Строка';
    case 'Число': return t.digits ? `Число(${t.digits}${t.fraction ? ',' + t.fraction : ''})` : 'Число';
    case 'Ссылка': return `→ ${t.refs}`;
    default: return t.kind;
  }
}
