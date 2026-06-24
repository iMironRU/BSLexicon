/**
 * Построение древовидной иерархии разделов полного синтакс-помощника
 * из карт `ownerPaths` и `categoryNames` (см. `extract-hbk-full.ts`).
 *
 * Узел дерева — либо catalog-категория (например, «Общие объекты»),
 * либо лист-владелец (например, «ТабличныйДокумент»). Глобальный
 * контекст и owner-ы без catalog-пути показываются на верхнем уровне.
 */

export interface TreeNode {
  /** Технический id узла: 'catalog<N>' для категорий, 'owner:<имя>' для типов. */
  id: string;
  /** Человекочитаемое имя. */
  label: string;
  /** `true` для owner-ов (на них кликаем в карточку), `false` для категорий. */
  isOwner: boolean;
  /** Имя owner-а (только для isOwner=true) — для построения URL. */
  ownerName?: string;
  children: TreeNode[];
  /** Сколько owner-ов в этом узле и его потомках (для подписи). */
  ownerCount: number;
}

export interface BuildTreeArgs {
  ownerPaths: Record<string, string[]>;
  categoryNames: Record<string, string>;
  /** Кол-во записей у каждого owner — для сортировки/подписи. */
  entriesByOwner: Map<string, number>;
}

/** Узел верхнего уровня для owner-ов вне catalog-дерева (Global context и редкие). */
const ROOT_OTHER_KEY = '__other__';

export function buildTree(args: BuildTreeArgs): TreeNode[] {
  const { ownerPaths, categoryNames } = args;

  // Виртуальный корень — список верхнеуровневых детей.
  const root: TreeNode = { id: '__root__', label: 'root', isOwner: false, children: [], ownerCount: 0 };
  const other: TreeNode = {
    id: ROOT_OTHER_KEY,
    label: 'Прочее',
    isOwner: false,
    children: [],
    ownerCount: 0,
  };

  // catalog-id → узел в дереве. Используем плоский map для быстрого доступа
  // при инкрементальном построении.
  const nodes = new Map<string, TreeNode>();

  function ensureCategoryChain(path: string[]): TreeNode {
    let parent = root;
    for (const cat of path) {
      let node = nodes.get(cat);
      if (!node) {
        node = {
          id: cat,
          label: categoryNames[cat] ?? cat,
          isOwner: false,
          children: [],
          ownerCount: 0,
        };
        nodes.set(cat, node);
        parent.children.push(node);
      }
      parent = node;
    }
    return parent;
  }

  for (const [ownerName, path] of Object.entries(ownerPaths)) {
    const ownerNode: TreeNode = {
      id: `owner:${ownerName}`,
      label: ownerName,
      isOwner: true,
      ownerName,
      children: [],
      ownerCount: 1,
    };
    if (path.length === 0) {
      // Без catalog-пути (Global context и некоторые) — отдельная группа.
      other.children.push(ownerNode);
    } else {
      const parent = ensureCategoryChain(path);
      parent.children.push(ownerNode);
    }
  }

  // Считаем ownerCount снизу вверх + сортируем (категории по label, owner-ы по label).
  function finalize(node: TreeNode): number {
    if (node.isOwner) return node.ownerCount;
    let total = 0;
    for (const c of node.children) total += finalize(c);
    node.ownerCount = total;
    // категории — впереди, owner-ы — после; внутри — по алфавиту.
    node.children.sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? 1 : -1;
      return a.label.localeCompare(b.label, 'ru');
    });
    return total;
  }
  for (const c of root.children) finalize(c);
  if (other.children.length > 0) {
    finalize(other);
    root.children.push(other);
  }
  root.children.sort((a, b) => {
    if (a.id === ROOT_OTHER_KEY) return 1; // «Прочее» — в конец
    if (b.id === ROOT_OTHER_KEY) return -1;
    return a.label.localeCompare(b.label, 'ru');
  });
  return root.children;
}
