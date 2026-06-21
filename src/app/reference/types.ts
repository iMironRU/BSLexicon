/** Запись справочника — структурные факты из синтакс-помощника (см. reference/README.md). */
export interface SyntaxParam {
  name: string;
  type: string | null;
  optional: boolean;
}

export interface SyntaxEntry {
  owner: string;
  ownerEn: string;
  kind: 'function' | 'method' | 'property';
  /** Учебная категория: Строки, Даты, Числа, Коллекции, Прочее… */
  category: string;
  nameRu: string;
  nameEn: string;
  signature: string | null;
  params: SyntaxParam[];
  returnType: string | null;
  availability: string[];
}
