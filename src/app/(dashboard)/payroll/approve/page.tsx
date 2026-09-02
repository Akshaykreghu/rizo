'use client';

import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Undo2, FileText } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn, formatCurrency } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { SalarySlipModal } from '@/components/payroll/SalarySlipModal';

interface Branch {
  id: number;
  branch_code: string;
  branch_name: string;
}

interface Employee {
  emp_pkey: number;
  first_name: string;
  last_name: string;
  emp_id: string;
}

interface PayrollRow {
  payroll_master_pkey: number;
  emp_fkey: number;
  emp_name: string;
  days_presant: number | null;
  days_leave: number | null;
  loss_of_pay: number | null;
  monthly_ctc: number | null;
  monthly_amount: number | null;
  calander_days: number | null;
  working_days: number | null;
  gross_salary: number | null;
  net_salary: number | null;
  total_deductions: number | null;
  action: string | null;
  resigned: boolean;
  last_month_net_salary: number | null;
}

const TABS = [
  { key: 'processed', label: 'Ready to Approve' },
  { key: 'approved', label: 'Approved' },
] as const;

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ApprovePayrollContent() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState('');
  const [month, setMonth] = useState(currentMonthYear());
  const [employee, setEmployee] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('processed');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [slipId, setSlipId] = useState<number | null>(null);

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const { data: employeesResp } = useQuery<{ data: Employee[] }>({
    queryKey: ['employees', branch],
    queryFn: () => fetch(`/api/employees?branch=${branch}&status=1&pageSize=1000`).then((r) => r.json()),
    enabled: !!branch,
  });
  const employees = employeesResp?.data ?? [];

  const { data, isLoading } = useQuery<{ rows: PayrollRow[] }>({
    queryKey: ['payroll', branch, month, tab, employee],
    queryFn: () =>
      fetch(`/api/payroll?branch=${branch}&month=${month}&status=${tab}&employee=${employee}`).then((r) => r.json()),
    enabled: !!branch && !!month,
  });
  const rows = data?.rows ?? [];

  // Mirrors legacy's rowStyler in showapprovepayrolltab.ctp: resigned/separated employees get red
  // text in both tabs (no net-salary highlight here, unlike Process Payroll's tabs).
  function rowClass(row: PayrollRow) {
    return row.resigned ? 'text-[color:var(--color-danger)]' : '';
  }

  function toggle(pkey: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(pkey) ? next.delete(pkey) : next.add(pkey);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.payroll_master_pkey))));
  }

  function onBulkSuccess(b: { errors?: { payroll_master_pkey: number; error: string }[] }) {
    setSelected(new Set());
    setMessage(b.errors?.length ? `Done with ${b.errors.length} error(s) — see console.` : 'Done.');
    if (b.errors?.length) console.error('Payroll action errors:', b.errors);
    queryClient.invalidateQueries({ queryKey: ['payroll'] });
  }
  function onBulkError(err: Error) {
    setMessage(err.message);
  }
  async function postAction(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const b = await res.json();
    if (!res.ok) throw new Error(b.error ?? 'Action failed');
    return b;
  }

  const approve = useMutation({
    mutationFn: () => postAction('/api/payroll/approve', { ids: Array.from(selected) }),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });
  const reprocess = useMutation({
    mutationFn: () => postAction('/api/payroll/reprocess', { ids: Array.from(selected) }),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });

  const selectColumn: ColumnDef<PayrollRow, unknown> = {
    id: 'select',
    header: () => (
      <input
        type="checkbox"
        checked={!!rows.length && selected.size === rows.length}
        onChange={toggleAll}
        className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
      />
    ),
    meta: { className: 'w-10' },
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={selected.has(row.original.payroll_master_pkey)}
        onChange={(e) => { e.stopPropagation(); toggle(row.original.payroll_master_pkey); }}
        onClick={(e) => e.stopPropagation()}
        className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
      />
    ),
  };

  // Mirrors showapprovepayrolltab.ctp exactly: tab 0 (Ready to Approve) has View Slip and Last
  // Month Salary; tab 1 (Approved) has neither — legacy doesn't offer a slip view once approved.
  const nameColumn: ColumnDef<PayrollRow, unknown> = {
    accessorKey: 'emp_name',
    header: 'Employee',
    cell: ({ row }) => (
      <span className="font-medium">
        {row.original.emp_name}
        {row.original.resigned && <span className="ml-2 text-[11px]">(separated)</span>}
      </span>
    ),
  };

  const sharedColumns: ColumnDef<PayrollRow, unknown>[] = [
    nameColumn,
    { id: 'present', header: 'Present', cell: ({ row }) => row.original.days_presant ?? '-' },
    { id: 'days_leave', header: 'Days on Leave', cell: ({ row }) => row.original.days_leave ?? '-' },
    { id: 'lop', header: 'LOP', cell: ({ row }) => row.original.loss_of_pay ?? '-' },
    { id: 'monthly_ctc', header: 'Monthly CTC', cell: ({ row }) => row.original.monthly_ctc != null ? formatCurrency(row.original.monthly_ctc) : '-' },
    { id: 'monthly_amount', header: 'Monthly Amount', cell: ({ row }) => row.original.monthly_amount != null ? formatCurrency(row.original.monthly_amount) : '-' },
    { id: 'gross', header: 'Gross', cell: ({ row }) => row.original.gross_salary != null ? formatCurrency(row.original.gross_salary) : '-' },
    { id: 'deductions', header: 'Deductions', cell: ({ row }) => row.original.total_deductions != null ? formatCurrency(row.original.total_deductions) : '-' },
    { id: 'net', header: 'Net', cell: ({ row }) => <span className="font-medium">{row.original.net_salary != null ? formatCurrency(row.original.net_salary) : '-'}</span> },
    { id: 'calander_days', header: 'Calendar Days', cell: ({ row }) => row.original.calander_days ?? '-' },
    { id: 'working_days', header: 'Working Days', cell: ({ row }) => row.original.working_days ?? '-' },
  ];

  const processedColumns: ColumnDef<PayrollRow, unknown>[] = [
    selectColumn,
    {
      id: 'slip',
      header: '',
      meta: { className: 'w-14' },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <button
            onClick={(e) => { e.stopPropagation(); setSlipId(row.original.payroll_master_pkey); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150 inline-flex"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
    ...sharedColumns,
    { id: 'prev_net', header: 'Last Month Salary', cell: ({ row }) => row.original.last_month_net_salary != null ? formatCurrency(row.original.last_month_net_salary) : '-' },
  ];

  const approvedColumns: ColumnDef<PayrollRow, unknown>[] = [...sharedColumns];

  const columns = tab === 'processed' ? processedColumns : approvedColumns;

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Approve Payroll
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Review processed payroll and approve or send back to pending
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[160px]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select
            value={branch}
            onChange={(e) => { setBranch(e.target.value); setEmployee(''); setSelected(new Set()); }}
            className={cn(INPUT_CLASS, 'w-full')}
          >
            <option value="">Select branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.branch_code}>{b.branch_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => { setMonth(e.target.value); setSelected(new Set()); }}
            className={INPUT_CLASS}
          />
        </div>
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-4">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelected(new Set()); }}
              className={cn(
                'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                tab === t.key
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {branch && month && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-center gap-3">
          {tab === 'processed' && (
            <button
              onClick={() => approve.mutate()}
              disabled={!selected.size || approve.isPending}
              className={cn(BTN_BASE, 'bg-[color:var(--color-success)] hover:bg-[color:var(--color-success-dark)] text-white')}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {approve.isPending ? 'Approving…' : `Approve ${selected.size || ''}`}
            </button>
          )}
          {tab === 'processed' && (
            <button
              onClick={() => reprocess.mutate()}
              disabled={!selected.size || reprocess.isPending}
              className={cn(BTN_BASE, 'bg-slate-600 hover:bg-slate-700 text-white')}
            >
              <Undo2 className="w-3.5 h-3.5" />
              Send back to Pending
            </button>
          )}
          <div className="min-w-[200px] ml-auto">
            <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Select Employee</label>
            <select
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
              className={cn(INPUT_CLASS, 'w-full')}
            >
              <option value="">--All--</option>
              {employees.map((e) => (
                <option key={e.emp_pkey} value={e.emp_pkey}>
                  {e.first_name} {e.last_name}{e.emp_id ? ` - ${e.emp_id}` : ''}
                </option>
              ))}
            </select>
          </div>
          <span className="text-[11.5px] text-[color:var(--color-danger)]">
            * Employees shown in red are separated
          </span>
        </div>
      )}

      {!branch || !month ? (
        <div className="text-slate-500 text-[12.5px] px-1">Select a branch and month to begin.</div>
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          pageSize={10}
          pageSizeOptions={[10, 20, 30, 50]}
          isLoading={isLoading}
          rowClassName={rowClass}
        />
      )}

      {slipId != null && <SalarySlipModal payrollMasterPkey={slipId} onClose={() => setSlipId(null)} />}
    </div>
  );
}

export default function ApprovePayrollPage() {
  return (
    <Suspense fallback={null}>
      <ApprovePayrollContent />
    </Suspense>
  );
}
