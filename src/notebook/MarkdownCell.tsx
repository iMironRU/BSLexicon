import { useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../app/markdown';

interface MarkdownCellProps {
  source: string;
  onChange: (next: string) => void;
  /** Просмотр решения / замороженная ячейка (#60): режим редактирования недоступен. */
  readOnly?: boolean;
}

/**
 * Markdown-ячейка: по умолчанию рендерится как preview, клик по превью
 * или кнопка «✎» переводят в режим редактирования (textarea).
 *
 * Выход из режима редактирования — по клику вне ячейки (blur) или Esc,
 * без явной кнопки «Сохранить» — источник и так синхронизируется на
 * каждом keystroke через onChange.
 */
export function MarkdownCell({ source, onChange, readOnly }: MarkdownCellProps) {
  const [editing, setEditing] = useState(false);
  const canEdit = !readOnly;
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
        {canEdit && (
          <button
            type="button"
            className="nb-cell__md-toggle"
            onClick={() => setEditing((v) => !v)}
            title={editing ? 'Готово (Esc)' : 'Редактировать'}
            aria-label={editing ? 'Готово' : 'Редактировать'}
          >
            {editing ? '✓' : '✎'}
          </button>
        )}
      </div>
      <div className="nb-cell__body">
        {editing && canEdit ? (
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
            className={'nb-cell__md-view' + (canEdit ? '' : ' nb-cell__md-view--frozen')}
            onClick={canEdit ? () => setEditing(true) : undefined}
            role={canEdit ? 'button' : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onKeyDown={canEdit ? (e) => { if (e.key === 'Enter') setEditing(true); } : undefined}
            title={canEdit ? 'Клик — редактировать' : undefined}
          >
            {source.trim() ? (
              renderMarkdown(source)
            ) : (
              <p className="nb-cell__md-empty">— пустая markdown-ячейка{canEdit ? ', кликни для редактирования' : ''} —</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
