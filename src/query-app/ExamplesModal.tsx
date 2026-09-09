/**
 * Модалка с галереей демо-запросов. Клик по примеру заменяет
 * текст в редакторе и закрывает окно.
 */
import { useEffect } from 'react';
import { EXAMPLES } from './examples';

interface ExamplesModalProps {
  onPick: (source: string) => void;
  onClose: () => void;
}

export function ExamplesModal({ onPick, onClose }: ExamplesModalProps) {
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  return (
    <div
      className="qs-modal__backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Галерея примеров"
    >
      <div className="qs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="qs-modal__head">
          <span className="qs-modal__title">📖 Примеры запросов</span>
          <button
            type="button"
            className="qs-modal__close"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть (Esc)"
          >
            ×
          </button>
        </div>
        <div className="qs-modal__body">
          {EXAMPLES.map((cat) => (
            <section key={cat.title} className="qs-examples__group">
              <h3 className="qs-examples__group-title">{cat.title}</h3>
              <ul className="qs-examples__list">
                {cat.items.map((ex) => (
                  <li key={ex.title} className="qs-examples__item">
                    <button
                      type="button"
                      className="qs-examples__btn"
                      onClick={() => {
                        onPick(ex.source);
                        onClose();
                      }}
                    >
                      <div className="qs-examples__item-title">{ex.title}</div>
                      <div className="qs-examples__item-hint">{ex.hint}</div>
                      <pre className="qs-examples__code">{ex.source}</pre>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
