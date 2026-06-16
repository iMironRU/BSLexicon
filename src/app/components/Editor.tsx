import { useEffect, useRef, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import type { Catalog } from '@core/index';
import { registerCatalogProviders } from '../monaco/providers';
import { BSL_LANGUAGE_ID, BSL_THEME, registerBslLanguage } from '../monaco/language';

type CodeEditor = Parameters<OnMount>[0];
type MonacoApi = Parameters<OnMount>[1];
type Decorations = ReturnType<CodeEditor['createDecorationsCollection']>;
type ModelDecoration = Parameters<Decorations['set']>[0][number];

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Каталог языка — источник автодополнения функций и методов. */
  catalog: Catalog;
  /** Номера строк с точками останова. */
  breakpoints: Set<number>;
  /** Тоггл точки останова кликом в глиф-марже. */
  onToggleBreakpoint: (line: number) => void;
  /** Строка, на которой стоит отладчик (подсветка), либо `null`. */
  currentLine: number | null;
}

/**
 * Обёртка над Monaco. Подсветка — собственная Monarch-грамматика BSL
 * (см. ../monaco/language), переиспользует таблицу ключевых слов и каталог.
 * Автодополнение, hover и signature help берутся из каталога (см. ../monaco/providers).
 *
 * Глиф-маржа кликабельна: клик по ней ставит/снимает точку останова.
 * Текущая строка отладки подсвечивается через коллекцию декораций.
 */
export function Editor({
  value,
  onChange,
  catalog,
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

  // До создания модели — регистрируем язык BSL, грамматику подсветки и тему.
  const handleBeforeMount: BeforeMount = (monaco) => {
    registerBslLanguage(monaco, catalog);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    registerCatalogProviders(monaco, catalog);
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
      defaultLanguage={BSL_LANGUAGE_ID}
      theme={BSL_THEME}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      beforeMount={handleBeforeMount}
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
