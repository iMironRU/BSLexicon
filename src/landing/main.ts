/**
 * Стартовый лендинг (хаб): без React, всё в HTML.
 * Скрипт делает две вещи:
 *   1. Пробрасывает старые ссылки тренажёра ( `/?code=`, `/?gzcode=`, `/?title=` ) на
 *      новый путь `/trainer/`, чтобы shared-ссылки из старых версий не ломались.
 *   2. Показывает git-SHA из build-time define в шапке.
 */

import { TRAINER_URL } from '../app/urls';

// Vite подставит эти константы при сборке (см. vite.config.ts define).
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

// 1. Legacy-редирект.
const params = new URLSearchParams(window.location.search);
const TRAINER_PARAMS = ['code', 'gzcode', 'title'];
const hasTrainerParam = TRAINER_PARAMS.some((p) => params.has(p));
if (hasTrainerParam) {
  window.location.replace(`${TRAINER_URL}${window.location.search}${window.location.hash}`);
}

// 2. Build-badge.
const shaEl = document.getElementById('build-sha');
if (shaEl) {
  shaEl.textContent = __BUILD_SHA__ ?? '—';
  shaEl.title = `Собрано ${__BUILD_TIME__}`;
}
