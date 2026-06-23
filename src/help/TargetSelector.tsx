import { useEffect, useRef, useState } from 'react';
import { ALL_CONTEXTS, CONTEXT_LABELS } from './target';
import type { ContextKey, Target } from './target';

interface TargetSelectorProps {
  /** Все доступные версии в порядке убывания (для select). */
  versions: string[];
  target: Target;
  onChange: (t: Target) => void;
}

export function TargetSelector({ versions, target, onChange }: TargetSelectorProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Закрытие по клику снаружи / Esc.
  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e: MouseEvent): void => {
      const el = popoverRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleContext = (ctx: ContextKey): void => {
    const next = new Set(target.contexts);
    if (next.has(ctx)) next.delete(ctx);
    else next.add(ctx);
    onChange({ ...target, contexts: next });
  };

  const setVersion = (v: string): void => {
    onChange({ ...target, version: v === '' ? null : v });
  };

  const buttonLabel = formatTargetSummary(target);

  return (
    <div className="ts" ref={popoverRef}>
      <button
        type="button"
        className={'ts__btn' + (open ? ' ts__btn--open' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Указать версию платформы и контексты — справочник подсветит, что у вас работает"
      >
        <span aria-hidden="true">⚙</span>
        <span className="ts__btn-label">{buttonLabel}</span>
      </button>

      {open && (
        <div className="ts__popover" role="dialog" aria-label="Целевая платформа">
          <div className="ts__section">
            <label className="ts__label" htmlFor="ts-version">Версия платформы</label>
            <select
              id="ts-version"
              className="ts__select"
              value={target.version ?? ''}
              onChange={(e) => setVersion(e.target.value)}
            >
              <option value="">Без ограничения</option>
              {versions.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <p className="ts__hint">
              Записи, требующие более свежей версии, будут приглушены.
            </p>
          </div>

          <div className="ts__section">
            <div className="ts__sectionHead">
              <span className="ts__label">Контексты исполнения</span>
              <div className="ts__sectionActions">
                <button
                  type="button"
                  className="ts__link"
                  onClick={() => onChange({ ...target, contexts: new Set(ALL_CONTEXTS) })}
                >
                  Все
                </button>
                <span> · </span>
                <button
                  type="button"
                  className="ts__link"
                  onClick={() => onChange({ ...target, contexts: new Set() })}
                >
                  Сбросить
                </button>
              </div>
            </div>

            <ul className="ts__ctxList">
              {ALL_CONTEXTS.map((ctx) => (
                <li key={ctx}>
                  <label className="ts__ctx">
                    <input
                      type="checkbox"
                      checked={target.contexts.has(ctx)}
                      onChange={() => toggleContext(ctx)}
                    />
                    <span>{CONTEXT_LABELS[ctx]}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="ts__hint">
              Запись «доступна», если ВСЕ выбранные контексты есть в её списке.
              Пусто — фильтр выключен.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTargetSummary(t: Target): string {
  const v = t.version ?? '—';
  const n = t.contexts.size;
  if (n === 0) return `Платформа: ${v}`;
  if (n === 1) {
    const only = [...t.contexts][0];
    return `${v} · ${CONTEXT_LABELS[only]}`;
  }
  return `${v} · ${n} контекста`;
}
