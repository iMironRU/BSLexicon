/**
 * Режим notebook'а (#27): «педагог» редактирует всё, «ученик» — только
 * своё решение.
 *
 * Начальный режим:
 *   1. ?mode=student / ?mode=author — жёсткая форс-настройка
 *   2. ?nb=... без mode — student (кто-то поделился ссылкой)
 *   3. Пустой URL — author (свой draft, полный доступ)
 *   4. ?nb-src=... — оставляем текущее (педагог/книга дал ссылку) →
 *      student
 *
 * Ученик может нажать toggle в шапке и увидеть внутренности —
 * защита фронтовая, не серверная. Задача — не запутать, а не
 * ограничить доступ.
 */
export type NotebookMode = 'author' | 'student';

export function initialMode(search: string): NotebookMode {
  const params = new URLSearchParams(search);
  const forced = params.get('mode');
  if (forced === 'author' || forced === 'student') return forced;
  if (params.get('nb') || params.get('nb-src')) return 'student';
  return 'author';
}

/** Форс-режим в URL — чтобы toggle сохранялся при копировании ссылки. */
export function setModeInUrl(mode: NotebookMode): void {
  const url = new URL(window.location.href);
  url.searchParams.set('mode', mode);
  window.history.replaceState(null, '', url.toString());
}

/** Добавляет `mode=student` к share-ссылке из режима author. */
export function withStudentMode(url: string): string {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const u = new URL(url, base);
    u.searchParams.set('mode', 'student');
    return u.toString();
  } catch {
    // Не URL — возвращаем как есть, ссылку и так испортить нельзя.
    return url;
  }
}
