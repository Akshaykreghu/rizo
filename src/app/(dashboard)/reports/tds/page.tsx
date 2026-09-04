'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useSetupRows } from '@/lib/setupOptions';
import { Download } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

interface Branch {
  id: number;
  branch_code: string;
  branch_name: string;
}
interface TdsRow {
  emp_fkey: number;
  first_name: string;
  last_name: string | null;
  emp_branch: string;
  taxable_income: number;
  tax_yearly: number;
  tax_monthly_proj: number;
  regime: 'Old' | 'New';
}

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function TdsReportPage() {
  const { slotEl } = useHeaderSlot();
  const [branch, setBranch] = useState('');
  const [month, setMonth] = useState(currentMonthYear());

  const { data: branches = [] } = useSetupRows<Branch>('setup/branches');

  const { data, isLoading } = useQuery<{ rows: TdsRow[] }>({
    queryKey: ['reports/tds', branch, month],
    queryFn: () => fetch(`/api/reports/tds?branch=${branch}&month=${month}`).then((r) => r.json()),
    enabled: !!month,
  });
  const rows = data?.rows ?? [];

  const columns: ColumnDef<TdsRow, unknown>[] = [
    { id: 'employee', header: 'Employee', cell: ({ row }) => <span className="font-medium text-[#0F172A]">{row.original.first_name} {row.original.last_name ?? ''}</span> },
    { accessorKey: 'emp_branch', header: 'Branch' },
    { accessorKey: 'regime', header: 'Regime' },
    { id: 'taxableIncome', header: 'Taxable Income', cell: ({ row }) => formatCurrency(row.original.taxable_income) },
    { id: 'yearlyTax', header: 'Yearly Tax', cell: ({ row }) => formatCurrency(row.original.tax_yearly) },
    { id: 'monthlyTds', header: 'Monthly TDS', cell: ({ row }) => <span className="font-medium text-[#0F172A]">{formatCurrency(row.original.tax_monthly_proj)}</span> },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              TDS Report
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Projected tax deducted at source, by employee and month
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[180px]')}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.branch_code}>{b.branch_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        <a
          href={`/api/reports/tds/export?branch=${branch}&month=${month}`}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Download className="w-3.5 h-3.5" />
          Export Excel
        </a>
      </div>

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />
    </div>
  );
}
