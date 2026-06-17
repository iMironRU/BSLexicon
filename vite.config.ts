import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

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
  plugins: [react(), emitVersionJson()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
}));
