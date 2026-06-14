/**
 * Канонические виды ключевых слов BSL.
 * BSL двуязычен и регистронезависим — каждое ключевое слово имеет русское
 * и английское написание, ведущие к одному `KeywordKind`.
 */
export type KeywordKind =
  | 'Var'
  | 'Procedure'
  | 'EndProcedure'
  | 'Function'
  | 'EndFunction'
  | 'Export'
  | 'Val'
  | 'If'
  | 'Then'
  | 'ElsIf'
  | 'Else'
  | 'EndIf'
  | 'For'
  | 'To'
  | 'Each'
  | 'In'
  | 'While'
  | 'Do'
  | 'EndDo'
  | 'Break'
  | 'Continue'
  | 'Return'
  | 'Try'
  | 'Except'
  | 'EndTry'
  | 'Raise'
  | 'True'
  | 'False'
  | 'Undefined'
  | 'Null'
  | 'And'
  | 'Or'
  | 'Not'
  | 'New';

/**
 * Соответствие «написание (в нижнем регистре) → вид».
 * Регистронезависимость обеспечивается приведением идентификатора к нижнему
 * регистру перед поиском в этой таблице.
 */
export const KEYWORDS: ReadonlyMap<string, KeywordKind> = new Map([
  // Объявления
  ['перем', 'Var'],
  ['var', 'Var'],
  ['процедура', 'Procedure'],
  ['procedure', 'Procedure'],
  ['конецпроцедуры', 'EndProcedure'],
  ['endprocedure', 'EndProcedure'],
  ['функция', 'Function'],
  ['function', 'Function'],
  ['конецфункции', 'EndFunction'],
  ['endfunction', 'EndFunction'],
  ['экспорт', 'Export'],
  ['export', 'Export'],
  ['знач', 'Val'],
  ['val', 'Val'],
  // Условие
  ['если', 'If'],
  ['if', 'If'],
  ['тогда', 'Then'],
  ['then', 'Then'],
  ['иначеесли', 'ElsIf'],
  ['elsif', 'ElsIf'],
  ['иначе', 'Else'],
  ['else', 'Else'],
  ['конецесли', 'EndIf'],
  ['endif', 'EndIf'],
  // Циклы
  ['для', 'For'],
  ['for', 'For'],
  ['по', 'To'],
  ['to', 'To'],
  ['каждого', 'Each'],
  ['each', 'Each'],
  ['из', 'In'],
  ['in', 'In'],
  ['пока', 'While'],
  ['while', 'While'],
  ['цикл', 'Do'],
  ['do', 'Do'],
  ['конеццикла', 'EndDo'],
  ['enddo', 'EndDo'],
  ['прервать', 'Break'],
  ['break', 'Break'],
  ['продолжить', 'Continue'],
  ['continue', 'Continue'],
  ['возврат', 'Return'],
  ['return', 'Return'],
  // Исключения
  ['попытка', 'Try'],
  ['try', 'Try'],
  ['исключение', 'Except'],
  ['except', 'Except'],
  ['конецпопытки', 'EndTry'],
  ['endtry', 'EndTry'],
  ['вызватьисключение', 'Raise'],
  ['raise', 'Raise'],
  // Литералы-слова
  ['истина', 'True'],
  ['true', 'True'],
  ['ложь', 'False'],
  ['false', 'False'],
  ['неопределено', 'Undefined'],
  ['undefined', 'Undefined'],
  ['null', 'Null'],
  // Логические операторы
  ['и', 'And'],
  ['and', 'And'],
  ['или', 'Or'],
  ['or', 'Or'],
  ['не', 'Not'],
  ['not', 'Not'],
  // Конструктор
  ['новый', 'New'],
  ['new', 'New'],
]);
