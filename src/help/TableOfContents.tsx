import { useEffect, useRef, useState } from 'react';

interface TocItem {
  id: string;
  label: string;
}

interface TableOfContentsProps {
  /** Контейнер, в котором искать `[data-toc]`-заголовки. */
  scopeRef: React.RefObject<HTMLElement | null>;
  /** Сигнал «контент пересобран» — чтобы переинициализировать observer. */
  contentKey: unknown;
}

/**
 * Оглавление текущей карточки. Собирает все `<h2 data-toc id="..">`
 * внутри `scopeRef` и подсвечивает заголовок, ближайший к верху viewport
 * при скролле (через IntersectionObserver). Если секций <2 — не рисуем
 * ничего (TOC бессмысленен на коротких карточках).
 */
export function TableOfContents({ scopeRef, contentKey }: TableOfContentsProps) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Пересобираем список и observer при смене контента
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return undefined;

    const headings = [...scope.querySelectorAll<HTMLElement>('[data-toc]')];
    const next: TocItem[] = headings.map((h) => ({
      id: h.id || h.dataset.toc || '',
      label: h.dataset.tocLabel ?? h.textContent ?? '',
    })).filter((i) => i.id !== '');

    setItems(next);
    setActiveId(next[0]?.id ?? null);

    if (next.length < 2) {
      observerRef.current?.disconnect();
      return undefined;
    }

    // Подсвечиваем заголовок, который проходит верхнюю четверть viewport.
    const obs = new IntersectionObserver(
      (entries) => {
        // Берём самый верхний из видимых (а если ничего не видно — оставляем как есть).
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '0px 0px -75% 0px', threshold: [0, 1] },
    );
    for (const h of headings) if (h.id) obs.observe(h);
    observerRef.current = obs;
    return () => obs.disconnect();
  }, [scopeRef, contentKey]);

  if (items.length < 2) return null;

  return (
    <nav className="toc" aria-label="Оглавление">
      <div className="toc__title">На странице</div>
      <ul className="toc__list">
        {items.map((it) => (
          <li key={it.id}>
            <a
              href={`#${it.id}`}
              className={'toc__link' + (it.id === activeId ? ' toc__link--active' : '')}
              onClick={(e) => {
                // Не меняем route — это якорь внутри карточки, не URL.
                e.preventDefault();
                const target = document.getElementById(it.id);
                target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setActiveId(it.id);
              }}
            >
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
