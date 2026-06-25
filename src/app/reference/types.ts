/** Запись справочника — структурные факты из синтакс-помощника (см. reference/README.md). */
export interface SyntaxParam {
  name: string;
  type: string | null;
  optional: boolean;
}

export interface SyntaxEntry {
  owner: string;
  ownerEn: string;
  kind: 'function' | 'method' | 'property' | 'event';
  /** Учебная категория: Строки, Даты, Числа, Коллекции, Прочее… */
  category: string;
  nameRu: string;
  nameEn: string;
  signature: string | null;
  params: SyntaxParam[];
  returnType: string | null;
  /** Текстовые контексты, как в HTML (для UI/тулипа). */
  availability: string[];
  /** Нормализованные ключи контекстов для фильтра/сравнения. */
  availabilityKeys: string[];
  /** Версия платформы «начиная с» (`"8.3.18"`). `null` — не указана. */
  since: string | null;
  /** Публичная ссылка на онлайн-синтакс-помощник 1С с описанием/примерами. */
  referenceUrl: string | null;
  /**
   * Наше короткое описание (BSLexicon, ЭТО НЕ ТЕКСТ 1С). `null` — нет.
   * Берётся из курированного `catalog/` при extract-этапе.
   */
  bslNote?: string | null;
  /** Наш doctest-проверенный пример. `null` — нет. */
  bslExample?: { code: string; expect?: string } | null;
}
