import { describe, expect, it } from 'vitest';
import { runTask } from '../src/judge/runner';
import type { Task } from '../src/judge/types';

/** Хелпер: минимальная задача — поля кроме `tests` заполнены заглушкой. */
function makeTask(tests: Task['tests']): Task {
  return {
    id: 'test',
    title: 'Test',
    chapter: '01',
    statement: 'ignored',
    starter: 'ignored',
    tests,
  };
}

describe('runner · stdout', () => {
  it('pass когда вывод совпадает', () => {
    const task = makeTask([{ kind: 'stdout', expect: 'Привет!' }]);
    const result = runTask(task, 'Сообщить("Привет!");');
    expect(result.overall).toBe('pass');
    expect(result.tests[0].status).toBe('pass');
  });

  it('fail когда вывод не совпадает', () => {
    const task = makeTask([{ kind: 'stdout', expect: 'Привет!' }]);
    const result = runTask(task, 'Сообщить("Пока!");');
    expect(result.overall).toBe('fail');
    expect(result.tests[0].status).toBe('fail');
    expect(result.tests[0].actual).toBe('Пока!');
    expect(result.tests[0].expected).toBe('Привет!');
  });

  it('игнорирует trailing пробелы и лишние пустые строки', () => {
    const task = makeTask([{ kind: 'stdout', expect: 'а\nб' }]);
    const result = runTask(task, 'Сообщить("а   "); Сообщить("б"); Сообщить("");');
    expect(result.tests[0].status).toBe('pass');
  });

  it('multi-line вывод', () => {
    const task = makeTask([{ kind: 'stdout', expect: '1\n2\n3' }]);
    const result = runTask(task, 'Для К = 1 По 3 Цикл Сообщить(К); КонецЦикла;');
    expect(result.tests[0].status).toBe('pass');
  });
});

describe('runner · call', () => {
  const sumTask = makeTask([
    { kind: 'call', name: '3 числа', invoke: 'СуммаСписка("1,2,3")', expect: '6' },
    { kind: 'call', name: 'пустая', invoke: 'СуммаСписка("")', expect: '0' },
  ]);

  const goodCode = [
    'Функция СуммаСписка(Перечень) Экспорт',
    '    Итог = 0;',
    '    Если ПустаяСтрока(Перечень) Тогда Возврат 0; КонецЕсли;',
    '    Для Каждого Ч Из СтрРазделить(Перечень, ",") Цикл',
    '        Итог = Итог + Число(Ч);',
    '    КонецЦикла;',
    '    Возврат Итог;',
    'КонецФункции',
  ].join('\n');

  it('pass когда все invoke совпадают с expect', () => {
    const result = runTask(sumTask, goodCode);
    expect(result.overall).toBe('pass');
    expect(result.tests.every((t) => t.status === 'pass')).toBe(true);
  });

  it('fail когда результат отличается', () => {
    const badCode = 'Функция СуммаСписка(Перечень) Экспорт Возврат 0; КонецФункции';
    const result = runTask(sumTask, badCode);
    // первый упадёт (6 vs 0), второй пройдёт (0 vs 0)
    expect(result.overall).toBe('fail');
    expect(result.tests[0].status).toBe('fail');
    expect(result.tests[1].status).toBe('pass');
    expect(result.tests[0].actual).toBe('0');
    expect(result.tests[0].expected).toBe('6');
  });

  it('дробный expect сравнивается по нормализованному представлению', () => {
    const task = makeTask([{ kind: 'call', invoke: 'Скидка(1500)', expect: '0.1' }]);
    const code = 'Функция Скидка(С) Экспорт Возврат 0.1; КонецФункции';
    expect(runTask(task, code).tests[0].status).toBe('pass');
  });

  it('булев expect (Истина/Ложь) сравнивается через каноническое представление', () => {
    const task = makeTask([{ kind: 'call', invoke: 'Чётное(4)', expect: 'Истина' }]);
    const code = 'Функция Чётное(Ч) Экспорт Возврат Ч % 2 = 0; КонецФункции';
    expect(runTask(task, code).tests[0].status).toBe('pass');
  });
});

describe('runner · ошибки', () => {
  it('runtime-error в userCode → один тест status: error, runner не падает', () => {
    const task = makeTask([
      { kind: 'stdout', expect: 'x' },
      { kind: 'call', invoke: 'Ф()', expect: '1' },
    ]);
    const result = runTask(task, 'Сообщить(1 / 0);');
    expect(result.overall).toBe('error');
    expect(result.tests[0].status).toBe('error');
    expect(result.tests[0].error).toContain('Деление на ноль');
  });

  it('битый expect (unparseable) → status: error с пометкой «невычислимо»', () => {
    const task = makeTask([{ kind: 'call', invoke: '1 + 1', expect: 'битая-строка!' }]);
    const result = runTask(task, '// ignored');
    expect(result.tests[0].status).toBe('error');
    expect(result.tests[0].error).toContain('невычислимо');
  });

  it('parser-error в userCode → status: error', () => {
    const task = makeTask([{ kind: 'stdout', expect: 'x' }]);
    const result = runTask(task, 'Если 1 > 0 Сообщить("нет Тогда");');
    expect(result.tests[0].status).toBe('error');
    expect(result.tests[0].error).toMatch(/парсера|Ошибка/);
  });
});

