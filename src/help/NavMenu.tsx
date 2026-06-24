import { useEffect, useRef, useState } from 'react';

export interface NavLink {
  label: string;
  href: string;
  /** Если true — пометить как «текущая страница». */
  current?: boolean;
  /** Подсказка под пунктом (показывается компактно). */
  hint?: string;
}

interface NavMenuProps {
  links: NavLink[];
  label?: string;
}

/**
 * Универсальное выпадающее меню «Перейти ▾» для шапок справочника.
 * Внутри — список ссылок на сестринские страницы (учебный/полный/события/тренажёр).
 * Закрывается кликом снаружи и по Esc.
 */
export function NavMenu({ links, label = 'Перейти' }: NavMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="navmenu" ref={ref}>
      <button
        type="button"
        className={'navmenu__btn' + (open ? ' navmenu__btn--open' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span>{label}</span>
        <span className="navmenu__chevron" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="navmenu__list" role="menu">
          {links.map((l) => (
            <li key={l.href}>
              <a
                role="menuitem"
                className={'navmenu__item' + (l.current ? ' navmenu__item--current' : '')}
                href={l.href}
                onClick={() => setOpen(false)}
              >
                <span className="navmenu__label">{l.label}</span>
                {l.hint && <span className="navmenu__hint">{l.hint}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
