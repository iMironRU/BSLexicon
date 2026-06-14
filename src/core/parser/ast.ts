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
  | Ternary;

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
  target: string;
  value: Expr;
  line: number;
}
export interface CallStmt {
  kind: 'CallStmt';
  call: Call;
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
  | CallStmt
  | If
  | While
  | For
  | Return
  | Break
  | Continue;

export type Program = Stmt[];
