'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Employee { emp_pkey: number; first_name: string; last_name: string | null; emp_id: string }

interface HierarchyRow {
  emp_pkey: number;
  first_name: string;
  last_name: string | null;
  emp_id: string;
  branch_name: string | null;
  dept_name: string | null;
  desig_name: string | null;
  hirc_leval?: number | null;
}

export function HierarchyMover({ type, title, employees }: {
  type: 'HIERARCHY' | 'LAPPR';
  title: string;
  employees: Employee[];
}) {
  const queryClient = useQueryClient();
  const [parentId, setParentId] = useState<number | null>(null);
  const [parentSearch, setParentSearch] = useState('');
  const [availSearch, setAvailSearch] = useState('');
  const [checkedAvail, setCheckedAvail] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<{ available: HierarchyRow[]; assigned: HierarchyRow[] }>({
    queryKey: ['hierarchy', type, parentId],
    queryFn: () => fetch(`/api/employees/hierarchy?type=${type}&parentId=${parentId}`).then((r) => r.json()),
    enabled: parentId != null,
  });

  const mutate = useMutation({
    mutationFn: (extra: Record<string, unknown>) => fetch('/api/employees/hierarchy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, parentId, ...extra }),
    }).then(async (res) => {
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to save');
    }),
    onSuccess: () => {
      setCheckedAvail(new Set());
      queryClient.invalidateQueries({ queryKey: ['hierarchy', type, parentId] });
    },
  });

  const filteredParents = employees.filter((e) =>
    `${e.first_name} ${e.last_name ?? ''} ${e.emp_id}`.toLowerCase().includes(parentSearch.toLowerCase())
  );
  const available = (data?.available ?? []).filter((e) =>
    `${e.first_name} ${e.last_name ?? ''}`.toLowerCase().includes(availSearch.toLowerCase())
  );
  const assigned = data?.assigned ?? [];

  function toggleAvail(id: number) {
    setCheckedAvail((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function move(direction: 'up' | 'down', idx: number) {
    const order = assigned.map((a) => a.emp_pkey);
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= order.length) return;
    [order[idx], order[swapWith]] = [order[swapWith], order[idx]];
    mutate.mutate({ action: 'reorder', orderedEmpFkeys: order });
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Employees</p>
          <input
            placeholder="Search"
            value={parentSearch}
            onChange={(e) => setParentSearch(e.target.value)}
            className="w-full mb-2 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="h-72 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
            {filteredParents.map((e) => (
              <button
                key={e.emp_pkey}
                type="button"
                onClick={() => setParentId(e.emp_pkey)}
                className={`block w-full text-left px-2 py-1.5 text-sm hover:bg-gray-50 ${
                  parentId === e.emp_pkey ? 'bg-indigo-50 text-indigo-700 font-medium' : ''
                }`}
              >
                {e.first_name} {e.last_name ?? ''}
                <span className="text-gray-400 text-xs ml-1">({e.emp_id})</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Non-Allocated Employees</p>
          <input
            placeholder="Search"
            value={availSearch}
            onChange={(e) => setAvailSearch(e.target.value)}
            disabled={!parentId}
            className="w-full mb-2 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
          />
          <div className="h-72 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50">
            {!parentId && <p className="p-2 text-xs text-gray-400">Select an employee on the left first.</p>}
            {parentId && isLoading && <p className="p-2 text-xs text-gray-400">Loading…</p>}
            {available.map((e) => (
              <label key={e.emp_pkey} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={checkedAvail.has(e.emp_pkey)} onChange={() => toggleAvail(e.emp_pkey)} />
                <span className="flex-1">{e.first_name} {e.last_name ?? ''}</span>
                <span className="text-xs text-gray-400 truncate max-w-[6rem]">{e.desig_name}</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => mutate.mutate({ action: 'add', empFkeys: Array.from(checkedAvail) })}
            disabled={!checkedAvail.size || mutate.isPending}
            className="mt-2 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            Add to selected →
          </button>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Employees under selected employee</p>
          <div className="h-72 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-50 mt-[34px]">
            {assigned.map((e, idx) => (
              <div key={e.emp_pkey} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-gray-50">
                <span className="flex-1">{e.first_name} {e.last_name ?? ''}</span>
                {type === 'HIERARCHY' && (
                  <span className="flex flex-col leading-none">
                    <button type="button" onClick={() => move('up', idx)} disabled={idx === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs">▲</button>
                    <button type="button" onClick={() => move('down', idx)} disabled={idx === assigned.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs">▼</button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => mutate.mutate({ action: 'remove', empFkey: e.emp_pkey })}
                  className="text-red-500 hover:text-red-700 text-xs font-medium"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {mutate.isError && <p className="text-red-500 text-sm mt-3">{String(mutate.error)}</p>}
    </section>
  );
}
