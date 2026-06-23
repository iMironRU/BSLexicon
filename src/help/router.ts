import { useEffect, useState } from 'react';
import type { CatalogKind } from '@core/index';

/**
 * Hash-роутер справочника. Формат: `#/<kind>/<encodeURIComponent(id)>`.
 *
 * Hash выбран сознательно: GitHub Pages без 404.html-хака не делает SPA-fallback,
 * а hash-маршруты переживают перезагрузку deep-link с первого тика. Парсер
 * терпим: пустой хеш, `#`, `#/` — все одинаково ведут на главную.
 */

export type Route =
  | { kind: 'home' }
  | { kind: 'entry'; entryKind: CatalogKind; id: string }
  | { kind: 'not-found'; raw: string };

const KINDS: readonly CatalogKind[] = ['type', 'function', 'method', 'property'];

function isCatalogKind(s: string): s is CatalogKind {
  return (KINDS as readonly string[]).includes(s);
}

/** Парсит `location.hash` в маршрут. */
export function parseHash(hash: string): Route {
  const trimmed = hash.replace(/^#\/?/, '');
  if (trimmed === '') return { kind: 'home' };

  const [entryKind, rawId] = trimmed.split('/', 2);
  if (entryKind && isCatalogKind(entryKind) && rawId) {
    try {
      return { kind: 'entry', entryKind, id: decodeURIComponent(rawId) };
    } catch {
      return { kind: 'not-found', raw: hash };
    }
  }
  return { kind: 'not-found', raw: hash };
}

/** Сериализует маршрут в `#/...` для href. */
export function formatHash(route: Route): string {
  if (route.kind === 'home') return '#/';
  if (route.kind === 'entry') {
    return `#/${route.entryKind}/${encodeURIComponent(route.id)}`;
  }
  return route.raw;
}

/** Подписка на `hashchange`; обновляется синхронно при изменении URL. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
