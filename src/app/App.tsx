import { useCallback, useMemo, useRef, useState } from 'react';
import { Editor } from './components/Editor';
import { OutputPanel } from './components/OutputPanel';
import { VariablesPanel } from './components/VariablesPanel';
import { DebugSession, run } from '@core/index';
import type { DebugSnapshot, RunError, RunResult, VariableView } from '@core/index';

const SAMPLE = `// Простой пример. Нажмите «Запустить» или «Шаг».
Перем Итог;

Итог = 0;
Для Сч = 1 По 5 Цикл
    Итог = Итог + Сч;
КонецЦикла;

Сообщить("Сумма 1..5 = " + Итог);

Если Итог > 10 Тогда
    Сообщить("Больше десяти");
Иначе
    Сообщить("Не больше");
КонецЕсли;
`;

interface PanelView {
  output: string[] | null;
  error: RunError | null;
  variables: VariableView[];
  line: number | null;
}

const IDLE: PanelView = { output: null, error: null, variables: [], line: null };

export function App() {
  const [source, setSource] = useState<string>(SAMPLE);
  const [batch, setBatch] = useState<RunResult | null>(null);
  const [snap, setSnap] = useState<DebugSnapshot | null>(null);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const sessionRef = useRef<DebugSession | null>(null);

  /** Новая сессия из текущего кода с перенесёнными точками останова. */
  const ensureSession = useCallback((): DebugSession => {
    if (!sessionRef.current) {
      const session = new DebugSession(source);
      for (const line of breakpoints) session.toggleBreakpoint(line);
      sessionRef.current = session;
      setBatch(null);
    }
    return sessionRef.current;
  }, [source, breakpoints]);

  /** После шага: завершённую/ошибочную сессию сбрасываем — следующий «Шаг» начнёт заново. */
  const applyStep = useCallback((next: DebugSnapshot) => {
    setSnap(next);
    if (next.state === 'finished' || next.state === 'error') sessionRef.current = null;
  }, []);

  const handleRun = useCallback(() => {
    sessionRef.current = null;
    setSnap(null);
    setBatch(run(source));
  }, [source]);

  const handleStep = useCallback(() => {
    applyStep(ensureSession().stepOver());
  }, [ensureSession, applyStep]);

  const handleContinue = useCallback(() => {
    applyStep(ensureSession().continueRun());
  }, [ensureSession, applyStep]);

  const handleStop = useCallback(() => {
    sessionRef.current = null;
    setSnap(null);
  }, []);

  const handleSourceChange = useCallback((next: string) => {
    setSource(next);
    // Правка кода съезжает с номеров строк — гасим активную сессию (брейкпоинты храним).
    sessionRef.current = null;
    setSnap(null);
  }, []);

  const handleToggleBreakpoint = useCallback((line: number) => {
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
    sessionRef.current?.toggleBreakpoint(line);
  }, []);

  const view: PanelView = useMemo(() => {
    if (snap) {
      return {
        output: snap.output,
        error: snap.error,
        variables: snap.variables,
        line: snap.state === 'paused' ? snap.line : null,
      };
    }
    if (batch) {
      return {
        output: batch.output,
        error: batch.ok ? null : batch.error,
        variables: batch.ok ? batch.variables : [],
        line: null,
      };
    }
    return IDLE;
  }, [snap, batch]);

  const status = useMemo(() => describeStatus(snap), [snap]);

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo">BSLexicon</span>
          <span className="app__tagline">тренажёр языка 1С (BSL)</span>
        </div>
        <div className="app__controls">
          {status && <span className="app__status">{status}</span>}
          <div className="app__debug">
            <button className="app__step" onClick={handleStep} type="button" title="Шаг по оператору">
              ⏭ Шаг
            </button>
            <button className="app__step" onClick={handleContinue} type="button" title="Продолжить до точки останова">
              ▷ Продолжить
            </button>
            <button
              className="app__step"
              onClick={handleStop}
              type="button"
              title="Остановить отладку"
              disabled={snap === null}
            >
              ⏹ Стоп
            </button>
          </div>
          <button className="app__run" onClick={handleRun} type="button">
            ▶ Запустить
          </button>
        </div>
      </header>

      <main className="app__body">
        <section className="app__editor">
          <Editor
            value={source}
            onChange={handleSourceChange}
            breakpoints={breakpoints}
            onToggleBreakpoint={handleToggleBreakpoint}
            currentLine={view.line}
          />
        </section>

        <aside className="app__panels">
          <OutputPanel output={view.output} error={view.error} />
          <VariablesPanel variables={view.variables} />
        </aside>
      </main>

      <footer className="app__footer">
        Клик в левом поле — точка останова · «Шаг»/«Продолжить» — пошаговое исполнение · Фаза&nbsp;1
      </footer>
    </div>
  );
}

/** Человекочитаемый статус отладки для шапки. */
function describeStatus(snap: DebugSnapshot | null): string | null {
  if (!snap) return null;
  switch (snap.state) {
    case 'paused':
      return snap.line !== null ? `пауза · строка ${snap.line}` : 'пауза';
    case 'finished':
      return 'выполнено';
    case 'error':
      return 'ошибка';
    default:
      return null;
  }
}
