'use client';

export interface MenuNode {
  menu_id: number;
  menu_title: string;
  children: MenuNode[];
}

interface MenuTreeProps {
  nodes: MenuNode[];
  checked: Set<number>;
  onToggle: (menuId: number) => void;
}

export function MenuTree({ nodes, checked, onToggle }: MenuTreeProps) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <li key={node.menu_id}>
          <label className="flex items-center gap-2 text-sm py-1 hover:bg-gray-50 rounded px-1 cursor-pointer">
            <input type="checkbox" checked={checked.has(node.menu_id)} onChange={() => onToggle(node.menu_id)} />
            <span className={node.children.length ? 'font-medium text-gray-900' : 'text-gray-700'}>{node.menu_title}</span>
          </label>
          {node.children.length > 0 && (
            <div className="ml-6 border-l border-gray-100 pl-3">
              <MenuTree nodes={node.children} checked={checked} onToggle={onToggle} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
