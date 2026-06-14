import { UNDEFINED } from './values';
import type { BslValue } from './values';

/**
 * Область видимости. Имена BSL регистронезависимы, поэтому ключи храним
 * в нижнем регистре, а исходное написание — для панели переменных.
 */
export class Scope {
  private readonly values = new Map<string, BslValue>();
  private readonly displayNames = new Map<string, string>();

  constructor(private readonly parent: Scope | null = null) {}

  declare(name: string, value: BslValue = UNDEFINED): void {
    const key = name.toLowerCase();
    this.values.set(key, value);
    if (!this.displayNames.has(key)) this.displayNames.set(key, name);
  }

  has(name: string): boolean {
    return this.values.has(name.toLowerCase()) || (this.parent?.has(name) ?? false);
  }

  get(name: string): BslValue | undefined {
    const key = name.toLowerCase();
    if (this.values.has(key)) return this.values.get(key);
    return this.parent?.get(name);
  }

  /** Присваивание: меняем в ближайшей области, где имя объявлено, иначе создаём здесь. */
  set(name: string, value: BslValue): void {
    const key = name.toLowerCase();
    let scope: Scope | null = this;
    while (scope) {
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
    return [...this.values.entries()].map(([key, value]) => ({
      name: this.displayNames.get(key) ?? key,
      value,
    }));
  }
}
