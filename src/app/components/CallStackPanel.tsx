import type { DebugFrame } from '@core/index';

interface CallStackPanelProps {
  /** Кадры стека: индекс 0 — текущий, дальше — вызывающие. */
  frames: DebugFrame[];
  selected: number;
  onSelect: (index: number) => void;
}

/**
 * Панель «Стек вызовов». Клик по кадру выбирает его — панель «Переменные»
 * показывает область видимости именно этого кадра (живая визуализация
 * вложенных вызовов, концепт §6).
 */
export function CallStackPanel({ frames, selected, onSelect }: CallStackPanelProps) {
  return (
    <div className="panel">
      <div className="panel__title">Стек вызовов</div>
      <div className="panel__body">
        <ul className="stack">
          {frames.map((frame, i) => (
            <li key={i}>
              <button
                type="button"
                className={`stack__frame${i === selected ? ' stack__frame--active' : ''}`}
                onClick={() => onSelect(i)}
              >
                <span className="stack__name">{frame.name}</span>
                <span className="stack__line">строка {frame.line}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
