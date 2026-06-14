import { ParseError } from '../errors';
import type { KeywordKind } from '../lexer/keywords';
import type { Token, TokenType } from '../lexer/token';
import type {
  BinaryOp,
  Call,
  Expr,
  IfBranch,
  LValue,
  Param,
  Program,
  Stmt,
} from './ast';

const COMPARISON: Partial<Record<TokenType, BinaryOp>> = {
  eq: 'eq',
  neq: 'neq',
  lt: 'lt',
  lte: 'lte',
  gt: 'gt',
  gte: 'gte',
};

/** Рекурсивный парсер BSL (подмножество MVP). */
class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const stmts: Stmt[] = [];
    while (!this.isAtEnd()) {
      // Пустой оператор: лишний «;» (в т.ч. после КонецЕсли/КонецЦикла) допустим.
      if (this.check('semicolon')) {
        this.advance();
        continue;
      }
      stmts.push(this.parseStatement());
    }
    return stmts;
  }

  // --- Поток токенов ---

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos + 1] ?? this.peek();
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'eof';
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkKeyword(kind: KeywordKind): boolean {
    const t = this.peek();
    return t.type === 'keyword' && t.value === kind;
  }

  private matchKeyword(kind: KeywordKind): boolean {
    if (this.checkKeyword(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, what: string): Token {
    if (this.check(type)) return this.advance();
    const t = this.peek();
    throw new ParseError(`Ожидалось ${what}, получено «${t.lexeme || t.type}»`, t.line);
  }

  private expectKeyword(kind: KeywordKind, what: string): Token {
    if (this.checkKeyword(kind)) return this.advance();
    const t = this.peek();
    throw new ParseError(`Ожидалось ${what}, получено «${t.lexeme || t.type}»`, t.line);
  }

  // --- Операторы ---

  private parseStatement(): Stmt {
    const t = this.peek();
    if (t.type === 'keyword') {
      switch (t.value as KeywordKind) {
        case 'Var':
          return this.parseVarDecl();
        case 'Procedure':
          return this.parseProcDecl(false);
        case 'Function':
          return this.parseProcDecl(true);
        case 'If':
          return this.parseIf();
        case 'While':
          return this.parseWhile();
        case 'For':
          return this.parseFor();
        case 'Return':
          return this.parseReturn();
        case 'Break': {
          const line = this.advance().line;
          this.expect('semicolon', '«;»');
          return { kind: 'Break', line };
        }
        case 'Continue': {
          const line = this.advance().line;
          this.expect('semicolon', '«;»');
          return { kind: 'Continue', line };
        }
        default:
          throw new ParseError(
            `Конструкция «${t.lexeme}» пока не поддерживается ядром-скелетом`,
            t.line,
          );
      }
    }

    if (t.type === 'ident') {
      return this.parseAssignOrCall();
    }

    throw new ParseError(`Неожиданный токен «${t.lexeme || t.type}»`, t.line);
  }

  /** Оператор, начинающийся с идентификатора: присваивание (в т.ч. по члену/индексу) или вызов. */
  private parseAssignOrCall(): Stmt {
    const expr = this.parsePostfix();
    if (this.check('eq')) {
      this.advance();
      const value = this.parseExpression();
      this.expect('semicolon', '«;»');
      return { kind: 'Assign', target: this.asLValue(expr), value, line: expr.line };
    }
    this.expect('semicolon', '«;»');
    if (expr.kind !== 'Call' && expr.kind !== 'MethodCall') {
      throw new ParseError('Ожидалось присваивание «=» или вызов', expr.line);
    }
    return { kind: 'ExprStmt', expr, line: expr.line };
  }

  private asLValue(expr: Expr): LValue {
    if (expr.kind === 'Ident' || expr.kind === 'Member' || expr.kind === 'Index') {
      return expr;
    }
    throw new ParseError('Слева от «=» должна быть переменная, свойство или элемент', expr.line);
  }

  private parseVarDecl(): Stmt {
    const line = this.advance().line; // Перем
    const names: string[] = [this.expect('ident', 'имя переменной').lexeme];
    while (this.check('comma')) {
      this.advance();
      names.push(this.expect('ident', 'имя переменной').lexeme);
    }
    this.expect('semicolon', '«;»');
    return { kind: 'VarDecl', names, line };
  }

  private parseProcDecl(isFunction: boolean): Stmt {
    const line = this.advance().line; // Процедура / Функция
    const name = this.expect('ident', 'имя процедуры или функции').lexeme;
    this.expect('lparen', '«(»');
    const params: Param[] = [];
    if (!this.check('rparen')) {
      do {
        const byVal = this.matchKeyword('Val');
        const paramName = this.expect('ident', 'имя параметра').lexeme;
        let def: Expr | undefined;
        if (this.check('eq')) {
          this.advance();
          def = this.parseExpression();
        }
        params.push({ name: paramName, byVal, default: def });
      } while (this.check('comma') && this.advance());
    }
    this.expect('rparen', '«)»');
    const exported = this.matchKeyword('Export');

    const endKind: KeywordKind = isFunction ? 'EndFunction' : 'EndProcedure';
    const body = this.parseBlock([endKind]);
    this.expectKeyword(endKind, isFunction ? '«КонецФункции»' : '«КонецПроцедуры»');
    return { kind: 'ProcDecl', name, params, body, isFunction, exported, line };
  }

  private parseIf(): Stmt {
    const line = this.advance().line; // Если
    const branches: IfBranch[] = [];
    const cond = this.parseExpression();
    this.expectKeyword('Then', '«Тогда»');
    branches.push({ cond, body: this.parseBlock(['ElsIf', 'Else', 'EndIf']) });

    while (this.matchKeyword('ElsIf')) {
      const c = this.parseExpression();
      this.expectKeyword('Then', '«Тогда»');
      branches.push({ cond: c, body: this.parseBlock(['ElsIf', 'Else', 'EndIf']) });
    }

    let elseBody: Stmt[] | undefined;
    if (this.matchKeyword('Else')) {
      elseBody = this.parseBlock(['EndIf']);
    }
    this.expectKeyword('EndIf', '«КонецЕсли»');
    return { kind: 'If', branches, elseBody, line };
  }

  private parseWhile(): Stmt {
    const line = this.advance().line; // Пока
    const cond = this.parseExpression();
    this.expectKeyword('Do', '«Цикл»');
    const body = this.parseBlock(['EndDo']);
    this.expectKeyword('EndDo', '«КонецЦикла»');
    return { kind: 'While', cond, body, line };
  }

  private parseFor(): Stmt {
    const line = this.advance().line; // Для
    if (this.matchKeyword('Each')) {
      const eachVar = this.expect('ident', 'имя переменной обхода').lexeme;
      this.expectKeyword('In', '«Из»');
      const iterable = this.parseExpression();
      this.expectKeyword('Do', '«Цикл»');
      const eachBody = this.parseBlock(['EndDo']);
      this.expectKeyword('EndDo', '«КонецЦикла»');
      return { kind: 'ForEach', varName: eachVar, iterable, body: eachBody, line };
    }
    const varName = this.expect('ident', 'имя счётчика').lexeme;
    this.expect('eq', '«=»');
    const from = this.parseExpression();
    this.expectKeyword('To', '«По»');
    const to = this.parseExpression();
    this.expectKeyword('Do', '«Цикл»');
    const body = this.parseBlock(['EndDo']);
    this.expectKeyword('EndDo', '«КонецЦикла»');
    return { kind: 'For', varName, from, to, body, line };
  }

  private parseReturn(): Stmt {
    const line = this.advance().line; // Возврат
    let value: Expr | undefined;
    if (!this.check('semicolon')) {
      value = this.parseExpression();
    }
    this.expect('semicolon', '«;»');
    return { kind: 'Return', value, line };
  }

  /** Считывает операторы, пока не встретит один из терминаторов-ключевых слов. */
  private parseBlock(terminators: KeywordKind[]): Stmt[] {
    const stmts: Stmt[] = [];
    while (!this.isAtEnd()) {
      const t = this.peek();
      if (t.type === 'keyword' && terminators.includes(t.value as KeywordKind)) {
        break;
      }
      if (t.type === 'semicolon') {
        this.advance();
        continue;
      }
      stmts.push(this.parseStatement());
    }
    return stmts;
  }

  // --- Выражения (по возрастанию приоритета) ---

  private parseExpression(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.checkKeyword('Or')) {
      const line = this.advance().line;
      left = { kind: 'Binary', op: 'or', left, right: this.parseAnd(), line };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.checkKeyword('And')) {
      const line = this.advance().line;
      left = { kind: 'Binary', op: 'and', left, right: this.parseNot(), line };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.checkKeyword('Not')) {
      const line = this.advance().line;
      return { kind: 'Unary', op: 'not', operand: this.parseNot(), line };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    let op = COMPARISON[this.peek().type];
    while (op) {
      const line = this.advance().line;
      left = { kind: 'Binary', op, left, right: this.parseAdditive(), line };
      op = COMPARISON[this.peek().type];
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.check('plus') || this.check('minus')) {
      const tok = this.advance();
      const op: BinaryOp = tok.type === 'plus' ? 'add' : 'sub';
      left = { kind: 'Binary', op, left, right: this.parseMultiplicative(), line: tok.line };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.check('star') || this.check('slash')) {
      const tok = this.advance();
      const op: BinaryOp = tok.type === 'star' ? 'mul' : 'div';
      left = { kind: 'Binary', op, left, right: this.parseUnary(), line: tok.line };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.check('minus')) {
      const line = this.advance().line;
      return { kind: 'Unary', op: 'neg', operand: this.parseUnary(), line };
    }
    return this.parsePostfix();
  }

  /** Постфиксная цепочка: `.свойство`, `.Метод(...)`, `[индекс]`. */
  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.check('dot')) {
        const line = this.advance().line;
        const name = this.expect('ident', 'имя свойства или метода').lexeme;
        if (this.check('lparen')) {
          expr = { kind: 'MethodCall', object: expr, method: name, args: this.parseArgList(), line };
        } else {
          expr = { kind: 'Member', object: expr, name, line };
        }
      } else if (this.check('lbracket')) {
        const line = this.advance().line;
        const index = this.parseExpression();
        this.expect('rbracket', '«]»');
        expr = { kind: 'Index', object: expr, index, line };
      } else {
        return expr;
      }
    }
  }

  private parsePrimary(): Expr {
    const t = this.peek();

    switch (t.type) {
      case 'number':
        this.advance();
        return { kind: 'NumberLit', value: t.value as number, line: t.line };
      case 'string':
        this.advance();
        return { kind: 'StringLit', value: t.value as string, line: t.line };
      case 'question':
        return this.parseTernary();
      case 'lparen': {
        this.advance();
        const inner = this.parseExpression();
        this.expect('rparen', '«)»');
        return inner;
      }
      case 'ident':
        if (this.next().type === 'lparen') {
          return this.parsePrimaryCall();
        }
        this.advance();
        return { kind: 'Ident', name: t.lexeme, line: t.line };
      case 'keyword':
        switch (t.value as KeywordKind) {
          case 'True':
            this.advance();
            return { kind: 'BoolLit', value: true, line: t.line };
          case 'False':
            this.advance();
            return { kind: 'BoolLit', value: false, line: t.line };
          case 'Undefined':
            this.advance();
            return { kind: 'UndefinedLit', line: t.line };
          case 'Null':
            this.advance();
            return { kind: 'NullLit', line: t.line };
          case 'New':
            return this.parseNew();
          default:
            throw new ParseError(
              `«${t.lexeme}» пока не поддерживается в выражениях`,
              t.line,
            );
        }
      default:
        throw new ParseError(`Ожидалось выражение, получено «${t.lexeme || t.type}»`, t.line);
    }
  }

  private parseTernary(): Expr {
    const line = this.advance().line; // ?
    this.expect('lparen', '«(»');
    const cond = this.parseExpression();
    this.expect('comma', '«,»');
    const whenTrue = this.parseExpression();
    this.expect('comma', '«,»');
    const whenFalse = this.parseExpression();
    this.expect('rparen', '«)»');
    return { kind: 'Ternary', cond, whenTrue, whenFalse, line };
  }

  private parsePrimaryCall(): Call {
    const nameTok = this.advance(); // ident
    return { kind: 'Call', callee: nameTok.lexeme, args: this.parseArgList(), line: nameTok.line };
  }

  /** Конструктор: `Новый Тип` или `Новый Тип(аргументы)`. */
  private parseNew(): Expr {
    const line = this.advance().line; // Новый
    const typeName = this.expect('ident', 'имя типа').lexeme;
    const args = this.check('lparen') ? this.parseArgList() : [];
    return { kind: 'New', typeName, args, line };
  }

  /** Список аргументов в скобках: `( a, b, c )`. */
  private parseArgList(): Expr[] {
    this.expect('lparen', '«(»');
    const args: Expr[] = [];
    if (!this.check('rparen')) {
      do {
        args.push(this.parseExpression());
      } while (this.check('comma') && this.advance());
    }
    this.expect('rparen', '«)»');
    return args;
  }
}

export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parseProgram();
}
