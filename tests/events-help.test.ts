import { describe, expect, it } from 'vitest';
import type { SyntaxEntry } from '../src/app/reference/types';
import { buildGroups, groupOf, isEvent, phaseOf } from '../src/events-help/events';

function entry(over: Partial<SyntaxEntry>): SyntaxEntry {
  return {
    owner: 'Глобальный контекст',
    ownerEn: 'Global context',
    kind: 'event',
    category: 'Прочее',
    nameRu: 'Метод',
    nameEn: 'Method',
    signature: null,
    params: [],
    returnType: null,
    availability: [],
    availabilityKeys: [],
    since: null,
    referenceUrl: null,
    ...over,
  };
}

describe('isEvent', () => {
  it('kind=event — событие', () => {
    expect(isEvent(entry({ kind: 'event', nameRu: 'ПриОткрытии' }))).toBe(true);
    expect(isEvent(entry({ kind: 'event', nameRu: 'Проведение' }))).toBe(true);
  });

  it('методы, функции и свойства — НЕ события (даже с префиксом-словом)', () => {
    expect(isEvent(entry({ kind: 'method', nameRu: 'ПриОткрытии' }))).toBe(false);
    expect(isEvent(entry({ kind: 'function', nameRu: 'ПриОткрытии' }))).toBe(false);
    expect(isEvent(entry({ kind: 'property', nameRu: 'ПриОткрытии' }))).toBe(false);
    expect(isEvent(entry({ kind: 'method', nameRu: 'Записать' }))).toBe(false);
  });
});

describe('groupOf — классификация owner-а в группу', () => {
  it('Глобальный контекст → system', () => {
    expect(groupOf('Глобальный контекст')).toBe('system');
  });
  it('документы', () => {
    expect(groupOf('ДокументОбъект')).toBe('documents');
    expect(groupOf('ФормаДокумента')).toBe('forms'); // приоритет «форма»
  });
  it('справочники', () => {
    expect(groupOf('СправочникМенеджер')).toBe('catalogs');
    expect(groupOf('СправочникОбъект')).toBe('catalogs');
  });
  it('регистры', () => {
    expect(groupOf('РегистрСведенийМенеджер')).toBe('registers');
    expect(groupOf('РегистрНакопленияНаборЗаписей')).toBe('registers');
  });
  it('формы', () => {
    expect(groupOf('УправляемаяФорма')).toBe('forms');
    expect(groupOf('ПолеФормы')).toBe('forms');
  });
  it('бизнес-процессы / задачи', () => {
    expect(groupOf('БизнесПроцессОбъект')).toBe('businessProcesses');
    expect(groupOf('ЗадачаМенеджер')).toBe('tasks');
  });
  it('неизвестное → other', () => {
    expect(groupOf('XDTOСериализатор')).toBe('other');
  });
});

describe('phaseOf', () => {
  it('распознаёт фазу по префиксу', () => {
    expect(phaseOf('ПередЗаписью')).toBe('pre');
    expect(phaseOf('ПриОткрытии')).toBe('on');
    expect(phaseOf('ПослеЗаписи')).toBe('post');
    expect(phaseOf('ОбработкаПроверкиЗаполнения')).toBe('handle');
    expect(phaseOf('Проведение')).toBe('other');
  });
});

describe('buildGroups', () => {
  it('собирает owner-ы в группы с подсчётом', () => {
    const events = [
      entry({ kind: 'event', owner: 'ДокументОбъект', nameRu: 'ПередЗаписью' }),
      entry({ kind: 'event', owner: 'ДокументОбъект', nameRu: 'ПриЗаписи' }),
      entry({ kind: 'event', owner: 'СправочникМенеджер', nameRu: 'ОбработкаЗаполнения' }),
    ];
    const groups = buildGroups(events);
    const docs = groups.find((g) => g.key === 'documents');
    const cats = groups.find((g) => g.key === 'catalogs');
    expect(docs?.total).toBe(2);
    expect(docs?.owners).toEqual([{ name: 'ДокументОбъект', count: 2 }]);
    expect(cats?.total).toBe(1);
    expect(cats?.owners).toEqual([{ name: 'СправочникМенеджер', count: 1 }]);
  });

  it('канонический порядок групп (формы → документы → справочники → ...)', () => {
    const events = [
      entry({ kind: 'event', owner: 'СправочникОбъект', nameRu: 'ПриЗаписи' }),
      entry({ kind: 'event', owner: 'УправляемаяФорма', nameRu: 'ПриОткрытии' }),
      entry({ kind: 'event', owner: 'ДокументОбъект', nameRu: 'Проведение' }),
    ];
    const keys = buildGroups(events).map((g) => g.key);
    expect(keys[0]).toBe('forms');
    expect(keys.indexOf('documents')).toBeLessThan(keys.indexOf('catalogs'));
  });
});
