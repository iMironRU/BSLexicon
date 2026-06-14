import type { RunError } from '@core/index';

interface OutputPanelProps {
  /** Строки вывода `Сообщить`; `null` — ещё ничего не запускали. */
  output: string[] | null;
  error: RunError | null;
}

export function OutputPanel({ output, error }: OutputPanelProps) {
  const idle = output === null && error === null;

  return (
    <div className="panel">
      <div className="panel__title">Вывод</div>
      <div className="panel__body panel__body--mono">
        {idle && <span className="panel__hint">Нажмите «Запустить» или «Шаг».</span>}

        {output?.map((line, i) => (
          <div key={i} className="output__line">
            {line}
          </div>
        ))}

        {error && (
          <div className="output__error">
            <strong>Ошибка ({error.stage}):</strong> {error.message}
            {error.line !== undefined && (
              <span className="output__pos"> — строка {error.line}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
