import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { SchemaPanel } from './SchemaPanel';
import { ResultTable } from './ResultTable';
import { loadEmbeddedFixture } from './embedded-fixture';
import { runQuery, type Rowset, type RunError } from '../query/interpreter';
import { HelpFooter } from '../help/HelpFooter';

type CodeEditor = Parameters<OnMount>[0];

const STARTER_QUERY = `ВЫБРАТЬ Наименование
ИЗ Справочник.Номенклатура
ГДЕ ПометкаУдаления = ЛОЖЬ
УПОРЯДОЧИТЬ ПО Наименование`;

export function App() {
  const fixture = useMemo(() => loadEmbeddedFixture(), []);
  const [source, setSource] = useState<string>(() => initialSource());
  const [rowset, setRowset] = useState<Rowset | null>(null);
  const [errors, setErrors] = useState<RunError[]>([]);
  const [running, setRunning] = useState(false);
  const editorRef = useRef<CodeEditor | null>(null);

  const handleRun = useCallback((): void => {
    setRunning(true);
    Promise.resolve().then(() => {
      const r = runQuery(source, fixture);
      if (r.ok) {
        setRowset(r.rowset);
        setErrors([]);
      } else {
        setRowset(null);
        setErrors(r.errors);
      }
      setRunning(false);
    });
  }, [source, fixture]);

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

  return (
    <div className="qs-app">
      <header className="qs-header">
        <div className="qs-header__brand">
          <span className="qs-header__logo">BSLexicon</span>
          <span className="qs-header__sub">песочница запросов</span>
        </div>
        <nav className="qs-header__nav">
          <a href={import.meta.env.BASE_URL} title="Тренажёр BSL">Тренажёр</a>
          <a href={`${import.meta.env.BASE_URL}notebook/`} title="Ноутбук">Ноутбук</a>
          <a href={`${import.meta.env.BASE_URL}help/`} title="Справочник">Справочник</a>
        </nav>
        <div className="qs-header__actions">
          <button type="button" className="qs-btn qs-btn--run" onClick={handleRun} disabled={running} title="Ctrl+Enter">
            ▶ Выполнить
          </button>
        </div>
      </header>

      <main className="qs-main">
        <aside className="qs-side">
          <SchemaPanel schema={fixture.schema} onInsertText={handleInsertText} />
        </aside>
        <section className="qs-work">
          <div className="qs-editor">
            <MonacoEditor
              height="100%"
              defaultLanguage="sql"
              theme="vs-dark"
              value={source}
              onChange={(next) => setSource(next ?? '')}
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
            <ResultTable rowset={rowset} errors={errors} />
          </div>
        </section>
      </main>

      <HelpFooter hint="Ctrl+Enter — выполнить · Клик по таблице/полю — вставить" />
    </div>
  );
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
