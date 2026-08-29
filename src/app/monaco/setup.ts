/**
 * Self-host Monaco через Vite-бандл — без обращения к CDN.
 *
 * Зачем: тренажёр доступен офлайн, первая загрузка не зависит от
 * сторонней CDN, версия редактора зафиксирована lock-файлом.
 *
 * Как: `@monaco-editor/react` по умолчанию грузит Monaco AMD-сборкой
 * с CDN; `loader.config({ monaco })` подменяет это на ESM-инстанс из
 * нашего бандла. Worker подключаем через Vite-импорт `?worker`.
 *
 * Импортировать ОДИН раз — до создания React-root (см. main.tsx).
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
// eslint-disable-next-line import/no-unresolved -- Vite-специфичный URL-импорт воркера
// Monaco 0.56 перешёл на строгий exports field: путь /esm/vs/... больше не
// резолвится, доступен только сокращённый /editor/... (см. package exports).
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

// Базовый editor.worker — единственный, который нам нужен: языковые воркеры
// (TS/JSON/CSS/HTML) для BSL не задействованы.
self.MonacoEnvironment = {
  getWorker(): Worker {
    return new EditorWorker();
  },
};

loader.config({ monaco });
