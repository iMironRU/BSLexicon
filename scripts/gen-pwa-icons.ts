/**
 * Генерация PNG-иконок PWA из `public/favicon.svg`.
 *
 * Android/iOS требуют для «Добавить на главный экран» готовые PNG:
 *   • 192×192 — минимальная стандартная иконка (Chrome/Android).
 *   • 512×512 — для splash screen и высоких DPR.
 *   • 512×512 maskable — с safe-zone 20% (иначе Android обрежет края
 *     при закруглении). Реализуем как основной SVG на большем фоне.
 *
 * Запускается вручную (`npm run gen:pwa-icons`) — результат коммитим,
 * чтобы в build не тянуть sharp во время каждой сборки.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const svgPath = join(root, 'public', 'favicon.svg');
const outDir = join(root, 'public', 'icons');

if (!existsSync(svgPath)) {
  console.error(`Не найден ${svgPath}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const svg = readFileSync(svgPath);

// Обычные иконки — рендер SVG «во весь квадрат».
async function render(size: number, filename: string): Promise<void> {
  const out = join(outDir, filename);
  await sharp(svg, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`  ✓ ${filename} (${size}×${size})`);
}

// Maskable — safe zone 20%, иначе Android обрежет углы.
// Кладём фон accent-цвета на весь холст (для случая если система
// решит отрисовать в круглой маске), а сам логотип — 80% в центре.
async function renderMaskable(size: number, filename: string): Promise<void> {
  const inner = Math.round(size * 0.72);
  const innerPng = await sharp(svg, { density: 384 })
    .resize(inner, inner)
    .png()
    .toBuffer();
  const out = join(outDir, filename);
  // Однотонный accent-фон (наш --accent = #4ec9b0).
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0x4e, g: 0xc9, b: 0xb0, alpha: 1 },
    },
  })
    .composite([{ input: innerPng, gravity: 'center' }])
    .png()
    .toFile(out);
  console.log(`  ✓ ${filename} (${size}×${size}, maskable)`);
}

console.log('→ Генерирую PWA-иконки из public/favicon.svg');
await render(192, '192.png');
await render(512, '512.png');
await renderMaskable(512, '512-maskable.png');

// Apple touch — 180×180 в safari принято, без maskable.
await render(180, 'apple-touch-180.png');
console.log('✓ Готово.');