describe('runner · hidden', () => {
  it('пробрасывает hidden-флаг в результат (call-тесты)', () => {
    // Для call у разных тестов может быть разный invoke и expect,
    // а вот stdout читает один вывод userCode — там hidden уместен
    // на одном-единственном stdout-тесте, либо на call.
    const task = makeTask([
      { kind: 'call', invoke: 'Двойка(2)', expect: '4' },
      { kind: 'call', invoke: 'Двойка(3)', expect: '6', hidden: true },
    ]);
    const result = runTask(task, 'Функция Двойка(Ч) Экспорт Возврат Ч * 2; КонецФункции');
    expect(result.tests[0].hidden).toBe(false);
    expect(result.tests[1].hidden).toBe(true);
    expect(result.overall).toBe('pass');
  });
});

describe('runner · aggregate', () => {
  it('pass когда все pass', () => {
    const t = makeTask([{ kind: 'stdout', expect: 'x' }, { kind: 'stdout', expect: 'x' }]);
    expect(runTask(t, 'Сообщить("x");').overall).toBe('pass');
  });

  it('fail когда есть fail, но нет error', () => {
    const t = makeTask([{ kind: 'stdout', expect: 'x' }, { kind: 'stdout', expect: 'y' }]);
    expect(runTask(t, 'Сообщить("x");').overall).toBe('fail');
  });

  it('error перекрывает fail — общий статус error', () => {
    const t = makeTask([
      { kind: 'stdout', expect: 'x' },
      { kind: 'call', invoke: '1/0', expect: '1' },
    ]);
    expect(runTask(t, 'Сообщить("x");').overall).toBe('error');
  });
});

describe('runner · e2e на реальных задачах 1c-razgovornik', () => {
  it('summa-massiva: реальный starter + правильное решение', () => {
    const task = makeTask([
      { kind: 'call', name: 'три числа', invoke: 'СуммаСписка("1,2,3")', expect: '6' },
      { kind: 'call', name: 'одно число', invoke: 'СуммаСписка("42")', expect: '42' },
      { kind: 'call', name: 'пустая строка', invoke: 'СуммаСписка("")', expect: '0' },
      { kind: 'call', name: 'с отрицательными', invoke: 'СуммаСписка("-5,5,10")', expect: '10', hidden: true },
    ]);
    const solution = [
      'Функция СуммаСписка(Перечень) Экспорт',
      '    Если ПустаяСтрока(Перечень) Тогда Возврат 0; КонецЕсли;',
      '    Итог = 0;',
      '    Для Каждого Ч Из СтрРазделить(Перечень, ",") Цикл',
      '        Итог = Итог + Число(Ч);',
      '    КонецЦикла;',
      '    Возврат Итог;',
      'КонецФункции',
    ].join('\n');
    const result = runTask(task, solution);
    expect(result.overall).toBe('pass');
  });

  it('skidka: границы (equal boundary)', () => {
    const task = makeTask([
      { kind: 'call', invoke: 'Скидка(1500)', expect: '0.1' },
      { kind: 'call', invoke: 'Скидка(1000)', expect: '0.05' },
      { kind: 'call', invoke: 'Скидка(100)', expect: '0' },
    ]);
    const solution = [
      'Функция Скидка(С) Экспорт',
      '    Если С > 1000 Тогда Возврат 0.1;',
      '    ИначеЕсли С > 500 Тогда Возврат 0.05;',
      '    Иначе Возврат 0;',
      '    КонецЕсли;',
      'КонецФункции',
    ].join('\n');
    expect(runTask(task, solution).overall).toBe('pass');
  });

  it('chyotnye: stdout-задача с % (баг #5)', () => {
    const task = makeTask([
      { kind: 'stdout', expect: 'Да\nНет\nДа' },
    ]);
    const solution = [
      'Функция Чётное(Ч) Экспорт Возврат Ч % 2 = 0; КонецФункции',
      'Сообщить(Чётное(2));',
      'Сообщить(Чётное(3));',
      'Сообщить(Чётное(0));',
    ].join('\n');
    expect(runTask(task, solution).overall).toBe('pass');
  });
});
