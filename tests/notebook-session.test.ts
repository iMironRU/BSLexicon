import { describe, expect, it } from 'vitest';
import { Session } from '../src/core/session';

describe('Session · persistent kernel', () => {
  it('переменная объявлена в eval №1 → видна в №2', () => {
    const s = new Session();
    const r1 = s.eval('Х = 10;');
    const r2 = s.eval('Сообщить(Х);');
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.output).toEqual(['10']);
  });

  it('процедура определена в №1 → вызвана в №2', () => {
    const s = new Session();
    s.eval('Процедура Приветствие() Сообщить("привет"); КонецПроцедуры');
    const r = s.eval('Приветствие();');
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(['привет']);
  });

  it('переопределение процедуры в №2 → в №3 используется новое', () => {
    const s = new Session();
    s.eval('Процедура Ф() Сообщить(1); КонецПроцедуры');
    s.eval('Процедура Ф() Сообщить(2); КонецПроцедуры');
    const r = s.eval('Ф();');
    expect(r.output).toEqual(['2']);
  });

  it('runtime-ошибка в ячейке → rebinding имён откатывается', () => {
    const s = new Session();
    s.eval('Х = 10;');
    // В этой ячейке пытаемся переприсвоить + сломать. Ошибка должна откатить
    // Х к прежнему значению 10.
    const r = s.eval('Х = 999; НетТакойФункции();');
    expect(r.ok).toBe(false);
    const check = s.eval('Сообщить(Х);');
    expect(check.output).toEqual(['10']);
  });

  it('runtime-ошибка → новое имя не появляется в persistent scope', () => {
    const s = new Session();
    const r = s.eval('Новое = 42; НетТакойФункции();');
    expect(r.ok).toBe(false);
    const check = s.eval('Сообщить(Новое);');
    // «Новое» откатилось — попытка использовать должна упасть runtime'ом.
    expect(check.ok).toBe(false);
  });

  it('runtime-ошибка → новая процедура не остаётся в реестре', () => {
    const s = new Session();
    const r = s.eval('Процедура НоваяПроц() КонецПроцедуры НетТакой();');
    expect(r.ok).toBe(false);
    const check = s.eval('НоваяПроц();');
    expect(check.ok).toBe(false);
  });

  it('runIndex монотонный, включая упавшие ячейки', () => {
    const s = new Session();
    expect(s.eval('Х = 1;').runIndex).toBe(1);
    expect(s.eval('НетТакой();').runIndex).toBe(2);
    expect(s.eval('Сообщить(Х);').runIndex).toBe(3);
  });

  it('reset() — переменные исчезают, runIndex снова с 1', () => {
    const s = new Session();
    s.eval('Х = 5;');
    s.eval('Y = 6;');
    s.reset();
    expect(s.eval('Сообщить(Х);').runIndex).toBe(1);
    // Х теперь не определён
    const check = s.eval('Сообщить(Х);');
    expect(check.ok).toBe(false);
  });

  it('output ячейки — только её собственный, прошлые не капают', () => {
    const s = new Session();
    s.eval('Сообщить("прошлое");');
    const r = s.eval('Сообщить("сейчас");');
    expect(r.output).toEqual(['сейчас']);
  });

  it('parse-ошибка — до snapshot, state не тронут', () => {
    const s = new Session();
    s.eval('Х = 10;');
    const r = s.eval('Если 1 Тогда'); // недо-исходник, parse рухнёт
    expect(r.ok).toBe(false);
    expect(r.error?.stage).toBe('parser');
    const check = s.eval('Сообщить(Х);');
    expect(check.output).toEqual(['10']);
  });

  it('огромное число вызовов не выбирает stepLimit одного Interpreter', () => {
    // Каждый eval — новый Interpreter, значит steps считаются заново.
    // Это регрессионный тест: если Session'у станет неудачно кто-то один
    // Interpreter reuse'ить — тест поймает переполнение бюджета.
    const s = new Session();
    for (let i = 0; i < 100; i += 1) {
      const r = s.eval('Для к = 1 По 100 Цикл КонецЦикла;');
      expect(r.ok).toBe(true);
    }
  });
});
