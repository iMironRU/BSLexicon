import { useEffect, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import type { Catalog, Session } from '@core/index';
import { registerCatalogProviders } from '../app/monaco/providers';
import { BSL_LANGUAGE_ID, BSL_THEME, registerBslLanguage } from '../app/monaco/language';
import type { CodeCellOutput } from './types';

type CodeEditor = Parameters<OnMount>[0];

interface CodeCellProps {
  source: string;
  onChange: (next: string) => void;
  catalog: Catalog;
  /** Общий persistent kernel всего ноутбука — переменные и процедуры живут. */
  session: Session;
  /** Инкрементируется при «Перезапустить kernel»: чистим локальный [N]. */
  sessionEpoch: number;
  /** Просмотр решения педагогом (#32): Monaco read-only. */
  readOnly?: boolean;
  /** Auto-run demo-ячейки (issue #70): выполнить при первом рендере. */
  autorun?: boolean;
}

/**
 * Одна code-ячейка ноутбука: Monaco-редактор + кнопка «▶ Запустить» + свой
 * output-блок под ним.
 *
 * MVP: каждый Run — независимый (kernel простого типа). Debugger/breakpoints
 * не подключены — они не имеют смысла без persistent kernel; появятся в #25.
 *
 * Высота редактора динамическая по числу строк (min 3 строки, max 20).
 * Пользователь не должен возиться с ресайзом внутри статьи-notebook'а.
 */
export function CodeCell({ source, onChange, catalog, session, sessionEpoch, readOnly, autorun }: CodeCellProps) {
  const [output, setOutput] = useState<CodeCellOutput | null>(null);
  const [runIndex, setRunIndex] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const editorRef = useRef<CodeEditor | null>(null);

  // Restart kernel — сбрасываем локальный индикатор прогона у каждой
  // ячейки; сам output оставляем видимым (как в Jupyter): пользователь
  // потерял живой kernel, но не летопись что было. Первое повторное ▶
  // возьмёт свежий [1].
  useEffect(() => {
    if (sessionEpoch > 0) setRunIndex(null);
  }, [sessionEpoch]);

  // Auto-run (issue #70): при первой отрисовке demo-ячейки сразу
  // выполняем. Ставим через 0 мс, чтобы Monaco успел смонтироваться.
  useEffect(() => {
    if (!autorun) return;
    const id = window.setTimeout(() => {
      const result = session.eval(source);
      const next: CodeCellOutput = result.error
        ? { lines: result.output, error: formatError(result.error) }
        : { lines: result.output, error: null };
      setOutput(next);
      setRunIndex(result.runIndex);
    }, 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEpoch, autorun]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerBslLanguage(monaco, catalog);
  };
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    registerCatalogProviders(monaco, catalog);
  };

  const handleRun = (): void => {
    setRunning(true);
    // Синхронный запуск, но флаг помогает если код длинный — Monaco успевает
    // обновить UI прежде чем интерпретатор заблокирует поток.
    Promise.resolve().then(() => {
      const result = session.eval(source);
      const next: CodeCellOutput = result.error
        ? { lines: result.output, error: formatError(result.error) }
        : { lines: result.output, error: null };
      setOutput(next);
      setRunIndex(result.runIndex);
      setRunning(false);
    });
  };

  const handleClearOutput = (): void => { setOutput(null); setRunIndex(null); };

  const lineCount = Math.max(3, Math.min(20, source.split('\n').length));
  const editorHeight = lineCount * 22 + 12; // ~22px на строку в Monaco 14pt

  return (
    <div className="nb-cell nb-cell--code">
      <div className="nb-cell__gutter">
        <button
          type="button"
          className="nb-cell__run"
          onClick={handleRun}
          disabled={running}
          title="Запустить ячейку"
          aria-label="Запустить ячейку"
        >
          ▶
        </button>
        <div className="nb-cell__run-index" title="Порядковый номер прогона kernel'а">
          {runIndex !== null ? `[${runIndex}]` : '[ ]'}
        </div>
      </div>
      <div className="nb-cell__body">
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
        {output && (
          <div className={`nb-cell__output${output.error ? ' nb-cell__output--error' : ''}`}>
            <div className="nb-cell__output-head">
              <span>вывод</span>
              <button
                type="button"
                className="nb-cell__output-clear"
                onClick={handleClearOutput}
                title="Скрыть вывод"
              >
                ×
              </button>
            </div>
            {output.lines.length > 0 && (
              <pre className="nb-cell__output-body">{output.lines.join('\n')}</pre>
            )}
            {output.error && (
              <pre className="nb-cell__output-body nb-cell__output-body--error">{output.error}</pre>
            )}
            {output.lines.length === 0 && !output.error && (
              <div className="nb-cell__output-empty">— пусто —</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Форматирует RunError в человекочитаемую однострочную/многострочную запись. */
function formatError(error: { stage: string; message: string; line?: number; column?: number }): string {
  const stage = ({ lexer: 'lex', parser: 'parse', runtime: 'runtime' } as Record<string, string>)[error.stage] ?? error.stage;
  const loc = error.line ? ` — строка ${error.line}` : '';
  return `Ошибка (${stage}): ${error.message}${loc}`;
}

