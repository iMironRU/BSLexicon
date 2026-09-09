/**
 * Задача-запрос (#43) — ячейка ноутбука с автопроверкой рowset'а.
 *
 * По духу — брат TaskCell: условие + редактор + «▶ Проверить» + результат.
 * Отличия:
 *   - язык sdbl вместо bsl;
 *   - runner — `runQueryTask` (сравнение rowset'а с эталоном);
 *   - результат — не список тестов, а diff: pass/fail + две мини-таблицы
 *     «твой ответ» vs «эталон» (при fail).
 */
import { useMemo, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { BeforeMount } from '@monaco-editor/react';
import { registerSdblLanguage, SDBL_LANGUAGE_ID, SDBL_THEME_ID } from '../query-app/monaco-lang';
import { registerSdblProviders } from '../query-app/monaco-providers';
import { renderMarkdown } from './markdown';
import { runQueryTask, type QueryTaskResult } from '../query/task-runner';
import type { QueryTaskSpec } from '../query/task-format';
import { parseSchemaYaml } from '../query/schema-loader';
import type { Schema } from '../query/types';
import type { BslValue } from '@core/index';

interface QueryTaskCellProps {
  source: string;
  onChange: (next: string) => void;
  task: QueryTaskSpec;
  ref?: string;
  showRefPlaceholder?: boolean;
  readOnly?: boolean;
  explanation?: string;
  onExplanationChange?: (next: string) => void;
}

export function QueryTaskCell({ source, onChange, task, ref, showRefPlaceholder, readOnly, explanation, onExplanationChange }: QueryTaskCellProps) {
  const [showExplanation, setShowExplanation] = useState<boolean>(!!(readOnly && explanation));
  const [result, setResult] = useState<QueryTaskResult | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedHints, setExpandedHints] = useState<Set<number>>(() => new Set());

  // Схема из спеки задачи — используется для автодополнений Monaco. Парсим один
  // раз при монтировании; ошибку игнорируем (runner всё равно её обнаружит и
  // покажет пользователю на «Проверить»).
  const schema = useMemo<Schema | null>(() => {
    const p = parseSchemaYaml(task.schema);
    return p.ok ? p.value : null;
  }, [task.schema]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerSdblLanguage(monaco);
    if (schema) registerSdblProviders(monaco, schema);
  };

  const handleCheck = (): void => {
    setRunning(true);
    Promise.resolve().then(() => {
      setResult(runQueryTask(source, task));
      setRunning(false);
    });
  };

  const handleReset = (): void => {
    if (!window.confirm('Сбросить решение к стартовому коду?')) return;
    onChange(task.starter);
    setResult(null);
  };

  // Placeholder «задача из репо» — если ref задан, но контекст ?nb-src= не подключён.
  if (ref && showRefPlaceholder) {
    return (
      <div className="nb-cell nb-cell--task nb-cell--task-ref">
        <div className="nb-cell__gutter">
          <div className="nb-cell__run-index" title="Задача из внешнего репо">🔗</div>
        </div>
        <div className="nb-cell__body">
          <div className="nb-task__statement">
            <div className="nb-task__badge">задача-запрос из репо</div>
            <p>
              Эта ячейка ссылается на файл <code>{ref}.query-task.yaml</code>. Открой урок по ссылке
              педагога с параметром <code>?nb-src=…</code>, чтобы подтянуть свежую спеку.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const lineCount = Math.max(3, Math.min(20, source.split('\n').length));
  const editorHeight = lineCount * 22 + 12;

  return (
    <div className="nb-cell nb-cell--task nb-cell--query-task">
      <div className="nb-cell__gutter">
        <button
          type="button"
          className="nb-cell__run"
          onClick={handleCheck}
          disabled={running}
          title="Проверить решение"
          aria-label="Проверить решение"
        >
          ▶
        </button>
        <div className="nb-cell__run-index" title="Изолированная задача-запрос">⊘</div>
      </div>
      <div className="nb-cell__body">
        <div className="nb-task__statement">
          {task.title && <div className="nb-task__badge">задача-запрос</div>}
          {renderMarkdown(task.statement)}
        </div>
        <div className="nb-cell__editor" style={{ height: editorHeight }}>
          <MonacoEditor
            height="100%"
            defaultLanguage={SDBL_LANGUAGE_ID}
            theme={SDBL_THEME_ID}
            value={source}
            onChange={(next) => onChange(next ?? '')}
            beforeMount={handleBeforeMount}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              tabSize: 4,
              lineNumbers: 'on',
              lineNumbersMinChars: 2,
              lineDecorationsWidth: 4,
              glyphMargin: false,
              folding: false,
              renderWhitespace: 'selection',
              automaticLayout: true,
              scrollbar: { alwaysConsumeMouseWheel: false },
              readOnly: !!readOnly,
            }}
          />
        </div>
        <div className="nb-task__actions">
          <button type="button" className="nb-btn nb-btn--check" onClick={handleCheck} disabled={running}>
            {running ? 'Проверка…' : '▶ Проверить'}
          </button>
          {!readOnly && (
            <button type="button" className="nb-btn nb-btn--ghost" onClick={handleReset} disabled={running}>
              Сбросить решение
            </button>
          )}
        </div>

        {result && <QueryTaskResultView result={result} spec={task} />}

        {task.hints && task.hints.length > 0 && (
          <div className="nb-task__hints">
            {task.hints.map((h, i) => {
              const shown = expandedHints.has(i);
              return (
                <div key={i} className="nb-task__hint">
                  <button
                    type="button"
                    className="nb-task__hint-toggle"
                    onClick={() => {
                      const next = new Set(expandedHints);
                      if (next.has(i)) next.delete(i); else next.add(i);
                      setExpandedHints(next);
                    }}
                  >
                    {shown ? '▾' : '▸'} Подсказка {i + 1}
                  </button>
                  {shown && <div className="nb-task__hint-body">{renderMarkdown(h)}</div>}
                </div>
              );
            })}
          </div>
        )}

        {(!readOnly || explanation) && (
          <div className="nb-task__explain">
            <button
              type="button"
              className="nb-task__hint-toggle"
              onClick={() => setShowExplanation((v) => !v)}
            >
              {showExplanation ? '▾' : '▸'} 💭 Объясни своё решение своими словами
            </button>
            {showExplanation && (
              <div className="nb-task__explain-body">
                {readOnly
                  ? explanation
                    ? renderMarkdown(explanation)
                    : <em>— пусто —</em>
                  : (
                    <textarea
                      value={explanation ?? ''}
                      onChange={(e) => onExplanationChange?.(e.target.value)}
                      placeholder="Почему ты решил именно так? В чём была ключевая идея?"
                      className="nb-task__explain-textarea"
                    />
                  )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Результат ──────────────────────────────────────────────────────

function QueryTaskResultView({ result, spec }: { result: QueryTaskResult; spec: QueryTaskSpec }) {
  if (result.status === 'error') {
    return (
      <div className="nb-task__results">
        <div className="nb-task__overall nb-task__overall--error">
          ✗ Ошибка
        </div>
        {result.specError && (
          <div className="nb-task__test-detail nb-task__test-detail--err">
            {result.specError}
          </div>
        )}
        {result.errors?.map((e, i) => (
          <div key={i} className="nb-task__test-detail nb-task__test-detail--err">
            <span className="qs-result__stage">[{e.stage}]</span>{' '}
            {e.line !== undefined && `строка ${e.line}: `}
            {e.message}
          </div>
        ))}
      </div>
    );
  }
  if (result.status === 'pass') {
    return (
      <div className="nb-task__results">
        <div className="nb-task__overall nb-task__overall--pass">
          ✓ Задача пройдена
        </div>
      </div>
    );
  }
  // fail
  return (
    <div className="nb-task__results">
      <div className="nb-task__overall nb-task__overall--fail">
        ✗ Не сходится
      </div>
      {result.diff?.reason && (
        <div className="nb-task__test-detail">{result.diff.reason}</div>
      )}
      <div className="nb-query-task__diff">
        <div className="nb-query-task__diff-side">
          <div className="nb-query-task__diff-label">Твой ответ</div>
          <MiniTable columns={result.diff?.columns.actual ?? []} rows={result.diff?.rows.actual ?? []} />
        </div>
        <div className="nb-query-task__diff-side">
          <div className="nb-query-task__diff-label">
            Эталон <span className="nb-query-task__diff-kind">({spec.expected.kind === 'ordered' ? 'по порядку' : 'без учёта порядка'})</span>
          </div>
          <MiniTable columns={result.diff?.columns.expected ?? []} rows={result.diff?.rows.expected ?? []} />
        </div>
      </div>
    </div>
  );
}

function MiniTable({ columns, rows }: { columns: string[]; rows: BslValue[][] }) {
  if (columns.length === 0 && rows.length === 0) {
    return <div className="nb-query-task__empty">— пусто —</div>;
  }
  return (
    <div className="nb-query-task__table-wrap">
      <table className="qs-table">
        <thead>
          <tr>
            {columns.map((c, i) => <th key={i}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((v, ci) => (
                <td key={ci} className={typeof v === 'number' ? 'qs-cell--num' : ''}>
                  {fmt(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v: BslValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Истина' : 'Ложь';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return v.toFixed(6).replace(/\.?0+$/, '');
    return String(v);
  }
  if (typeof v === 'string') return v;
  return String(v);
}
