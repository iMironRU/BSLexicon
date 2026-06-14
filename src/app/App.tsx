import { useCallback, useMemo, useState } from 'react';
import { Editor } from './components/Editor';
import { OutputPanel } from './components/OutputPanel';
import { VariablesPanel } from './components/VariablesPanel';
import { run } from '@core/index';
import type { RunResult } from '@core/index';

const SAMPLE = `// Простой пример. Нажмите «Запустить».
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

export function App() {
  const [source, setSource] = useState<string>(SAMPLE);
  const [result, setResult] = useState<RunResult | null>(null);

  const handleRun = useCallback(() => {
    setResult(run(source));
  }, [source]);

  const variables = useMemo(
    () => (result?.ok ? result.variables : []),
    [result],
  );

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo">BSLexicon</span>
          <span className="app__tagline">тренажёр языка 1С (BSL)</span>
        </div>
        <button className="app__run" onClick={handleRun} type="button">
          ▶ Запустить
        </button>
      </header>

      <main className="app__body">
        <section className="app__editor">
          <Editor value={source} onChange={setSource} />
        </section>

        <aside className="app__panels">
          <OutputPanel result={result} />
          <VariablesPanel variables={variables} />
        </aside>
      </main>

      <footer className="app__footer">
        Скелет ядра · парсер → AST → генераторный интерпретатор · Фаза&nbsp;1
      </footer>
    </div>
  );
}
