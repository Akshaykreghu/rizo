'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Download, Play } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

interface Branch { id: number; branch_code: string; branch_name: string; status: number }

interface EpfContributionRow {
  emp_pkey: number;
  emp_name: string;
  uan: string;
  gross: number;
  epf_wages: number;
  eps_wages: number;
  edli_wages: number;
  epf_contribution: number;
  eps_contribution: number;
  epf_eps_diff: number;
  ncp_days: number;
  refund: number;
}

const COLUMNS: { key: keyof EpfContributionRow; label: string }[] = [
  { key: 'uan', label: 'UAN' }, { key: 'emp_name', label: 'Employee' },
  { key: 'gross', label: 'Gross' }, { key: 'epf_wages', label: 'EPF Wages' },
  { key: 'eps_wages', label: 'EPS Wages' }, { key: 'edli_wages', label: 'EDLI Wages' },
  { key: 'epf_contribution', label: 'EPF Contribution' }, { key: 'eps_contribution', label: 'EPS Contribution' },
  { key: 'epf_eps_diff', label: 'EPF-EPS Diff' }, { key: 'ncp_days', label: 'NCP Days' }, { key: 'refund', label: 'Refund' },
];

const CURRENCY_KEYS = new Set(['gross', 'epf_wages', 'eps_wages', 'edli_wages', 'epf_contribution', 'eps_contribution', 'epf_eps_diff']);

const TABLE_COLUMNS: ColumnDef<EpfContributionRow, unknown>[] = COLUMNS.map((c) => ({
  id: c.key,
  header: c.label,
  accessorFn: (row) => row[c.key],
  cell: ({ getValue }) => (
    <span className="whitespace-nowrap">
      {CURRENCY_KEYS.has(c.key) ? formatCurrency(Number(getValue() ?? 0)) : String(getValue() ?? '')}
    </span>
  ),
}));

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function toEcrText(rows: EpfContributionRow[]): string {
  return rows
    .map((r) => [r.uan, r.emp_name, r.gross, r.epf_wages, r.eps_wages, r.edli_wages, r.epf_contribution, r.eps_contribution, r.epf_eps_diff, r.ncp_days, r.refund].join('#~#'))
    .join('\r\n') + (rows.length > 0 ? '\r\n' : '');
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function StatutoryUploadPage() {
  const { slotEl } = useHeaderSlot();
  const [monthYear, setMonthYear] = useState(currentMonthYear());
  const [branch, setBranch] = useState('');
  const [rows, setRows] = useState<EpfContributionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/reports/statutory-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthYear, branch }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'Failed to generate report');
      return (b.rows ?? []) as EpfContributionRow[];
    },
    onSuccess: (r) => { setRows(r); setError(null); },
    onError: (err: Error) => setError(err.message),
  });

  function downloadEcr() {
    const blob = new Blob([toEcrText(rows)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `epfupload_${monthYear}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Statutory Upload
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              EPF Contribution — monthly ECR upload file
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
            <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[180px]')}>
              <option value="">All Branches</option>
              {(branches ?? []).filter((b) => b.status === 1).map((b) => (
                <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            <Play className="w-3.5 h-3.5" />
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {error && <p className="text-[12.5px] text-[color:var(--color-danger)]">{error}</p>}
        {rows.length > 0 && (
          <div className="flex gap-2">
            <button onClick={downloadEcr} className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}>
              <Download className="w-3.5 h-3.5" /> Download ECR File (.txt)
            </button>
          </div>
        )}
      </div>

      <DataTable
        data={rows}
        columns={TABLE_COLUMNS}
        pageSize={10}
        pageSizeOptions={[10, 20, 30, 50]}
        isLoading={generate.isPending}
      />
    </div>
  );
}
