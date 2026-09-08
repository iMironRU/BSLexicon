import { useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import type { Catalog } from '@core/index';
import { registerCatalogProviders } from '../app/monaco/providers';
import { BSL_LANGUAGE_ID, BSL_THEME, registerBslLanguage } from '../app/monaco/language';
import { runTask } from '../judge/runner';
import type { Task, TaskResult } from '../judge/types';
import { renderMarkdown } from './markdown';
import type { TaskSpec } from './types';

interface TaskCellProps {
  source: string;
  onChange: (next: string) => void;
  catalog: Catalog;
  task: TaskSpec;
  /**
   * `ref` из ячейки (сохраняется для сдачи решения #31). При `showRefPlaceholder`
   * = true рендерим сообщение «задача из репо», а spec игнорируем — это
   * ситуация «notebook открыт БЕЗ `?nb-src=`, spec из YAML не подтянут».
   */
  taskRef?: string;
  showRefPlaceholder?: boolean;
}

/**
 * Task-ячейка: условие задачи + Monaco с решением + «▶ Проверить»
 * + результаты тестов.
 *
 * Runtime — изолированный (`runTask` → `run()`), а не общий `Session`.
 * Иначе ученик мог бы «схитрить», объявив нужную переменную в соседней
 * ячейке ноутбука; UI подчёркивает это меткой «⊘ изолированная».
 *
 * Тесты и условие приходят из спеки автора (`task`), редактируется
 * только `source` — решение.
 */
export function TaskCell({ source, onChange, catalog, task, taskRef, showRefPlaceholder }: TaskCellProps) {
  // Placeholder показываем только если это ref-ячейка и spec ещё не
  // подтянут через `?nb-src=` (#30 резолвит spec и передаёт
  // showRefPlaceholder=false — рендерим обычную задачу).
  if (taskRef && showRefPlaceholder) {
    return (
      <div className="nb-cell nb-cell--task nb-cell--task-ref">
        <div className="nb-cell__gutter">
          <div className="nb-cell__run-index" title="Задача из внешнего репо">🔗</div>
        </div>
        <div className="nb-cell__body">
          <div className="nb-task__statement">
            <div className="nb-task__badge">задача из репо</div>
            <p>
              Эта ячейка ссылается на файл <code>{taskRef}</code> в репозитории педагога.
              Загрузка задач из репо появится в #30 — пока открывай ноутбук через
              ссылку с параметром <code>?nb-src=…</code>.
            </p>
          </div>
        </div>
      </div>
    );
  }
  const [result, setResult] = useState<TaskResult | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedHints, setExpandedHints] = useState<Set<number>>(() => new Set());

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerBslLanguage(monaco, catalog);
  };
  const handleMount: OnMount = (_editor, monaco) => {
    registerCatalogProviders(monaco, catalog);
  };

  const handleCheck = (): void => {
    setRunning(true);
    Promise.resolve().then(() => {
      // Собираем Task-объект из спеки: поля id/title/chapter нужны только для
      // книжной интеграции Judge — здесь ставим фиктивные, они на прогонку
      // не влияют. Идентичность runner'у безразлична.
      const t: Task = {
        id: 'notebook-inline',
        title: task.title ?? 'Задача',
        chapter: '',
        statement: task.statement,
        starter: task.starter,
        tests: task.tests,
        hints: task.hints,
      };
      setResult(runTask(t, source));
      setRunning(false);
    });
  };

  const handleReset = (): void => {
    if (source === task.starter) return;
    if (!window.confirm('Сбросить решение к стартовому коду?')) return;
    onChange(task.starter);
    setResult(null);
  };

  const lineCount = Math.max(3, Math.min(20, source.split('\n').length));
  const editorHeight = lineCount * 22 + 12;
  const passed = result?.overall === 'pass';
  const failed = result && result.overall !== 'pass';

  return (
    <div className={`nb-cell nb-cell--task${passed ? ' nb-cell--task-passed' : ''}${failed ? ' nb-cell--task-failed' : ''}`}>
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
        <div className="nb-cell__run-index" title={passed ? 'Все тесты пройдены' : failed ? 'Есть проваленные тесты' : 'Изолированная ячейка (свой runtime)'}>
          {passed ? '✓' : failed ? '✕' : '⊘'}
        </div>
      </div>
      <div className="nb-cell__body">
        <div className="nb-task__statement">
          {task.title && <div className="nb-task__badge">задача</div>}
          {renderMarkdown(task.statement)}
        </div>

        <div className="nb-cell__editor" style={{ height: editorHeight }}>
          <MonacoEditor
            height="100%"
            defaultLanguage={BSL_LANGUAGE_ID}
            theme={BSL_THEME}
            value={source}
            onChange={(next) => onChange(next ?? '')}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
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
            }}
          />
        </div>

        <div className="nb-task__actions">
          <button type="button" className="nb-btn nb-btn--check" onClick={handleCheck} disabled={running}>
            {running ? 'Проверка…' : '▶ Проверить'}
          </button>
          <button type="button" className="nb-btn nb-btn--ghost" onClick={handleReset}>
            Сбросить решение
          </button>
        </div>

        {result && (
          <div className="nb-task__results">
            <div className={`nb-task__overall nb-task__overall--${result.overall}`}>
              {result.overall === 'pass' && '✓ Все тесты пройдены'}
              {result.overall === 'fail' && '✕ Есть проваленные тесты'}
              {result.overall === 'error' && '⚠ Ошибка при прогонке'}
            </div>
            <ul className="nb-task__tests">
              {result.tests.map((tr, i) => (
                <li key={i} className={`nb-task__test nb-task__test--${tr.status}`}>
                  <span className="nb-task__test-mark">
                    {tr.status === 'pass' && '✓'}
                    {tr.status === 'fail' && '✕'}
                    {tr.status === 'error' && '⚠'}
                  </span>
                  <span className="nb-task__test-name">
                    {tr.hidden ? '(скрытый тест)' : (tr.name ?? `${tr.kind}-тест #${i + 1}`)}
                  </span>
                  {!tr.hidden && tr.status === 'fail' && (
                    <div className="nb-task__test-detail">
                      <div>Ожидалось: <code>{tr.expected}</code></div>
                      <div>Получено: <code>{tr.actual}</code></div>
                    </div>
                  )}
                  {!tr.hidden && tr.status === 'error' && (
                    <div className="nb-task__test-detail nb-task__test-detail--err">
                      {tr.error}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

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
                      setExpandedHints((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      });
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
      </div>
    </div>
  );
}
