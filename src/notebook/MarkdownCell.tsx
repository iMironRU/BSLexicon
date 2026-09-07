import { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from './markdown';

interface MarkdownCellProps {
  source: string;
  onChange: (next: string) => void;
}

/**
 * Markdown-ячейка: по умолчанию рендерится как preview, клик по превью
 * или кнопка «✎» переводят в режим редактирования (textarea).
 *
 * Выход из режима редактирования — по клику вне ячейки (blur) или Esc,
 * без явной кнопки «Сохранить» — источник и так синхронизируется на
 * каждом keystroke через onChange.
 */
export function MarkdownCell({ source, onChange }: MarkdownCellProps) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        // Автоподгонка высоты под контент.
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }
    }
  }, [editing]);

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget;
    onChange(el.value);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
    }
  };

  return (
    <div className="nb-cell nb-cell--md">
      <div className="nb-cell__gutter">
        <button
          type="button"
          className="nb-cell__md-toggle"
          onClick={() => setEditing((v) => !v)}
          title={editing ? 'Готово (Esc)' : 'Редактировать'}
          aria-label={editing ? 'Готово' : 'Редактировать'}
        >
          {editing ? '✓' : '✎'}
        </button>
      </div>
      <div className="nb-cell__body">
        {editing ? (
          <textarea
            ref={textareaRef}
            className="nb-cell__md-input"
            defaultValue={source}
            onInput={handleTextareaInput}
            onBlur={() => setEditing(false)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
          />
        ) : (
          <div
            className="nb-cell__md-view"
            onClick={() => setEditing(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true); }}
            title="Клик — редактировать"
          >
            {source.trim() ? (
              renderMarkdown(source)
            ) : (
              <p className="nb-cell__md-empty">— пустая markdown-ячейка, кликни для редактирования —</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
