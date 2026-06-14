/**
 * Golden-тесты парсера: «исходник → форма AST». Сверяем структуру через
 * toMatchObject (номера строк игнорируются) — ловит регрессии грамматики
 * и приоритета операций.
 */
import { describe, it, expect } from 'vitest';
import { lex } from '../src/core/lexer/lexer';
import { parse } from '../src/core/parser/parser';
import type { Program } from '../src/core/parser/ast';

const ast = (src: string): Program => parse(lex(src));

describe('parser: выражения', () => {
  it('приоритет операций: 1 + 2 * 3 = add(1, mul(2, 3))', () => {
    expect(ast('Х = 1 + 2 * 3;')).toMatchObject([
      {
        kind: 'Assign',
        target: { kind: 'Ident', name: 'Х' },
        value: {
          kind: 'Binary',
          op: 'add',
          left: { kind: 'NumberLit', value: 1 },
          right: {
            kind: 'Binary',
            op: 'mul',
            left: { kind: 'NumberLit', value: 2 },
            right: { kind: 'NumberLit', value: 3 },
          },
        },
      },
    ]);
  });

  it('скобки меняют приоритет: (1 + 2) * 3', () => {
    expect(ast('Х = (1 + 2) * 3;')).toMatchObject([
      {
        kind: 'Assign',
        value: {
          kind: 'Binary',
          op: 'mul',
          left: { kind: 'Binary', op: 'add' },
          right: { kind: 'NumberLit', value: 3 },
        },
      },
    ]);
  });

  it('конструктор, метод и индекс', () => {
    expect(ast('М = Новый Массив; М.Добавить(5); Э = М[0];')).toMatchObject([
      { kind: 'Assign', value: { kind: 'New', typeName: 'Массив', args: [] } },
      {
        kind: 'ExprStmt',
        expr: {
          kind: 'MethodCall',
          object: { kind: 'Ident', name: 'М' },
          method: 'Добавить',
          args: [{ kind: 'NumberLit', value: 5 }],
        },
      },
      {
        kind: 'Assign',
        value: { kind: 'Index', object: { kind: 'Ident', name: 'М' }, index: { kind: 'NumberLit', value: 0 } },
      },
    ]);
  });
});

describe('parser: операторы', () => {
  it('Если / ИначеЕсли / Иначе', () => {
    const src = `Если Х > 0 Тогда
  А = 1;
ИначеЕсли Х < 0 Тогда
  А = 2;
Иначе
  А = 3;
КонецЕсли;`;
    expect(ast(src)).toMatchObject([
      {
        kind: 'If',
        branches: [
          { cond: { kind: 'Binary', op: 'gt' }, body: [{ kind: 'Assign' }] },
          { cond: { kind: 'Binary', op: 'lt' }, body: [{ kind: 'Assign' }] },
        ],
        elseBody: [{ kind: 'Assign', value: { kind: 'NumberLit', value: 3 } }],
      },
    ]);
  });

  it('Для Каждого ... Из', () => {
    expect(ast('Для Каждого Э Из Кол Цикл Сумма = Сумма + Э; КонецЦикла;')).toMatchObject([
      {
        kind: 'ForEach',
        varName: 'Э',
        iterable: { kind: 'Ident', name: 'Кол' },
        body: [{ kind: 'Assign' }],
      },
    ]);
  });

  it('объявление функции с параметром Знач и Возврат', () => {
    expect(ast('Функция Удвоить(Знач Х) Возврат Х * 2; КонецФункции')).toMatchObject([
      {
        kind: 'ProcDecl',
        name: 'Удвоить',
        isFunction: true,
        params: [{ name: 'Х', byVal: true }],
        body: [{ kind: 'Return', value: { kind: 'Binary', op: 'mul' } }],
      },
    ]);
  });
});
