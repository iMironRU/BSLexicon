import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Штамп сборки: короткий git-SHA (в CI — из GITHUB_SHA) и дата. */
function buildInfo(): { sha: string; time: string } {
  const fromCi = process.env.GITHUB_SHA?.slice(0, 7);
  let sha = fromCi ?? 'dev';
  if (!fromCi) {
    try {
      sha = execSync('git rev-parse --short HEAD').toString().trim();
    } catch {
      sha = 'dev';
    }
  }
  return { sha, time: new Date().toISOString().slice(0, 10) };
}

const BUILD = buildInfo();

/** Кладёт version.json в сборку — приложение сверяет его с вшитым SHA (автообновление). */
function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
    },
  };
}

// Базовый путь для GitHub Pages: https://imironru.github.io/BSLexicon/
// В dev-режиме base = '/', чтобы не мешать локальной разработке.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/BSLexicon/' : '/',
  define: {
    __BUILD_SHA__: JSON.stringify(BUILD.sha),
    __BUILD_TIME__: JSON.stringify(BUILD.time),
  },
  plugins: [
    react(),
    emitVersionJson(),
    VitePWA({
      // 'prompt' — не молча активируем новый SW, а показываем пользователю
      // баннер «Доступна новая версия», как у нас уже сделано в тренажёре
      // через useVersionCheck. Здесь баннер добавит PwaUpdatePrompt.
      registerType: 'prompt',
      // В деве SW отключён — иначе перебивает HMR и кэшит промежуточные
      // сборки. Тестирую PWA через `npm run build && npm run preview`.
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'icons/apple-touch-180.png'],
      manifest: {
        name: 'BSLexicon — тренажёр языка 1С',
        short_name: 'BSLexicon',
        description:
          'Браузерный тренажёр языка 1С (BSL) + справочник по языку и событиям. Пиши код, отлаживай пошагово, ищи функции — без платформы 1С.',
        theme_color: '#4ec9b0',
        background_color: '#1e1e1e',
        display: 'standalone',
        orientation: 'any',
        lang: 'ru',
        // start_url и scope Vite подставит с учётом base ('/BSLexicon/' в prod).
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache — весь shell (HTML/CSS/JS/mono-worker/иконки). Курированный
        // catalog (YAML) уходит в bundle через Vite eager glob → тоже в precache.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,yaml,ttf}'],
        // Один Monaco-чанк ~4 МБ + ts.worker ~7 МБ. Поднимаем лимит одиночного
        // файла в кэше до 10 МБ. Кэш строится один раз при установке.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // Multi-page: не подменяем /help/ на /index.html.
        navigateFallback: null,
        runtimeCaching: [
          {
            // Большие JSON выгрузки (полный СП, курированный СП) — лениво,
            // Cache-First, TTL 30 дней. Первое посещение — из сети, дальше
            // из кэша, оффлайн-работа справочника.
            urlPattern: ({ url }) =>
              url.pathname.includes('/reference/') && url.pathname.endsWith('.json'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'bslexicon-reference-json',
              expiration: { maxEntries: 5, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // Multi-page: тренажёр (/) + справочник (/help/). Help-entry не импортирует
      // Monaco — у него свой ≪50 КБ JS-чанк, не дублирующий 4 МБ редактора.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        help: fileURLToPath(new URL('./help/index.html', import.meta.url)),
        fullHelp: fileURLToPath(new URL('./help/full/index.html', import.meta.url)),
        eventsHelp: fileURLToPath(new URL('./help/events/index.html', import.meta.url)),
        judgeHelp: fileURLToPath(new URL('./help/judge/index.html', import.meta.url)),
      },
    },
  },
}));
