'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DataTable } from '@/components/data-table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';

interface LeaveType {
  salary_head_item_pkey: number;
  item: string;
  occurance: string;
  value: 'Y' | 'N';
}

export function LeaveTypesPanel() {
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery<LeaveType[]>({
    queryKey: ['setup/leave-types'],
    queryFn: () => fetch('/api/setup/leave-types').then((r) => r.json()),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, value }: { id: number; value: 'Y' | 'N' }) => {
      const res = await fetch(`/api/setup/leave-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['setup/leave-types'] }),
  });

  const columns: ColumnDef<LeaveType, unknown>[] = [
    { accessorKey: 'item', header: 'Leave Type', cell: ({ getValue }) => <span className="text-[#0F172A]">{String(getValue()).trim()}</span> },
    { accessorKey: 'occurance', header: 'Code' },
    {
      id: 'enabled',
      header: 'Enabled',
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={row.original.value === 'Y'}
              onChange={(e) =>
                toggle.mutate({
                  id: row.original.salary_head_item_pkey,
                  value: e.target.checked ? 'Y' : 'N',
                })
              }
              className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
            />
          </label>
        </div>
      ),
    },
  ];

  return (
    <div>
      <p className="text-sm text-slate-500 mb-5">
        Enable the leave types this company uses. Only enabled types are available when building Leave Policies.
      </p>

      <DataTable
        data={data}
        columns={columns}
        pageSize={10}
        pageSizeOptions={[10, 20, 30, 50]}
        isLoading={isLoading}
      />
    </div>
  );
}
