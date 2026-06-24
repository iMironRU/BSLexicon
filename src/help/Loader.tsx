import { useEffect, useState } from 'react';

interface LoaderProps {
  /** Заголовок — что грузим. Короткая фраза. */
  title?: string;
  /**
   * Прогресс 0..1 или null, если неизвестен (рисуем индетерминированную полоску).
   * undefined = ещё ничего не пришло — тоже индетерминированный.
   */
  progress?: number | null;
  /**
   * Задержка перед появлением (мс): на быстром канале лоадер не успеет
   * мигнуть. По умолчанию 200 мс.
   */
  delayMs?: number;
  /** Подсказка под заголовком (мелким). */
  hint?: string;
}

/**
 * Общий лоадер для страниц справочника:
 *   • первые `delayMs` миллисекунд скрыт (избегаем мигания на быстром канале);
 *   • при появлении плавный fade-in (200 мс);
 *   • прогресс-бар — определённый (если известен Content-Length) или
 *     индетерминированный (бегущая полоска).
 *
 * Сам компонент НЕ управляет fade-out родительского контейнера — это
 * сделает родитель, размонтировав Loader, когда данные приехали.
 */
export function Loader({ title = 'Загружаю…', progress, delayMs = 200, hint }: LoaderProps) {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) return undefined;
    const id = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs]);

  if (!visible) return null;

  const pct = typeof progress === 'number' ? Math.max(0, Math.min(1, progress)) : null;

  return (
    <div className="loader" role="status" aria-live="polite">
      <div className="loader__inner">
        <div className="loader__spinner" aria-hidden="true" />
        <div className="loader__title">{title}</div>
        {hint && <div className="loader__hint">{hint}</div>}
        <div
          className={'loader__bar' + (pct === null ? ' loader__bar--indeterminate' : '')}
          aria-hidden="true"
        >
          {pct !== null && (
            <div className="loader__bar-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
          )}
        </div>
        {pct !== null && (
          <div className="loader__pct" aria-hidden="true">{Math.round(pct * 100)}%</div>
        )}
      </div>
    </div>
  );
}
