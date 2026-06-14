import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Базовый путь для GitHub Pages: https://imironru.github.io/BSLexicon/
// В dev-режиме base = '/', чтобы не мешать локальной разработке.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/BSLexicon/' : '/',
  plugins: [react()],
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
