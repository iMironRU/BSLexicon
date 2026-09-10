/**
 * Редактор task-спеки в author-режиме (#27).
 *
 * Разворачивается details-блоком в TaskCell. Педагог правит условие,
 * стартовый код, тесты и подсказки — вся мутация идёт через onChange
 * с целой TaskSpec, чтобы код-вызывающий сохранил её в state.
 */
import { useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { BeforeMount } from '@monaco-editor/react';
import type { Catalog } from '@core/index';
import { BSL_LANGUAGE_ID, BSL_THEME, registerBslLanguage } from '../app/monaco/language';
import { renderMarkdown } from './markdown';
import type { TaskSpec } from './types';
import type { TaskTest } from '../judge/types';

interface TaskEditorProps {
  task: TaskSpec;
  onChange: (next: TaskSpec) => void;
  catalog: Catalog;
}

export function TaskEditor({ task, onChange, catalog }: TaskEditorProps) {
  const [preview, setPreview] = useState(false);
  const handleBeforeMount: BeforeMount = (monaco) => registerBslLanguage(monaco, catalog);

  const update = (patch: Partial<TaskSpec>): void => onChange({ ...task, ...patch });

  const setTest = (i: number, patch: Partial<TaskTest>): void => {
    const tests = task.tests.map((t, idx) => (idx === i ? { ...t, ...patch } : t) as TaskTest);
    update({ tests });
  };
  const addTest = (): void => update({ tests: [...task.tests, { kind: 'stdout', expect: '' }] });
  const removeTest = (i: number): void => {
    if (task.tests.length <= 1) return;
    update({ tests: task.tests.filter((_, idx) => idx !== i) });
  };

  const setHint = (i: number, value: string): void => update({
    hints: (task.hints ?? []).map((h, idx) => (idx === i ? value : h)),
  });
  const addHint = (): void => update({ hints: [...(task.hints ?? []), ''] });
  const removeHint = (i: number): void => update({
    hints: (task.hints ?? []).filter((_, idx) => idx !== i),
  });

  return (
    <details className="nb-task-editor">
      <summary className="nb-task-editor__summary">
        ✎ Редактировать задачу (педагог)
      </summary>
      <div className="nb-task-editor__body">
        <label className="nb-task-editor__field">
          <span className="nb-task-editor__label">Заголовок</span>
          <input
            type="text"
            className="nb-task-editor__input"
            value={task.title ?? ''}
            onChange={(e) => update({ title: e.target.value || undefined })}
            placeholder="Опционально — короткое название"
          />
        </label>

        <div className="nb-task-editor__field">
          <div className="nb-task-editor__label-row">
            <span className="nb-task-editor__label">Условие (Markdown)</span>
            <button
              type="button"
              className="nb-task-editor__toggle"
              onClick={() => setPreview((v) => !v)}
            >
              {preview ? 'Редактировать' : 'Предпросмотр'}
            </button>
          </div>
          {preview ? (
            <div className="nb-task-editor__preview">{renderMarkdown(task.statement)}</div>
          ) : (
            <textarea
              className="nb-task-editor__textarea"
              value={task.statement}
              onChange={(e) => update({ statement: e.target.value })}
              rows={6}
            />
          )}
        </div>

        <div className="nb-task-editor__field">
          <span className="nb-task-editor__label">Стартовый код</span>
          <div className="nb-task-editor__monaco">
            <MonacoEditor
              height="140px"
              defaultLanguage={BSL_LANGUAGE_ID}
              theme={BSL_THEME}
              value={task.starter}
              onChange={(v) => update({ starter: v ?? '' })}
              beforeMount={handleBeforeMount}
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'off',
                folding: false,
                glyphMargin: false,
                automaticLayout: true,
              }}
            />
          </div>
        </div>

        <div className="nb-task-editor__field">
          <div className="nb-task-editor__label-row">
            <span className="nb-task-editor__label">Тесты ({task.tests.length})</span>
            <button type="button" className="nb-task-editor__toggle" onClick={addTest}>+ Добавить</button>
          </div>
          <ul className="nb-task-editor__tests">
            {task.tests.map((t, i) => (
              <li key={i} className="nb-task-editor__test">
                <div className="nb-task-editor__test-head">
                  <select
                    className="nb-task-editor__select"
                    value={t.kind}
                    onChange={(e) => {
                      const kind = e.target.value as TaskTest['kind'];
                      if (kind === 'call') setTest(i, { kind, invoke: '', expect: t.expect } as TaskTest);
                      else setTest(i, { kind, expect: t.expect } as TaskTest);
                    }}
                  >
                    <option value="stdout">stdout</option>
                    <option value="call">call</option>
                  </select>
                  <label className="nb-task-editor__checkbox">
                    <input
                      type="checkbox"
                      checked={t.hidden === true}
                      onChange={(e) => setTest(i, { hidden: e.target.checked || undefined })}
                    />
                    скрытый
                  </label>
                  <button
                    type="button"
                    className="nb-task-editor__remove"
                    onClick={() => removeTest(i)}
                    disabled={task.tests.length <= 1}
                    title="Удалить тест"
                    aria-label="Удалить"
                  >
                    ✕
                  </button>
                </div>
                {t.kind === 'call' && (
                  <input
                    type="text"
                    className="nb-task-editor__input"
                    placeholder="вызов, например: MyFunc(1, 2)"
                    value={t.invoke}
                    onChange={(e) => setTest(i, { invoke: e.target.value })}
                  />
                )}
                <textarea
                  className="nb-task-editor__textarea nb-task-editor__textarea--sm"
                  placeholder="ожидаемое"
                  value={t.expect}
                  onChange={(e) => setTest(i, { expect: e.target.value })}
                  rows={2}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="nb-task-editor__field">
          <div className="nb-task-editor__label-row">
            <span className="nb-task-editor__label">Подсказки ({(task.hints ?? []).length})</span>
            <button type="button" className="nb-task-editor__toggle" onClick={addHint}>+ Добавить</button>
          </div>
          <ul className="nb-task-editor__hints">
            {(task.hints ?? []).map((h, i) => (
              <li key={i} className="nb-task-editor__hint">
                <textarea
                  className="nb-task-editor__textarea nb-task-editor__textarea--sm"
                  value={h}
                  onChange={(e) => setHint(i, e.target.value)}
                  rows={2}
                  placeholder="Подсказка (Markdown)"
                />
                <button
                  type="button"
                  className="nb-task-editor__remove"
                  onClick={() => removeHint(i)}
                  title="Удалить подсказку"
                  aria-label="Удалить"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
