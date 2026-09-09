/**
 * Панель параметров запроса (#53).
 *
 * Собирает все `&Имя` из текста, показывает по строке на каждый параметр:
 *   [ имя ] [ тип ] [ значение ]
 *
 * Значение хранится в родителе (App/Notebook cell) и передаётся в интерпретатор.
 * Тип выбирается пользователем — автоматически не выводим, чтобы не подставлять
 * заведомо неправильные значения (Строка ↔ Ссылка часто пересекаются).
 */
import { useEffect, useMemo } from 'react';
import type { Fixture } from '../query/fixture';
import type { Schema } from '../query/types';
import {
  extractParameterNames,
  NULL_PARAM,
  type QueryParamEntry,
  type QueryParamValue,
} from '../query/parameters';

interface ParametersPanelProps {
  source: string;
  entries: QueryParamEntry[];
  onChange: (next: QueryParamEntry[]) => void;
  fixture: Fixture;
}

const KIND_OPTIONS: QueryParamValue['kind'][] = ['Строка', 'Число', 'Дата', 'Булево', 'Ссылка', 'NULL'];

export function ParametersPanel({ source, entries, onChange, fixture }: ParametersPanelProps) {
  const detected = useMemo(() => extractParameterNames(source), [source]);

  // Синхронизируем список entries с обнаруженными в тексте параметрами:
  // добавляем новые с NULL, лишние держим (пусть автор может вернуться
  // к прежнему запросу без потери значений) — но не показываем.
  useEffect(() => {
    const known = new Set(entries.map((e) => e.name));
    const missing = detected.filter((n) => !known.has(n));
    if (missing.length === 0) return;
    const next = [...entries, ...missing.map((n) => ({ name: n, value: NULL_PARAM }))];
    onChange(next);
  }, [detected, entries, onChange]);

  const active = detected
    .map((name) => entries.find((e) => e.name === name) ?? { name, value: NULL_PARAM })
    .filter((e) => detected.includes(e.name));

  if (detected.length === 0) return null;

  const update = (name: string, value: QueryParamValue): void => {
    onChange(entries.map((e) => (e.name === name ? { ...e, value } : e)));
  };

  return (
    <div className="qs-params">
      <div className="qs-params__head">🔧 Параметры</div>
      <ul className="qs-params__list">
        {active.map((entry) => (
          <li key={entry.name} className="qs-params__row">
            <div className="qs-params__name">&amp;{entry.name}</div>
            <select
              className="qs-params__kind"
              value={entry.value.kind}
              onChange={(e) => update(entry.name, defaultOfKind(e.target.value as QueryParamValue['kind'], fixture.schema))}
            >
              {KIND_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <ValueEditor value={entry.value} onChange={(v) => update(entry.name, v)} schema={fixture.schema} fixture={fixture} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Редакторы значений ─────────────────────────────────────────────

function ValueEditor({ value, onChange, schema, fixture }: { value: QueryParamValue; onChange: (v: QueryParamValue) => void; schema: Schema; fixture: Fixture }) {
  switch (value.kind) {
    case 'NULL':
      return <span className="qs-params__null">— не задано —</span>;
    case 'Строка':
      return (
        <input
          type="text"
          className="qs-params__input"
          value={value.value}
          onChange={(e) => onChange({ kind: 'Строка', value: e.target.value })}
        />
      );
    case 'Число':
      return (
        <input
          type="number"
          step="any"
          className="qs-params__input qs-params__input--num"
          value={Number.isFinite(value.value) ? value.value : ''}
          onChange={(e) => onChange({ kind: 'Число', value: Number(e.target.value) })}
        />
      );
    case 'Дата':
      return (
        <input
          type="datetime-local"
          className="qs-params__input"
          value={value.value.slice(0, 16)}
          onChange={(e) => onChange({ kind: 'Дата', value: e.target.value ? `${e.target.value}:00` : '' })}
        />
      );
    case 'Булево':
      return (
        <select
          className="qs-params__kind"
          value={value.value ? '1' : '0'}
          onChange={(e) => onChange({ kind: 'Булево', value: e.target.value === '1' })}
        >
          <option value="1">Истина</option>
          <option value="0">Ложь</option>
        </select>
      );
    case 'Ссылка':
      return <RefEditor value={value} onChange={onChange} schema={schema} fixture={fixture} />;
  }
}

function RefEditor({
  value,
  onChange,
  schema,
  fixture,
}: {
  value: Extract<QueryParamValue, { kind: 'Ссылка' }>;
  onChange: (v: QueryParamValue) => void;
  schema: Schema;
  fixture: Fixture;
}) {
  const tables = schema.tables.filter((t) => t.kind === 'Справочник' || t.kind === 'Документ');
  const currentTable = fixture.tables.get(value.refs);
  const rows = currentTable?.rows ?? [];
  return (
    <div className="qs-params__ref">
      <select
        className="qs-params__kind"
        value={value.refs}
        onChange={(e) => onChange({ kind: 'Ссылка', refs: e.target.value, value: '' })}
      >
        <option value="">— таблица —</option>
        {tables.map((t) => <option key={`${t.kind}.${t.name}`} value={`${t.kind}.${t.name}`}>{t.kind}.{t.name}</option>)}
      </select>
      <select
        className="qs-params__kind"
        value={value.value}
        onChange={(e) => onChange({ kind: 'Ссылка', refs: value.refs, value: e.target.value })}
        disabled={!value.refs}
      >
        <option value="">— запись —</option>
        {rows.map((row, i) => {
          const id = (row['Ссылка'] as string) ?? '';
          const label = (row['Наименование'] as string) ?? (row['Номер'] as string) ?? id;
          return <option key={i} value={id}>{label}</option>;
        })}
      </select>
    </div>
  );
}

/** При смене типа даём разумное значение по умолчанию — минимум сюрпризов. */
function defaultOfKind(kind: QueryParamValue['kind'], schema: Schema): QueryParamValue {
  switch (kind) {
    case 'NULL': return { kind: 'NULL' };
    case 'Строка': return { kind: 'Строка', value: '' };
    case 'Число': return { kind: 'Число', value: 0 };
    case 'Булево': return { kind: 'Булево', value: false };
    case 'Дата': {
      const today = new Date();
      const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
      return { kind: 'Дата', value: iso };
    }
    case 'Ссылка': {
      const first = schema.tables.find((t) => t.kind === 'Справочник' || t.kind === 'Документ');
      return { kind: 'Ссылка', refs: first ? `${first.kind}.${first.name}` : '', value: '' };
    }
  }
}
