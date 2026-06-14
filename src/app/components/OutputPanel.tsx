import type { RunResult } from '@core/index';

interface OutputPanelProps {
  result: RunResult | null;
}

export function OutputPanel({ result }: OutputPanelProps) {
  return (
    <div className="panel">
      <div className="panel__title">Вывод</div>
      <div className="panel__body panel__body--mono">
        {result === null && <span className="panel__hint">Нажмите «Запустить».</span>}

        {result?.ok &&
          result.output.map((line, i) => (
            <div key={i} className="output__line">
              {line}
            </div>
          ))}

        {result?.ok && result.output.length === 0 && (
          <span className="panel__hint">Код выполнен, вывода нет.</span>
        )}

        {result && !result.ok && (
          <div className="output__error">
            <strong>Ошибка ({result.error.stage}):</strong> {result.error.message}
            {result.error.line !== undefined && (
              <span className="output__pos"> — строка {result.error.line}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
