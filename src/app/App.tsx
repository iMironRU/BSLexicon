import { useCallback, useMemo, useRef, useState } from 'react';
import { Editor } from './components/Editor';
import { OutputPanel } from './components/OutputPanel';
import { VariablesPanel } from './components/VariablesPanel';
import { CallStackPanel } from './components/CallStackPanel';
import { ReferencePanel } from './components/ReferencePanel';
import { DebugSession, run } from '@core/index';
import type { DebugFrame, DebugSnapshot, RunError, RunResult, VariableView } from '@core/index';
import { loadCatalog } from './catalog';
import { EXAMPLES } from './examples';
import { useVersionCheck } from './useVersionCheck';

const REPO_URL = 'https://github.com/iMironRU/BSLexicon';
const AUTHOR_URL = 'https://github.com/iMironRU';

interface PanelView {
  output: string[] | null;
  error: RunError | null;
  variables: VariableView[];
  callStack: DebugFrame[];
  line: number | null;
}

const IDLE: PanelView = { output: null, error: null, variables: [], callStack: [], line: null };

export function App() {
  const [source, setSource] = useState<string>(EXAMPLES[0].code);
  const [activeExample, setActiveExample] = useState<string | null>(EXAMPLES[0].id);
  const [batch, setBatch] = useState<RunResult | null>(null);
  const [snap, setSnap] = useState<DebugSnapshot | null>(null);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [showReference, setShowReference] = useState(false);
  const sessionRef = useRef<DebugSession | null>(null);
  const catalog = useMemo(() => loadCatalog(), []);
  const updateAvailable = useVersionCheck();

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

  /** После шага: сбрасываем выбор кадра на текущий; завершённую сессию закрываем. */
  const applyStep = useCallback((next: DebugSnapshot) => {
    setSnap(next);
    setSelectedFrame(0);
    if (next.state === 'finished' || next.state === 'error') sessionRef.current = null;
  }, []);

  const reset = useCallback(() => {
    sessionRef.current = null;
    setSnap(null);
    setSelectedFrame(0);
  }, []);

  const handleRun = useCallback(() => {
    reset();
    setBatch(run(source));
  }, [reset, source]);

  const handleStepOver = useCallback(() => {
    applyStep(ensureSession().stepOver());
  }, [ensureSession, applyStep]);

  const handleStepInto = useCallback(() => {
    applyStep(ensureSession().stepInto());
  }, [ensureSession, applyStep]);

  const handleStepOut = useCallback(() => {
    applyStep(ensureSession().stepOut());
  }, [ensureSession, applyStep]);

  const handleContinue = useCallback(() => {
    applyStep(ensureSession().continueRun());
  }, [ensureSession, applyStep]);

  const handleSourceChange = useCallback(
    (next: string) => {
      setSource(next);
      setActiveExample(null); // правка вручную — больше не «чистый» пресет
      // Правка кода съезжает с номеров строк — гасим активную сессию (брейкпоинты храним).
      reset();
    },
    [reset],
  );

  /** Загрузить пример в редактор: заменяем код, сбрасываем отладку и точки останова. */
  const handleSelectExample = useCallback(
    (id: string, code: string) => {
      setSource(code);
      setActiveExample(id);
      setBreakpoints(new Set());
      setBatch(null);
      reset();
    },
    [reset],
  );

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
        callStack: snap.callStack,
        line: snap.state === 'paused' ? snap.line : null,
      };
    }
    if (batch) {
      return {
        output: batch.output,
        error: batch.ok ? null : batch.error,
        variables: batch.ok ? batch.variables : [],
        callStack: [],
        line: null,
      };
    }
    return IDLE;
  }, [snap, batch]);

  const status = useMemo(() => describeStatus(snap), [snap]);

  // Стек показываем только когда зашли в функцию (на уровне модуля он бесполезен).
  const showStack = view.callStack.length > 1;
  const shownVariables = view.callStack[selectedFrame]?.variables ?? view.variables;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo">BSLexicon</span>
          <span className="app__tagline">тренажёр языка 1С (BSL)</span>
          <a className="app__author" href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
            от iMironRU
          </a>
        </div>
        <div className="app__controls">
          {status && <span className="app__status">{status}</span>}
          <div className="app__debug">
            <button className="app__step" onClick={handleStepOver} type="button" title="Шаг через вызов (step over)">
              <span aria-hidden="true">⏭</span>
              <span className="btn-label">Шаг</span>
            </button>
            <button className="app__step" onClick={handleStepInto} type="button" title="Войти в функцию (step into)">
              <span aria-hidden="true">⤵</span>
              <span className="btn-label">Войти</span>
            </button>
            <button className="app__step" onClick={handleStepOut} type="button" title="Выйти из функции (step out)">
              <span aria-hidden="true">⤴</span>
              <span className="btn-label">Выйти</span>
            </button>
            <button className="app__step" onClick={handleContinue} type="button" title="Продолжить до точки останова">
              <span aria-hidden="true">▷</span>
              <span className="btn-label">Продолжить</span>
            </button>
            <button
              className="app__step"
              onClick={reset}
              type="button"
              title="Остановить отладку"
              disabled={snap === null}
            >
              <span aria-hidden="true">⏹</span>
              <span className="btn-label">Стоп</span>
            </button>
          </div>
          <button
            className={'app__step' + (showReference ? ' app__step--on' : '')}
            onClick={() => setShowReference((v) => !v)}
            type="button"
            title="Справочник по функциям и типам"
          >
            <span aria-hidden="true">📖</span>
            <span className="btn-label">Справочник</span>
          </button>
          <button className="app__run" onClick={handleRun} type="button" title="Запустить целиком">
            <span aria-hidden="true">▶</span>
            <span className="btn-label">Запустить</span>
          </button>
        </div>
      </header>

      <nav className="app__examples" aria-label="Примеры">
        <span className="app__examples-label">Примеры:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            className={'chip' + (activeExample === ex.id ? ' chip--active' : '')}
            onClick={() => handleSelectExample(ex.id, ex.code)}
            type="button"
          >
            {ex.title}
          </button>
        ))}
      </nav>

      <main className="app__body">
        <section className="app__editor">
          <Editor
            value={source}
            onChange={handleSourceChange}
            catalog={catalog}
            breakpoints={breakpoints}
            onToggleBreakpoint={handleToggleBreakpoint}
            currentLine={view.line}
          />
        </section>

        <aside className="app__panels">
          <OutputPanel output={view.output} error={view.error} />
          {showStack && (
            <CallStackPanel
              frames={view.callStack}
              selected={selectedFrame}
              onSelect={setSelectedFrame}
            />
          )}
          <VariablesPanel variables={shownVariables} />
        </aside>

        {showReference && (
          <ReferencePanel catalog={catalog} onClose={() => setShowReference(false)} />
        )}
      </main>

      <footer className="app__footer">
        <span className="app__footer-hint">
          Клик в левом поле — точка останова · Шаг / Войти / Выйти / Продолжить
        </span>
        <span className="app__footer-meta">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <span className="app__build" title={`Дата сборки: ${__BUILD_TIME__}`}>
            сборка {__BUILD_SHA__} · {__BUILD_TIME__}
          </span>
        </span>
      </footer>

      {updateAvailable && (
        <div className="update-banner" role="status">
          <span>Доступна новая версия тренажёра.</span>
          <button type="button" onClick={() => window.location.reload()}>
            Обновить
          </button>
        </div>
      )}
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
