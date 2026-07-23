'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { MenuTree, type MenuNode } from '@/components/employees/MenuTree';

interface MenuAllocationData {
  tree: MenuNode[];
  assigned: number[];
}

export default function MenuAllocationPage() {
  const queryClient = useQueryClient();
  const [empFkey, setEmpFkey] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<MenuAllocationData>({
    queryKey: ['employees/menu-allocation', empFkey],
    queryFn: () => fetch(`/api/employees/menu-allocation/${empFkey}`).then((r) => r.json()),
    enabled: !!empFkey,
  });

  useEffect(() => {
    if (data?.assigned) setChecked(new Set(data.assigned));
  }, [data]);

  const save = useMutation({
    mutationFn: () => fetch(`/api/employees/menu-allocation/${empFkey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_ids: Array.from(checked) }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees/menu-allocation', empFkey] }),
  });

  function toggle(menuId: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(menuId)) next.delete(menuId);
      else next.add(menuId);
      return next;
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Menu Allocation</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl">
        <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
        <EmployeeSearch
          value={empFkey}
          onChange={(v) => { setEmpFkey(v); setChecked(new Set()); }}
        />

        {empFkey && (
          <div className="mt-6">
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading menu tree…</p>
            ) : (
              <>
                <div className="max-h-96 overflow-y-auto border border-gray-100 rounded-lg p-3">
                  <MenuTree nodes={data?.tree ?? []} checked={checked} onToggle={toggle} />
                </div>
                <button
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                  className="mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {save.isPending ? 'Saving…' : 'Save Menu Access'}
                </button>
                {save.isSuccess && <span className="ml-3 text-sm text-emerald-600">Saved</span>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
