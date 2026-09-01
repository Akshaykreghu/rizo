'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';

interface ShiftListItem {
  day_time_seq: number;
  day_time_desc: string;
  active: number;
  isnextday: number;
  ot_eligibility_threshold: string;
  minuts_calc_perday: number;
}

export function ShiftsPanel() {
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data = [], isLoading } = useQuery<ShiftListItem[]>({
    queryKey: ['setup/shifts'],
    queryFn: () => fetch('/api/setup/shifts').then((r) => r.json()),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/setup/shifts/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/shifts'] });
      setDeleteConfirm(null);
    },
  });

  const columns: ColumnDef<ShiftListItem, unknown>[] = [
    { accessorKey: 'day_time_desc', header: 'Name', cell: ({ getValue }) => <span className="text-[#0F172A]">{String(getValue())}</span> },
    { id: 'active', header: 'Active', cell: ({ row }) => (row.original.active ? 'Yes' : 'No') },
    { id: 'nextDay', header: 'Next Day', cell: ({ row }) => (row.original.isnextday ? 'Yes' : 'No') },
    { accessorKey: 'minuts_calc_perday', header: 'Minutes/Day' },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-24' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/setup/shifts/${row.original.day_time_seq}`}
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Link>
          {deleteConfirm === row.original.day_time_seq ? (
            <span className="flex items-center gap-1.5 text-xs pl-1">
              <button
                onClick={(e) => { e.stopPropagation(); remove.mutate(row.original.day_time_seq); }}
                className="font-medium text-[color:var(--color-danger)] hover:underline"
              >
                Confirm
              </button>
              <span className="text-slate-300">·</span>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                className="text-slate-500 hover:underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(row.original.day_time_seq); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-end mb-5">
        <Link
          href="/setup/shifts/new"
          className="flex items-center gap-2 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          Add New
        </Link>
      </div>

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
