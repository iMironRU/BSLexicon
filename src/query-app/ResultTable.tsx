/**
 * Таблица результата запроса. Простая HTML `<table>` — без пагинации
 * пока (учебные объёмы <10K строк, помещаются). Число ← правый край,
 * строка ← левый.
 *
 * Ссылки на объекты фикстуры отображаются как «Представление» (#48):
 *   - Справочник → Наименование
 *   - Документ  → №<Номер> от <Дата>
 * Тултип показывает сырой ключ. Тумблер «сырые ключи» отключает подмену.
 */
import { useState } from 'react';
import type { BslValue } from '@core/index';
import type { Rowset, RunError } from '../query/interpreter';
import type { Fixture } from '../query/fixture';
import { present } from './presentation';

interface ResultTableProps {
  rowset: Rowset | null;
  errors: RunError[];
  warnings?: string[];
  fixture: Fixture;
}

export function ResultTable({ rowset, errors, warnings = [], fixture }: ResultTableProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (errors.length > 0) {
    return (
      <div className="qs-result qs-result--error">
        <div className="qs-result__label">Ошибки:</div>
        <ul className="qs-result__errors">
          {errors.map((e, i) => (
            <li key={i}>
              <span className="qs-result__stage">[{e.stage}]</span>
              {e.line !== undefined && ` строка ${e.line}${e.column !== undefined ? ', колонка ' + (e.column + 1) : ''}:`}
              {' '}
              {e.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!rowset) {
    return <div className="qs-result qs-result--empty">Нажми ▶ Выполнить чтобы увидеть результат.</div>;
  }
  return (
    <div className="qs-result">
      {warnings.length > 0 && (
        <div className="qs-result__warnings">
          <div className="qs-result__label qs-result__label--warn">⚠ Предупреждения:</div>
          <ul>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <div className="qs-result__toolbar">
        <div className="qs-result__label">
          {rowset.rows.length} {plural(rowset.rows.length, 'строка', 'строки', 'строк')}
        </div>
        <label className="qs-result__toggle" title="Показывать внутренние ключи вместо представлений — только для отладки">
          <input
            type="checkbox"
            checked={showRaw}
            onChange={(e) => setShowRaw(e.target.checked)}
          />
          сырые ключи
        </label>
      </div>
      <div className="qs-result__scroll">
        <table className="qs-table">
          <thead>
            <tr>
              {rowset.columns.map((c, i) => <th key={i}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowset.rows.map((row, ri) => {
              const level = rowset.rowLevels?.[ri] ?? 0;
              return (
                <tr key={ri} className={level > 0 ? `qs-row--total qs-row--total-${Math.min(level, 3)}` : ''}>
                  {row.map((v, ci) => (
                    <Cell key={ci} value={v} fixture={fixture} showRaw={showRaw} level={ci === 0 ? level : 0} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ value, fixture, showRaw, level = 0 }: {
  value: BslValue;
  fixture: Fixture;
  showRaw: boolean;
  /** Уровень итога для первой колонки: 1 — самый внешний. */
  level?: number;
}) {
  const p = present(value, fixture);
  const isRef = p.raw !== null;
  const text = showRaw && isRef ? p.raw! : p.display;
  const numeric = typeof value === 'number';
  const classes = [
    numeric ? 'qs-cell--num' : '',
    isRef ? 'qs-cell--ref' : '',
  ].filter(Boolean).join(' ');
  const title = isRef ? `${p.targetRef ?? '?'} · ${p.raw}` : undefined;
  const style = level > 1 ? { paddingLeft: `${6 + (level - 1) * 12}px` } : undefined;
  // У общего итога значения контрольной точки нет — подписываем, чтобы
  // строка не выглядела пустой.
  const пусто = text === '' || text === 'NULL';
  return (
    <td className={classes} title={title} style={style}>
      {level === 1 && пусто ? <span className="qs-cell__total-mark">Итого</span> : text}
    </td>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
