import { useEffect, useState, type MutableRefObject } from 'react';
import { loadTarget, type Target } from '../../help/target';
import { loadAvailabilityIndex, type AvailabilityIndex } from './index';
import { scanForWarnings } from './scan';

type Editor = {
  getModel: () => unknown;
};
type MonacoApi = {
  editor: {
    setModelMarkers: (model: unknown, owner: string, markers: unknown[]) => void;
  };
  MarkerSeverity: { Warning: number; Error: number; Info: number; Hint: number };
  Range: new (l1: number, c1: number, l2: number, c2: number) => unknown;
};

const OWNER = 'bsl-availability';

/**
 * Проставляет Monaco-warnings по code + Target. Работает как только:
 *   1) editor готов (`editorRef.current` есть);
 *   2) индекс загрузился;
 *   3) Target прочитан из localStorage (пусто = null, тогда warnings нет).
 *
 * При смене Target в /help/ (storage event) — пересчёт триггерится
 * автоматически, вкладка с тренажёром получает свежие warnings без
 * перезагрузки.
 */
export function useAvailabilityMarkers(
  editorRef: MutableRefObject<Editor | null>,
  monacoRef: MutableRefObject<MonacoApi | null>,
  source: string,
  ready: boolean,
): void {
  const [index, setIndex] = useState<AvailabilityIndex | null>(null);
  const [target, setTarget] = useState<Target | null>(() => loadTarget());

  useEffect(() => {
    let alive = true;
    loadAvailabilityIndex().then((i) => alive && setIndex(i));
    return () => { alive = false; };
  }, []);

  // Синхронизация Target между вкладками (/help/ пишет в тот же ключ).
  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key === 'bslexicon:help:target') setTarget(loadTarget());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!ready || !index) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;

    // Без target (пользователь не ходил в /help/ настраивать) — пусто.
    if (!target) {
      monaco.editor.setModelMarkers(model, OWNER, []);
      return;
    }

    const warnings = scanForWarnings(source, target, index);
    const markers = warnings.map((w) => ({
      severity: monaco.MarkerSeverity.Warning,
      message: w.message,
      startLineNumber: w.line,
      startColumn: w.column ?? 1,
      endLineNumber: w.line,
      endColumn: w.column && w.length ? w.column + w.length : 999,
      source: 'bslexicon',
    }));
    monaco.editor.setModelMarkers(model, OWNER, markers);
  }, [ready, index, target, source, editorRef, monacoRef]);
}
