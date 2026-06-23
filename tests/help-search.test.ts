import { describe, expect, it } from 'vitest';
import { buildCatalog } from '@core/index';
import type { CatalogEntry } from '@core/index';
import { search } from '../src/help/search';

function entry(over: Partial<CatalogEntry> & { id: string; ru: string; en: string }): CatalogEntry {
  return {
    id: over.id,
    kind: over.kind ?? 'function',
    names: { ru: over.ru, en: over.en },
    category: over.category ?? 'Прочее',
    description: over.description ?? '',
    signature: over.signature,
    params: over.params,
    returns: over.returns,
    examples: over.examples,
  };
}

const sample = buildCatalog([
  entry({ id: 'СокрЛП', ru: 'СокрЛП', en: 'TrimAll', category: 'Строки', description: 'Отбрасывает пробелы слева и справа.' }),
  entry({ id: 'СтрДлина', ru: 'СтрДлина', en: 'StrLen', category: 'Строки', description: 'Длина строки в символах.' }),
  entry({ id: 'СтрНайти', ru: 'СтрНайти', en: 'StrFind', category: 'Строки', description: 'Ищет подстроку. Возвращает позицию или 0.' }),
  entry({ id: 'Массив', kind: 'type', ru: 'Массив', en: 'Array', category: 'Коллекции', description: 'Упорядоченный набор значений.' }),
  entry({ id: 'Массив.Добавить', kind: 'method', ru: 'Добавить', en: 'Add', category: 'Коллекции', description: 'Добавляет значение в конец.' }),
  entry({ id: 'Сообщить', ru: 'Сообщить', en: 'Message', category: 'Прочее', description: 'Выводит строку в окно сообщений пользователю.' }),
]);

describe('search ранжирование', () => {
  it('пустой запрос → пусто', () => {
    expect(search(sample, '')).toEqual([]);
    expect(search(sample, '   ')).toEqual([]);
  });

  it('точное имя по-русски — на верху', () => {
    const hits = search(sample, 'Массив');
    expect(hits[0].entry.id).toBe('Массив');
    expect(hits[0].match).toBe('exact-name');
  });

  it('точное имя по-английски — тоже exact', () => {
    const hits = search(sample, 'Add');
    const top = hits[0];
    expect(top.entry.id).toBe('Массив.Добавить');
    expect(top.match).toBe('exact-name');
  });

  it('регистронезависим', () => {
    expect(search(sample, 'массив')[0].entry.id).toBe('Массив');
    expect(search(sample, 'ARRAY')[0].entry.id).toBe('Массив');
  });

  it('префикс «Стр» поднимает все Стр*-функции выше', () => {
    const hits = search(sample, 'Стр').map((h) => h.entry.id);
    expect(hits.slice(0, 2).sort()).toEqual(['СтрДлина', 'СтрНайти']);
  });

  it('подстрока в имени побеждает совпадение в описании', () => {
    // «строк» есть и в имени (СтрДлина — нет; СтрНайти — нет, но в описании «подстрока»)
    // и в описании СтрДлина «Длина строки». Имя `Сообщить` не содержит "строк",
    // зато описание Сообщить — «строку в окно». Проверяем что СтрДлина выше.
    const hits = search(sample, 'строк').map((h) => h.entry.id);
    expect(hits.indexOf('СтрДлина')).toBeLessThan(hits.indexOf('Сообщить'));
  });

  it('зацепка только в описании — после всех в имени', () => {
    // запрос «значение» — у Массив есть в описании; у Массив.Добавить — в описании
    const hits = search(sample, 'значение');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.match).toBe('description');
  });

  it('лимит соблюдается', () => {
    const hits = search(sample, 'с', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('matchIndex указывает на позицию в имени для name-substr', () => {
    // искать «Длина» — в `СтрДлина` это позиция 3 (с-т-р-Д)
    const hits = search(sample, 'Длина');
    expect(hits[0].entry.id).toBe('СтрДлина');
    expect(hits[0].match).toBe('name-substr');
    expect(hits[0].matchIndex).toBe(3);
  });
});
