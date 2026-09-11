/**
 * Единые адреса под-приложений — до этого модуля каждый help-entry
 * заводил свою пару `LANDING_URL / TRAINER_URL / HELP_URL` со ссылкой
 * на `import.meta.env.BASE_URL`. Появлялся новый маршрут — приходилось
 * помнить всех, кто уже держал соседей.
 *
 * `BASE_URL` — `'/'` в dev, `'/BSLexicon/'` в prod (см. vite.config.ts).
 * Vite подставляет это на сборке, никакого рантайм-разрешения нет.
 */
const BASE = import.meta.env.BASE_URL;

export const LANDING_URL = BASE;
export const TRAINER_URL = `${BASE}trainer/`;
export const HELP_URL = `${BASE}help/`;
export const HELP_FULL_URL = `${BASE}help/full/`;
export const HELP_EVENTS_URL = `${BASE}help/events/`;
export const HELP_JUDGE_URL = `${BASE}help/judge/`;
export const HELP_BSP_URL = `${BASE}help/bsp/`;
export const NOTEBOOK_URL = `${BASE}notebook/`;
export const QUERY_URL = `${BASE}query/`;
export const BOOK_URL = `${BASE}book/`;
