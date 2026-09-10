import { useEffect, useMemo, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import type { Catalog } from '@core/index';
import { registerCatalogProviders } from '../app/monaco/providers';
import { BSL_LANGUAGE_ID, BSL_THEME, registerBslLanguage } from '../app/monaco/language';
import { runTask } from '../judge/runner';
import type { Task, TaskResult } from '../judge/types';
import { renderMarkdown } from './markdown';
import { TaskEditor } from './TaskEditor';
import { parseEditableRegions, isSelectionEditable } from './blanks';
import type { TaskSpec } from './types';

type CodeEditor = Parameters<OnMount>[0];

/** Прожатие клавиши, приводящее к правке текста. */
function isEditingKey(e: KeyboardEvent): boolean {
  // Стрелки / Home / End / PageUp/Down / Escape / модификаторы / F-клавиши — навигация, не правка.
  const NAV = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'PageUp', 'PageDown',
    'Escape', 'Shift', 'Control', 'Alt', 'Meta',
    'CapsLock', 'Tab', // Tab часто нужен для навигации между полями
  ]);
  if (NAV.has(e.key)) return false;
  // Копирование (Ctrl+C/Cmd+C) — не правка. Undo/Redo (Ctrl+Z/Y) — тоже разрешаем
  // (даст возможность откатить если ошибся в editable-области).
  if ((e.ctrlKey || e.metaKey) && ['c', 'C', 'z', 'Z', 'y', 'Y'].includes(e.key)) return false;
  // Всё остальное считаем потенциально изменяющим: печать, Backspace, Delete,
  // Enter, вставка (Ctrl+V) и т.д.
  return true;
}

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
  /**
   * Просмотр решения педагогом (#32): Monaco в read-only, редактирование
   * запрещено. Проверка тестов остаётся — педагог сам может её прогнать
   * против snapshot.
   */
  readOnly?: boolean;
  /** Объяснение ученика своими словами (#33). */
  explanation?: string;
  onExplanationChange?: (next: string) => void;
  /**
   * Author-режим (#27): показываем форму TaskEditor и обновляем task-spec.
   * Без коллбэка форма не показывается — call-site может отключить
   * редактирование (например, ref-cell с подтянутым yaml иммутабелен для
   * автора локального notebook'а).
   */
  onTaskChange?: (next: TaskSpec) => void;
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
export function TaskCell({ source, onChange, catalog, task, taskRef, showRefPlaceholder, readOnly, explanation, onExplanationChange, onTaskChange }: TaskCellProps) {
  // Все хуки объявляем ДО ранних return — правило React rules-of-hooks.
  const [showExplanation, setShowExplanation] = useState<boolean>(
    // В readOnly — раскрываем автоматически если есть текст (педагог сразу видит).
    // В обычном режиме — свернуто по умолчанию, ученик сам решает раскрыть.
    !!(readOnly && explanation),
  );
  const [result, setResult] = useState<TaskResult | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedHints, setExpandedHints] = useState<Set<number>>(() => new Set());
  const [editorReady, setEditorReady] = useState(false);
  const editorRef = useRef<CodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);

  // Регионы редактирования из fill-in-the-blank маркеров (#34).
  // Пересчитываем каждый рендер (source меняется — маркеры двигаются).
  const editableRegions = useMemo(() => parseEditableRegions(source), [source]);
  const regionsRef = useRef(editableRegions);
  regionsRef.current = editableRegions;

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

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerBslLanguage(monaco, catalog);
  };
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    registerCatalogProviders(monaco, catalog);
    // Fill-in-the-blank: блокируем правки вне editable-регионов через
    // перехват keydown. Правки через paste/undo дополнительно откатываются
    // через onDidChangeModelContent (недорогой safeguard).
    editor.onKeyDown((e) => {
      const regs = regionsRef.current;
      if (regs.length === 0) return; // задача без blanks — не мешаем
      const sel = editor.getSelection();
      if (!sel) return;
      if (isSelectionEditable(sel.startLineNumber, sel.endLineNumber, regs)) return;
      if (isEditingKey(e.browserEvent)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    setEditorReady(true);
  };

  // Fill-in-the-blank: подсвечиваем нередактируемые строки декорациями
  // (немного темнее фон + полоска слева). Пересобираем при смене регионов
  // или source.
  useEffect(() => {
    if (!editorReady) return;
    const ed = editorRef.current;
    if (!ed) return;
    if (editableRegions.length === 0) {
      // регионов нет → нет декораций
      if (decorationsRef.current.length > 0) {
        decorationsRef.current = ed.deltaDecorations(decorationsRef.current, []);
      }
      return;
    }
    const model = ed.getModel();
    if (!model) return;
    const total = model.getLineCount();
    const editableSet = new Set<number>();
    for (const r of editableRegions) {
      for (let l = r.startLine; l <= r.endLine; l += 1) editableSet.add(l);
    }
    const decor = [];
    for (let l = 1; l <= total; l += 1) {
      if (editableSet.has(l)) continue;
      decor.push({
        range: { startLineNumber: l, startColumn: 1, endLineNumber: l, endColumn: 1 },
        options: { isWholeLine: true, className: 'nb-blank-readonly' },
      });
    }
    decorationsRef.current = ed.deltaDecorations(decorationsRef.current, decor as never[]);
  }, [editableRegions, source, editorReady]);

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
              readOnly: !!readOnly,
            }}
          />
        </div>

        <div className="nb-task__actions">
          <button type="button" className="nb-btn nb-btn--check" onClick={handleCheck} disabled={running}>
            {running ? 'Проверка…' : readOnly ? '▶ Прогнать против snapshot' : '▶ Проверить'}
          </button>
          {!readOnly && (
            <button type="button" className="nb-btn nb-btn--ghost" onClick={handleReset}>
              Сбросить решение
            </button>
          )}
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

        {/* Author-режим (#27): форма редактирования task-спеки. */}
        {onTaskChange && (
          <TaskEditor task={task} onChange={onTaskChange} catalog={catalog} />
        )}

        {/* Feynman-объяснение (#33). В readOnly-режиме рендерим как markdown,
            если объяснение задано; в обычном — свернутая textarea. */}
        {(!readOnly || explanation) && (
          <div className="nb-task__explain">
            <button
              type="button"
              className="nb-task__hint-toggle"
              onClick={() => setShowExplanation((v) => !v)}
            >
              {showExplanation ? '▾' : '▸'} ✍ {readOnly ? 'Объяснение ученика' : 'Объясни своё решение своими словами'}
            </button>
            {showExplanation && (
              <div className="nb-task__explain-body">
                {readOnly ? (
                  explanation
                    ? renderMarkdown(explanation)
                    : <p className="nb-task__explain-empty">— ученик ничего не написал —</p>
                ) : (
                  <textarea
                    className="nb-cell__md-input"
                    value={explanation ?? ''}
                    onChange={(e) => onExplanationChange?.(e.target.value)}
                    placeholder="Почему ты решил именно так? Что было ключевой идеей?"
                    rows={4}
                    spellCheck={false}
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
