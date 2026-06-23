import { UNDEFINED } from './values';
import type { BslValue } from './values';

/**
 * Область видимости. Имена BSL регистронезависимы, поэтому ключи храним
 * в нижнем регистре, а исходное написание — для панели переменных.
 *
 * Алиасы — для параметров процедур, переданных по ссылке (без `Знач`):
 * имя параметра указывает на переменную вызывающего, любой `get`/`set`
 * прозрачно пробрасывается туда. Учебный акцент §4.
 */
export class Scope {
  private readonly values = new Map<string, BslValue>();
  private readonly displayNames = new Map<string, string>();
  private readonly aliases = new Map<string, { scope: Scope; name: string }>();

  constructor(private readonly parent: Scope | null = null) {}

  declare(name: string, value: BslValue = UNDEFINED): void {
    const key = name.toLowerCase();
    this.values.set(key, value);
    if (!this.displayNames.has(key)) this.displayNames.set(key, name);
  }

  /** Объявить имя как ссылку (алиас) на переменную другой области. */
  declareAlias(name: string, target: Scope, targetName: string): void {
    const key = name.toLowerCase();
    this.aliases.set(key, { scope: target, name: targetName });
    if (!this.displayNames.has(key)) this.displayNames.set(key, name);
  }

  has(name: string): boolean {
    const key = name.toLowerCase();
    return (
      this.values.has(key) ||
      this.aliases.has(key) ||
      (this.parent?.has(name) ?? false)
    );
  }

  get(name: string): BslValue | undefined {
    const key = name.toLowerCase();
    const alias = this.aliases.get(key);
    if (alias) return alias.scope.get(alias.name);
    if (this.values.has(key)) return this.values.get(key);
    return this.parent?.get(name);
  }

  /** Присваивание: алиас → в источник; иначе ближайшая область с именем; иначе создаём здесь. */
  set(name: string, value: BslValue): void {
    const key = name.toLowerCase();
    let scope: Scope | null = this;
    while (scope) {
      const alias = scope.aliases.get(key);
      if (alias) {
        alias.scope.set(alias.name, value);
        return;
      }
      if (scope.values.has(key)) {
        scope.values.set(key, value);
        return;
      }
      scope = scope.parent;
    }
    this.declare(name, value);
  }

  /** Снимок локальных переменных области (для инспекции). */
  entries(): { name: string; value: BslValue }[] {
    const keys = new Set<string>([...this.values.keys(), ...this.aliases.keys()]);
    return [...keys].map((key) => ({
      name: this.displayNames.get(key) ?? key,
      value: this.get(key) ?? UNDEFINED,
    }));
  }
}
