import { describe, expect, it } from 'vitest';
import { run } from '@core/index';

/** Удобный помощник: запускает код и возвращает вывод одной строкой. */
function output(source: string): string {
  const result = run(source);
  if (!result.ok) {
    throw new Error(`${result.error.stage}: ${result.error.message}`);
  }
  return result.output.join('\n');
}

describe('арифметика и присваивание', () => {
  it('считает выражение и выводит результат', () => {
    expect(output('А = 2 + 2 * 2; Сообщить(А);')).toBe('6');
  });

  it('учитывает приоритет скобок', () => {
    expect(output('Сообщить((2 + 2) * 2);')).toBe('8');
  });

  it('конкатенирует строку с числом', () => {
    expect(output('Сообщить("Итог=" + 5);')).toBe('Итог=5');
  });
});

describe('управление потоком', () => {
  it('выбирает ветку Если/Иначе', () => {
    expect(output('Если 3 > 2 Тогда Сообщить("да"); Иначе Сообщить("нет"); КонецЕсли;')).toBe('да');
  });

  it('суммирует в цикле Для', () => {
    const code = `
      Итог = 0;
      Для Сч = 1 По 5 Цикл
        Итог = Итог + Сч;
      КонецЦикла;
      Сообщить(Итог);
    `;
    expect(output(code)).toBe('15');
  });

  it('обрабатывает Прервать в цикле Пока', () => {
    const code = `
      Сч = 0;
      Пока Истина Цикл
        Сч = Сч + 1;
        Если Сч >= 3 Тогда Прервать; КонецЕсли;
      КонецЦикла;
      Сообщить(Сч);
    `;
    expect(output(code)).toBe('3');
  });
});

describe('переменная, меняющая тип в рантайме', () => {
  it('инспекция отражает текущий тип', () => {
    const result = run('Х = 1; Х = "строка";');
    if (!result.ok) throw new Error(result.error.message);
    const x = result.variables.find((v) => v.name === 'Х');
    expect(x?.type).toBe('Строка');
  });
});

describe('пользовательские процедуры и функции', () => {
  it('вызывает функцию и возвращает значение', () => {
    const code = `
      Функция Удвоить(Знач Х)
        Возврат Х * 2;
      КонецФункции
      Сообщить(Удвоить(21));
    `;
    expect(output(code)).toBe('42');
  });

  it('применяет значение параметра по умолчанию', () => {
    const code = `
      Функция Привет(Имя = "мир")
        Возврат "Привет, " + Имя;
      КонецФункции
      Сообщить(Привет());
    `;
    expect(output(code)).toBe('Привет, мир');
  });
});

describe('двуязычность и регистронезависимость', () => {
  it('понимает английские ключевые слова', () => {
    expect(output('If 1 = 1 Then Сообщить("ok"); EndIf;')).toBe('ok');
  });

  it('регистронезависим к идентификаторам', () => {
    expect(output('Перем Итог; итог = 7; Сообщить(ИТОГ);')).toBe('7');
  });
});

describe('ошибки', () => {
  it('сообщает об ошибке выполнения с этапом', () => {
    const result = run('Сообщить(1 / 0);');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.stage).toBe('runtime');
  });

  it('сообщает о синтаксической ошибке', () => {
    const result = run('Если 1 > 0 Сообщить("нет Тогда");');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.stage).toBe('parser');
  });
});
