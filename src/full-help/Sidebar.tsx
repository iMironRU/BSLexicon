import { useEffect, useMemo, useState } from 'react';
import type { TreeNode } from './tree';

interface SidebarProps {
  tree: TreeNode[];
  /** Имя текущего активного owner-а (или null) — для подсветки. */
  activeOwner: string | null;
  /** Формирует href для перехода на owner. */
  ownerHref: (ownerName: string) => string;
}

/**
 * Дерево разделов полного СП. Категории-папки сворачиваемые; ветка с
 * активным owner-ом авто-разворачивается. Лист — owner — это ссылка
 * на страницу `#/owner/<имя>`.
 */
export function Sidebar({ tree, activeOwner, ownerHref }: SidebarProps) {
  // Найдём catalog-узлы на пути к активному owner-у — их открываем.
  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    if (activeOwner) {
      collectPathTo(tree, activeOwner, set);
    } else {
      // Первый уровень категорий открыт по умолчанию — иначе пользователь
      // видит просто несколько слов и не понимает что внутри.
      for (const n of tree) if (!n.isOwner) set.add(n.id);
    }
    return set;
  }, [tree, activeOwner]);

  const [open, setOpen] = useState<Set<string>>(initialOpen);

  // При смене активного owner-а добавляем его путь к раскрытым.
  useEffect(() => {
    if (!activeOwner) return;
    const path = new Set<string>();
    if (collectPathTo(tree, activeOwner, path)) {
      let changed = false;
      const next = new Set(open);
      for (const id of path) if (!next.has(id)) { next.add(id); changed = true; }
      if (changed) setOpen(next);
    }
  }, [tree, activeOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string): void => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };

  return (
    <nav className="sb" aria-label="Дерево разделов полного СП">
      <a className={'sb__home' + (activeOwner === null ? ' sb__home--active' : '')} href="#/">
        Главная
      </a>
      <ul className="sb__list">
        {tree.map((n) => (
          <TreeNodeView
            key={n.id}
            node={n}
            open={open}
            onToggle={toggle}
            activeOwner={activeOwner}
            ownerHref={ownerHref}
            depth={0}
          />
        ))}
      </ul>
    </nav>
  );
}

interface NodeViewProps {
  node: TreeNode;
  open: Set<string>;
  onToggle: (id: string) => void;
  activeOwner: string | null;
  ownerHref: (ownerName: string) => string;
  depth: number;
}

function TreeNodeView({ node, open, onToggle, activeOwner, ownerHref, depth }: NodeViewProps) {
  if (node.isOwner) {
    const active = node.ownerName === activeOwner;
    return (
      <li>
        <a
          className={'sb__entry' + (active ? ' sb__entry--active' : '')}
          href={ownerHref(node.ownerName ?? '')}
          style={{ paddingLeft: `${10 + depth * 12}px` }}
        >
          {node.label}
        </a>
      </li>
    );
  }
  const isOpen = open.has(node.id);
  return (
    <li className="sb__group">
      <button
        type="button"
        className={'sb__groupHead' + (isOpen ? ' sb__groupHead--open' : '')}
        onClick={() => onToggle(node.id)}
        aria-expanded={isOpen}
        style={{ paddingLeft: `${10 + depth * 12}px` }}
      >
        <span className="sb__chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
        <span className="sb__groupName">{node.label}</span>
        <span className="sb__groupCount">{node.ownerCount}</span>
      </button>
      {isOpen && (
        <ul className="sb__entries" style={{ paddingLeft: 0 }}>
          {node.children.map((c) => (
            <TreeNodeView
              key={c.id}
              node={c}
              open={open}
              onToggle={onToggle}
              activeOwner={activeOwner}
              ownerHref={ownerHref}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Заполняет `out` set'ом catalog-id всех узлов на пути от корня до owner-а. */
function collectPathTo(nodes: TreeNode[], ownerName: string, out: Set<string>): boolean {
  for (const n of nodes) {
    if (n.isOwner) {
      if (n.ownerName === ownerName) return true;
      continue;
    }
    if (collectPathTo(n.children, ownerName, out)) {
      out.add(n.id);
      return true;
    }
  }
  return false;
}
