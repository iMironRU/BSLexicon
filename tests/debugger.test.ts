import { describe, expect, it } from 'vitest';
import { DebugSession, run } from '@core/index';

/** Программа из 4 строк: номера строк предсказуемы (без ведущего перевода строки). */
const PROGRAM = ['Перем Итог;', 'Итог = 0;', 'Итог = Итог + 1;', 'Сообщить(Итог);'].join(
  '\n',
);

function valueOf(session: ReturnType<DebugSession['snapshot']>, name: string): string | undefined {
  return session.variables.find((v) => v.name === name)?.display;
}

function typeOf(session: ReturnType<DebugSession['snapshot']>, name: string): string | undefined {
  return session.variables.find((v) => v.name === name)?.type;
}

describe('DebugSession: пошаговый проход', () => {
  it('останавливается перед каждым оператором и обновляет переменные', () => {
    const session = new DebugSession(PROGRAM);
    expect(session.state).toBe('ready');

    // Шаг 1: стоим ПЕРЕД «Перем Итог;» — оператор ещё не исполнен.
    let snap = session.stepOver();
    expect(snap.state).toBe('paused');
    expect(snap.line).toBe(1);

    // Шаг 2: стоим перед «Итог = 0;» — Итог уже объявлен (Неопределено).
    snap = session.stepOver();
    expect(snap.line).toBe(2);
    expect(typeOf(snap, 'Итог')).toBe('Неопределено');

    // Шаг 3: стоим перед «Итог = Итог + 1;» — присваивание 0 уже выполнено.
    snap = session.stepOver();
    expect(snap.line).toBe(3);
    expect(valueOf(snap, 'Итог')).toBe('0');

    // Шаг 4: стоим перед «Сообщить(Итог);» — Итог стал 1.
    snap = session.stepOver();
    expect(snap.line).toBe(4);
    expect(valueOf(snap, 'Итог')).toBe('1');

    // Шаг 5: программа завершилась, вывод накоплен.
    snap = session.stepOver();
    expect(snap.state).toBe('finished');
    expect(snap.line).toBeNull();
    expect(snap.output).toEqual(['1']);
  });
});

describe('DebugSession: точки останова', () => {
  it('«Продолжить» останавливается ровно на строке с точкой останова', () => {
    const session = new DebugSession(PROGRAM);
    session.toggleBreakpoint(4);

    const snap = session.continueRun();
    expect(snap.state).toBe('paused');
    expect(snap.line).toBe(4);
    // Строка с брейкпоинтом ещё не исполнена.
    expect(valueOf(snap, 'Итог')).toBe('1');
    expect(snap.output).toEqual([]);
  });

  it('без точек останова «Продолжить» доводит до конца', () => {
    const session = new DebugSession(PROGRAM);
    const snap = session.continueRun();
    expect(snap.state).toBe('finished');
    expect(snap.output).toEqual(['1']);
  });
});

describe('DebugSession: эквивалентность батч-запуску', () => {
  it('runToEnd даёт тот же вывод, что и run()', () => {
    const batch = run(PROGRAM);
    const snap = new DebugSession(PROGRAM).runToEnd();
    expect(snap.state).toBe('finished');
    expect(batch.ok && snap.output).toEqual(batch.ok ? batch.output : null);
  });
});

describe('DebugSession: ошибки', () => {
  it('рантайм-ошибка при шаге → state error, stage runtime', () => {
    const snap = new DebugSession('Сообщить(1 / 0);').runToEnd();
    expect(snap.state).toBe('error');
    expect(snap.error?.stage).toBe('runtime');
  });

  it('ошибка парсера в конструкторе → state error, stage parser', () => {
    const session = new DebugSession('Если 1 > 0 Сообщить("нет Тогда");');
    expect(session.state).toBe('error');
    expect(session.snapshot().error?.stage).toBe('parser');
  });

  it('ошибка лексера в конструкторе → state error, stage lexer', () => {
    const session = new DebugSession('Сообщить(@);');
    expect(session.state).toBe('error');
    expect(session.snapshot().error?.stage).toBe('lexer');
  });
});
