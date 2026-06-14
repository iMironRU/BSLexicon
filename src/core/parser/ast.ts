/** Абстрактное синтаксическое дерево BSL (подмножество MVP). */

export type BinaryOp =
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'and'
  | 'or';

export interface NumberLit {
  kind: 'NumberLit';
  value: number;
  line: number;
}
export interface StringLit {
  kind: 'StringLit';
  value: string;
  line: number;
}
export interface BoolLit {
  kind: 'BoolLit';
  value: boolean;
  line: number;
}
export interface UndefinedLit {
  kind: 'UndefinedLit';
  line: number;
}
export interface NullLit {
  kind: 'NullLit';
  line: number;
}
export interface Ident {
  kind: 'Ident';
  name: string;
  line: number;
}
export interface Unary {
  kind: 'Unary';
  op: 'neg' | 'not';
  operand: Expr;
  line: number;
}
export interface Binary {
  kind: 'Binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
  line: number;
}
export interface Call {
  kind: 'Call';
  callee: string;
  args: Expr[];
  line: number;
}
export interface Ternary {
  kind: 'Ternary';
  cond: Expr;
  whenTrue: Expr;
  whenFalse: Expr;
  line: number;
}
/** Конструктор: `Новый Массив`, `Новый Структура("А,Б", 1, 2)`. */
export interface New {
  kind: 'New';
  typeName: string;
  args: Expr[];
  line: number;
}
/** Обращение к свойству через точку: `Структура.Ключ`, `КлючИЗначение.Значение`. */
export interface Member {
  kind: 'Member';
  object: Expr;
  name: string;
  line: number;
}
/** Обращение по индексу/ключу: `Массив[0]`, `Соответствие[Ключ]`. */
export interface Index {
  kind: 'Index';
  object: Expr;
  index: Expr;
  line: number;
}
/** Вызов метода: `Массив.Добавить(Знач)`, `Структура.Количество()`. */
export interface MethodCall {
  kind: 'MethodCall';
  object: Expr;
  method: string;
  args: Expr[];
  line: number;
}

export type Expr =
  | NumberLit
  | StringLit
  | BoolLit
  | UndefinedLit
  | NullLit
  | Ident
  | Unary
  | Binary
  | Call
  | Ternary
  | New
  | Member
  | Index
  | MethodCall;

/** Допустимая левая часть присваивания. */
export type LValue = Ident | Member | Index;

export interface Param {
  name: string;
  byVal: boolean;
  default?: Expr;
}

export interface VarDecl {
  kind: 'VarDecl';
  names: string[];
  line: number;
}
export interface ProcDecl {
  kind: 'ProcDecl';
  name: string;
  params: Param[];
  body: Stmt[];
  isFunction: boolean;
  exported: boolean;
  line: number;
}
export interface Assign {
  kind: 'Assign';
  target: LValue;
  value: Expr;
  line: number;
}
/** Оператор-выражение: вызов с побочным эффектом (`Сообщить(…)`, `Массив.Добавить(…)`). */
export interface ExprStmt {
  kind: 'ExprStmt';
  expr: Expr;
  line: number;
}
export interface IfBranch {
  cond: Expr;
  body: Stmt[];
}
export interface If {
  kind: 'If';
  branches: IfBranch[];
  elseBody?: Stmt[];
  line: number;
}
export interface While {
  kind: 'While';
  cond: Expr;
  body: Stmt[];
  line: number;
}
export interface For {
  kind: 'For';
  varName: string;
  from: Expr;
  to: Expr;
  body: Stmt[];
  line: number;
}
/** `Для Каждого Элемент Из Коллекция Цикл … КонецЦикла`. */
export interface ForEach {
  kind: 'ForEach';
  varName: string;
  iterable: Expr;
  body: Stmt[];
  line: number;
}
export interface Return {
  kind: 'Return';
  value?: Expr;
  line: number;
}
export interface Break {
  kind: 'Break';
  line: number;
}
export interface Continue {
  kind: 'Continue';
  line: number;
}

export type Stmt =
  | VarDecl
  | ProcDecl
  | Assign
  | ExprStmt
  | If
  | While
  | For
  | ForEach
  | Return
  | Break
  | Continue;

export type Program = Stmt[];
