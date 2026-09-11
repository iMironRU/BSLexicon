/**
 * Единые адреса под-приложений — до этого модуля каждый help-entry
 * заводил свою пару `LANDING_URL / TRAINER_URL / HELP_URL` со ссылкой
 * на `import.meta.env.BASE_URL`. Появлялся новый маршрут — приходилось
 * помнить всех, кто уже держал соседей.
 *
 * `BASE_URL` — `'/'` в dev, `'/BSLexicon/'` в prod (см. vite.config.ts).
 * Vite подставляет это на сборке, никакого рантайм-разрешения нет.
 */
/** `'/'` в dev, `'/BSLexicon/'` в prod — тот же, что Vite подставляет
 *  в `import.meta.env.BASE_URL`. Экспортируем, чтобы динамическое
 *  построение URL (файлы `reference/*.json`, ссылки на другие entries
 *  с параметрами) шло через один источник. */
export const BASE_URL = import.meta.env.BASE_URL;

export const LANDING_URL = BASE_URL;
export const TRAINER_URL = `${BASE_URL}trainer/`;
export const HELP_URL = `${BASE_URL}help/`;
export const HELP_FULL_URL = `${BASE_URL}help/full/`;
export const HELP_EVENTS_URL = `${BASE_URL}help/events/`;
export const HELP_JUDGE_URL = `${BASE_URL}help/judge/`;
export const HELP_BSP_URL = `${BASE_URL}help/bsp/`;
export const NOTEBOOK_URL = `${BASE_URL}notebook/`;
export const QUERY_URL = `${BASE_URL}query/`;
export const BOOK_URL = `${BASE_URL}book/`;
