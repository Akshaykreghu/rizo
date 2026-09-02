'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

interface AdvanceRow {
  emp_advance_pkey: number;
  emp_fkey: number;
  emp_name: string;
  advance_amount: number;
  affected_month: string;
  is_credited: string;
  remarks: string | null;
  payment_date: string | null;
}

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function AdvancesPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonthYear());
  const [showForm, setShowForm] = useState(false);
  const [empId, setEmpId] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [affectedMonth, setAffectedMonth] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const { data: limitData } = useQuery<{ limit: number }>({
    queryKey: ['advances/limit', empId],
    queryFn: () => fetch(`/api/advances/limit?empFkey=${empId}`).then((r) => r.json()),
    enabled: !!empId,
  });

  const { data, isLoading } = useQuery<{ rows: AdvanceRow[] }>({
    queryKey: ['advances', month],
    queryFn: () => fetch(`/api/advances?month=${month}`).then((r) => r.json()),
  });
  const rows = data?.rows ?? [];

  useEffect(() => { if (!affectedMonth) setAffectedMonth(month); }, [month, affectedMonth]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/advances', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(empId), advanceAmount: Number(advanceAmount), affectedMonth, remarks: remarks || undefined,
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to create advance');
      return b as { id: number; warning?: string };
    },
    onSuccess: (b) => {
      setMessage(b.warning ?? 'Advance saved.');
      setShowForm(false);
      setEmpId(''); setAdvanceAmount(''); setAffectedMonth(''); setRemarks('');
      queryClient.invalidateQueries({ queryKey: ['advances'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`/api/advances/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setMessage('Advance removed.');
      queryClient.invalidateQueries({ queryKey: ['advances'] });
    },
  });

  const columns: ColumnDef<AdvanceRow, unknown>[] = [
    { accessorKey: 'emp_name', header: 'Employee', cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue())}</span> },
    { id: 'amount', header: 'Amount', cell: ({ row }) => formatCurrency(row.original.advance_amount) },
    { accessorKey: 'affected_month', header: 'Affected Month' },
    { id: 'remarks', header: 'Remarks', cell: ({ row }) => row.original.remarks || '-' },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-14' },
      cell: ({ row }) => (
        <button
          onClick={(e) => { e.stopPropagation(); remove.mutate(row.original.emp_advance_pkey); }}
          title="Remove"
          className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Salary Advances
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Record and track employee salary advances, by month
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => setShowForm((v) => !v)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" />
          New Advance
        </button>
      </div>

      {message && <p className="text-[12.5px] text-slate-500 mb-4">{message}</p>}

      {showForm && (
        <div className="surface-card rounded-xl p-4 mb-4 space-y-3">
          <div className="max-w-sm">
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
            <EmployeeSearch value={empId} onChange={setEmpId} placeholder="Search employee by name or ID" />
            {empId && limitData && (
              <p className="text-[11.5px] text-slate-400 mt-1">Suggested limit (80% of monthly gross): {formatCurrency(limitData.limit)}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Advance Amount (₹)</label>
              <input type="number" value={advanceAmount} onChange={(e) => setAdvanceAmount(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Affected Month</label>
              <input type="month" value={affectedMonth} onChange={(e) => setAffectedMonth(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
            <div className="col-span-2">
              <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Remarks</label>
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
            </div>
          </div>
          <button
            onClick={() => create.mutate()}
            disabled={!empId || !advanceAmount || !affectedMonth || create.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            {create.isPending ? 'Saving…' : 'Save Advance'}
          </button>
        </div>
      )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 max-w-xs">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={cn(INPUT_CLASS, 'w-full')} />
      </div>

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
    </div>
  );
}
