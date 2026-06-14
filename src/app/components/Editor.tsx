import { useEffect, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';

type CodeEditor = Parameters<OnMount>[0];
type MonacoApi = Parameters<OnMount>[1];
type Decorations = ReturnType<CodeEditor['createDecorationsCollection']>;
type ModelDecoration = Parameters<Decorations['set']>[0][number];

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Номера строк с точками останова. */
  breakpoints: Set<number>;
  /** Тоггл точки останова кликом в глиф-марже. */
  onToggleBreakpoint: (line: number) => void;
  /** Строка, на которой стоит отладчик (подсветка), либо `null`. */
  currentLine: number | null;
}

/**
 * Обёртка над Monaco. Пока используем подсветку `vb` как близкую к BSL —
 * на следующем шаге подключим TextMate-грамматику 1c-syntax и провайдеры
 * автодополнения/hover/signature help из каталога языка.
 *
 * Глиф-маржа кликабельна: клик по ней ставит/снимает точку останова.
 * Текущая строка отладки подсвечивается через коллекцию декораций.
 */
export function Editor({
  value,
  onChange,
  breakpoints,
  onToggleBreakpoint,
  currentLine,
}: EditorProps) {
  const editorRef = useRef<CodeEditor | null>(null);
  const monacoRef = useRef<MonacoApi | null>(null);
  const decorationsRef = useRef<Decorations | null>(null);
  const [ready, setReady] = useState(false);

  // Колбэк тоггла читаем через ref: слушатель мыши регистрируем один раз.
  const toggleRef = useRef(onToggleBreakpoint);
  toggleRef.current = onToggleBreakpoint;

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorationsRef.current = editor.createDecorationsCollection();
    editor.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const line = e.target.position?.lineNumber;
        if (line) toggleRef.current(line);
      }
    });
    setReady(true);
  };

  // Пересобираем декорации при смене точек останова или текущей строки.
  useEffect(() => {
    const monaco = monacoRef.current;
    const decorations = decorationsRef.current;
    if (!ready || !monaco || !decorations) return;

    const next: ModelDecoration[] = [...breakpoints].map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { glyphMarginClassName: 'bp-glyph' },
    }));

    if (currentLine !== null) {
      next.push({
        range: new monaco.Range(currentLine, 1, currentLine, 1),
        options: {
          isWholeLine: true,
          className: 'debug-line',
          glyphMarginClassName: 'debug-glyph',
        },
      });
    }

    decorations.set(next);
  }, [ready, breakpoints, currentLine]);

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="vb"
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={handleMount}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 4,
        renderWhitespace: 'selection',
        automaticLayout: true,
        glyphMargin: true,
      }}
    />
  );
}
