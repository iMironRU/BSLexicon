/**
 * Каталог: чистый пайплайн «сырые YAML → индексы» проверяем на реальных файлах
 * catalog/ (читаем с диска через fs — в браузере их подаёт Vite-glob).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildCatalog, parseCatalog, methodTypeOf } from '../src/core/index';

function readCatalogFiles(): string[] {
  const dir = fileURLToPath(new URL('../catalog', import.meta.url));
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.yaml') || name.endsWith('.yml')) out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

const catalog = buildCatalog(parseCatalog(readCatalogFiles()));

describe('каталог: загрузка и индексы', () => {
  it('разбирает записи всех видов', () => {
    expect(catalog.functions.length).toBeGreaterThan(0);
    expect(catalog.methods.length).toBeGreaterThan(0);
    expect(catalog.types.length).toBeGreaterThan(0);
  });

  it('функция доступна по имени регистронезависимо (ru и en)', () => {
    expect(catalog.functionByName.get('сокрлп')?.id).toBe('СокрЛП');
    expect(catalog.functionByName.get('trimall')?.id).toBe('СокрЛП');
  });

  it('методы сгруппированы по типу', () => {
    const arr = catalog.methodsByType.get('Массив') ?? [];
    expect(arr.some((m) => m.id === 'Массив.Добавить')).toBe(true);
  });

  it('byId находит и метод, и тип', () => {
    expect(catalog.byId.get('Массив.Добавить')?.names.ru).toBe('Добавить');
    expect(catalog.byId.get('Массив')?.kind).toBe('type');
  });

  it('byName ищет по ru/en и собирает омонимы (hover/signature)', () => {
    // метод по имени (ru) — для hover/signature после точки
    const dobavit = catalog.byName.get('добавить') ?? [];
    expect(dobavit.some((e) => e.id === 'Массив.Добавить' && e.kind === 'method')).toBe(true);
    // по английскому имени
    const add = catalog.byName.get('add') ?? [];
    expect(add.some((e) => e.id === 'Массив.Добавить')).toBe(true);
    // «Строка» — омоним: и тип, и функция-конвертация
    const stroka = catalog.byName.get('строка') ?? [];
    expect(stroka.some((e) => e.kind === 'type')).toBe(true);
    expect(stroka.some((e) => e.kind === 'function')).toBe(true);
  });
});

describe('methodTypeOf', () => {
  it('вычленяет тип из id метода', () => {
    expect(methodTypeOf('Структура.Вставить')).toBe('Структура');
  });

  it('возвращает пустую строку для не-метода', () => {
    expect(methodTypeOf('СокрЛП')).toBe('');
  });
});
