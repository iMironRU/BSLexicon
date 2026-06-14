import MonacoEditor from '@monaco-editor/react';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Обёртка над Monaco. Пока используем подсветку `vb` как близкую к BSL —
 * на следующем шаге подключим TextMate-грамматику 1c-syntax и провайдеры
 * автодополнения/hover/signature help из каталога языка.
 */
export function Editor({ value, onChange }: EditorProps) {
  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="vb"
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      options={{
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 4,
        renderWhitespace: 'selection',
        automaticLayout: true,
      }}
    />
  );
}
