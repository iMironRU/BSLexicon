/**
 * Таблица результата запроса. Простая HTML `<table>` — без пагинации
 * пока (учебные объёмы <10K строк, помещаются). Число ← правый край,
 * строка ← левый.
 */
import type { BslValue } from '@core/index';
import type { Rowset, RunError } from '../query/interpreter';
import { displayValue } from '@core/interpreter/values';

interface ResultTableProps {
  rowset: Rowset | null;
  errors: RunError[];
  warnings?: string[];
}

export function ResultTable({ rowset, errors, warnings = [] }: ResultTableProps) {
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
      <div className="qs-result__label">
        {rowset.rows.length} {plural(rowset.rows.length, 'строка', 'строки', 'строк')}
      </div>
      <div className="qs-result__scroll">
        <table className="qs-table">
          <thead>
            <tr>
              {rowset.columns.map((c, i) => <th key={i}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowset.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((v, ci) => (
                  <td key={ci} className={typeof v === 'number' ? 'qs-cell--num' : ''}>
                    {renderValue(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderValue(v: BslValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Истина' : 'Ложь';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return v.toFixed(6).replace(/\.?0+$/, '');
    return String(v);
  }
  return displayValue(v);
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
