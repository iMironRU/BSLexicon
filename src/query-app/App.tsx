import { useCallback, useEffect, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import { SchemaPanel } from './SchemaPanel';
import { ResultTable } from './ResultTable';
import { ExamplesModal } from './ExamplesModal';
import { ParametersPanel } from './ParametersPanel';
import { loadEmbeddedFixture } from './embedded-fixture';
import { loadRemoteFixture, readFixtureSource, type FixtureOrigin } from './remote-fixture';
import type { QueryParamEntry } from '../query/parameters';
import { toBslValue } from '../query/parameters';
import { registerSdblLanguage, SDBL_LANGUAGE_ID, SDBL_THEME_ID } from './monaco-lang';
import { registerSdblProviders } from './monaco-providers';
import { runQuery, type Rowset, type RunError } from '../query/interpreter';
import type { Fixture } from '../query/fixture';
import { HelpFooter } from '../help/HelpFooter';
import { PwaBanners } from '../app/components/PwaBanners';

type CodeEditor = Parameters<OnMount>[0];

/** Что сейчас с учебной базой: своя по ссылке грузится не мгновенно. */
type BaseState =
  | { status: 'готова'; fixture: Fixture; origin: FixtureOrigin; note?: string }
  | { status: 'грузится'; origin: { kind: 'по ссылке'; schemaUrl: string; dataUrl: string } }
  | { status: 'сломалась'; error: string; origin: FixtureOrigin };

const STARTER_QUERY = `ВЫБРАТЬ Наименование
ИЗ Справочник.Номенклатура
ГДЕ ПометкаУдаления = ЛОЖЬ
УПОРЯДОЧИТЬ ПО Наименование`;

export function App() {
  const [base, setBase] = useState<BaseState>(() => initialBase());
  const [source, setSource] = useState<string>(() => initialSource());
  const [rowset, setRowset] = useState<Rowset | null>(null);
  const [errors, setErrors] = useState<RunError[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [params, setParams] = useState<QueryParamEntry[]>([]);
  const editorRef = useRef<CodeEditor | null>(null);

  const fixture = base.status === 'готова' ? base.fixture : null;

  // База по ссылке (#55): грузим после первого рендера, чтобы читатель
  // видел, что происходит, а не пустой экран.
  useEffect(() => {
    if (base.status !== 'грузится') return;
    let живо = true;
    loadRemoteFixture(base.origin.schemaUrl, base.origin.dataUrl, {
      fetchImpl: (url) => fetch(url),
      store: safeSessionStorage(),
    }).then((r) => {
      if (!живо) return;
      if (r.ok) setBase({ status: 'готова', fixture: r.fixture, origin: r.origin });
      else setBase({ status: 'сломалась', error: r.error, origin: base.origin });
    });
    return () => { живо = false; };
  }, [base]);

  const handleRun = useCallback((): void => {
    if (!fixture) return;
    setRunning(true);
    Promise.resolve().then(() => {
      const paramMap: { [name: string]: import('@core/index').BslValue } = {};
      for (const p of params) paramMap[p.name] = toBslValue(p.value);
      const r = runQuery(source, fixture, { parameters: paramMap });
      if (r.ok) {
        setRowset(r.rowset);
        setErrors([]);
        setWarnings(r.warnings);
      } else {
        setRowset(null);
        setErrors(r.errors);
        setWarnings([]);
      }
      setRunning(false);
    });
  }, [source, fixture, params]);

  // Ctrl+Enter / Cmd+Enter — выполнить.
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRun();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [handleRun]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerSdblLanguage(monaco);
    if (fixture) registerSdblProviders(monaco, fixture.schema);
  };

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const handleInsertText = useCallback((text: string): void => {
    const editor = editorRef.current;
    if (!editor) {
      // Fallback — просто в конец
      setSource((s) => s + text);
      return;
    }
    const sel = editor.getSelection();
    if (!sel) return;
    editor.executeEdits('schema-insert', [
      { range: sel, text, forceMoveMarkers: true },
    ]);
    editor.focus();
  }, []);

  const handleShowTable = useCallback((ref: string): void => {
    if (!fixture) return;
    // Заменяем содержимое редактора на «ВЫБРАТЬ * ИЗ Kind.Name»
    // и сразу выполняем — так пользователь мгновенно видит таблицу.
    const next = `ВЫБРАТЬ *\nИЗ ${ref}`;
    setSource(next);
    Promise.resolve().then(() => {
      const r = runQuery(next, fixture);
      if (r.ok) {
        setRowset(r.rowset);
        setErrors([]);
        setWarnings(r.warnings);
      } else {
        setRowset(null);
        setErrors(r.errors);
        setWarnings([]);
      }
    });
  }, [fixture]);

  const handlePickExample = useCallback((next: string): void => {
    setSource(next);
  }, []);

  return (
    <div className="qs-app">
      <header className="qs-header">
        <div className="qs-header__brand">
          <span className="qs-header__logo">BSLexicon</span>
          <span className="qs-header__sub">песочница запросов</span>
        </div>
        <nav className="qs-header__nav">
          <a href={import.meta.env.BASE_URL} title="К режимам">↑ Режимы</a>
          <a href={`${import.meta.env.BASE_URL}trainer/`} title="Тренажёр BSL">Тренажёр</a>
          <a href={`${import.meta.env.BASE_URL}notebook/`} title="Ноутбук">Ноутбук</a>
          <a href={`${import.meta.env.BASE_URL}help/`} title="Справочник">Справочник</a>
        </nav>
        <div className="qs-header__actions">
          <button
            type="button"
            className="qs-btn qs-btn--secondary"
            onClick={() => setExamplesOpen(true)}
            title="Галерея демо-запросов"
          >
            📖 Примеры
          </button>
          <button type="button" className="qs-btn qs-btn--run" onClick={handleRun} disabled={running} title="Ctrl+Enter">
            ▶ Выполнить
          </button>
        </div>
      </header>

      {base.status === 'сломалась' && (
        <div className="qs-base-banner qs-base-banner--error" role="alert">
          <span>⚠ {base.error}</span>
          <button type="button" className="qs-btn qs-btn--secondary" onClick={() => setBase(embeddedBase())}>
            Открыть встроенную базу
          </button>
        </div>
      )}
      {base.status === 'готова' && base.note && (
        <div className="qs-base-banner" role="status">⚠ {base.note}</div>
      )}
      {base.status === 'готова' && base.origin.kind === 'по ссылке' && (
        <div className="qs-base-banner" role="status">
          🗄 База по ссылке:{' '}
          <a href={base.origin.schemaUrl} target="_blank" rel="noreferrer noopener">{shortUrl(base.origin.schemaUrl)}</a>
        </div>
      )}

      {base.status === 'грузится' && (
        <div className="qs-base-banner" role="status">🗄 Загружаю учебную базу по ссылке…</div>
      )}

      {fixture && (
      <main className="qs-main">
        <aside className="qs-side">
          <SchemaPanel
            schema={fixture.schema}
            schemaUrl={base.status === 'готова' && base.origin.kind === 'по ссылке' ? base.origin.schemaUrl : undefined}
            onInsertText={handleInsertText}
            onShowTable={handleShowTable}
          />
        </aside>
        <section className="qs-work">
          <div className="qs-editor">
            <MonacoEditor
              height="100%"
              defaultLanguage={SDBL_LANGUAGE_ID}
              theme={SDBL_THEME_ID}
              value={source}
              onChange={(next) => setSource(next ?? '')}
              beforeMount={handleBeforeMount}
              onMount={handleMount}
              options={{
                fontSize: 14,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                tabSize: 4,
                lineNumbers: 'on',
                automaticLayout: true,
                renderWhitespace: 'selection',
              }}
            />
          </div>
          <div className="qs-result-pane">
            <ParametersPanel
              source={source}
              entries={params}
              onChange={setParams}
              fixture={fixture}
            />
            <ResultTable rowset={rowset} errors={errors} warnings={warnings} fixture={fixture} />
          </div>
        </section>
      </main>

      )}

      <HelpFooter hint="Ctrl+Enter — выполнить · Клик по таблице/полю — вставить · 👁 — показать содержимое" />
      <PwaBanners />
      {examplesOpen && (
        <ExamplesModal onPick={handlePickExample} onClose={() => setExamplesOpen(false)} />
      )}
    </div>
  );
}

/** Встроенная мини-ERP — состояние по умолчанию. */
function embeddedBase(): Extract<BaseState, { status: 'готова' }> {
  return { status: 'готова', fixture: loadEmbeddedFixture(), origin: { kind: 'встроенная' } };
}

/**
 * Что открыть на старте: свою базу по ссылке или встроенную. Если ссылки
 * заданы наполовину или не по http — говорим об этом вслух и открываем
 * встроенную, а не молчим.
 */
function initialBase(): BaseState {
  const { origin, error } = readFixtureSource(window.location.search);
  if (origin.kind === 'по ссылке') return { status: 'грузится', origin };
  const base = embeddedBase();
  return error ? { ...base, note: error } : base;
}

function safeSessionStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } | undefined {
  try {
    const s = window.sessionStorage;
    s.getItem('qs-probe');
    return s;
  } catch {
    return undefined; // приватное окно или запрет хранилища — обойдёмся без кэша
  }
}

/** Для баннера: домен и имя файла, середину пути опускаем. */
function shortUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const name = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return `${u.host}/…/${name}`;
  } catch {
    return raw;
  }
}

function initialSource(): string {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (q) {
    try {
      return decodeBase64(q);
    } catch {
      /* игнорируем битый параметр */
    }
  }
  return STARTER_QUERY;
}

function decodeBase64(raw: string): string {
  const std = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
