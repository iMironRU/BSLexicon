/**
 * Общий hash-route хук — тонкая обёртка над `hashchange`. Каждая под-
 * страница держит собственный `parseHash(hash) → Route`, тип Route у
 * всех разный (catalog kind в /help/, task/book в /help/judge/, owner в
 * /help/full/, event category в /help/events/). Хук — параметрический,
 * возвращает то, что вернула `parse`.
 *
 * До этого модуля хук копипастился четыре раза с одинаковым useEffect
 * на hashchange.
 */
import { useEffect, useState } from 'react';

export function useHashRoute<T>(parse: (hash: string) => T): T {
  const [route, setRoute] = useState<T>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [parse]);
  return route;
}
