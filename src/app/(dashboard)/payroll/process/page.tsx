'use client';

import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListFilter, PlayCircle, XCircle, FileText } from 'lucide-react';
import type { ColumnDef, Row } from '@tanstack/react-table';
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
  diff: number | null;
}

// Mirrors legacy's showprocesspayrolltab.ctp: "Not Processed" (tab 0, listpayroll) and
// "Processed" (tab 1, listprocessedpayroll — everything that has left Not Processed, i.e. Hold +
// Processed + Verified + Approved together). Legacy's Hold button is commented out in that view
// (holdProcessPayroll() is dead in the live UI), so it isn't offered here either.
const TABS = [
  { key: 'pending', label: 'Not Processed' },
  { key: 'not_pending', label: 'Processed' },
] as const;

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function currentMonthYear() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function rowClass(row: PayrollRow) {
  // Mirrors legacy's rowStyler in showprocesspayrolltab.ctp: net salary <= 0 gets a solid red
  // background, otherwise a resigned/separated employee's row text goes red.
  if (row.net_salary != null && row.net_salary <= 0) return 'bg-[color:var(--color-danger)] text-white';
  if (row.resigned) return 'text-[color:var(--color-danger)]';
  return '';
}

function ProcessPayrollContent() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState('');
  const [month, setMonth] = useState(currentMonthYear());
  const [employee, setEmployee] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pending');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [taxInclude, setTaxInclude] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [listed, setListed] = useState(false);
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

  const { data, isLoading, refetch } = useQuery<{ rows: PayrollRow[] }>({
    queryKey: ['payroll', branch, month, tab, employee],
    queryFn: () =>
      fetch(`/api/payroll?branch=${branch}&month=${month}&status=${tab}&employee=${employee}`).then((r) => r.json()),
    enabled: !!branch && !!month && listed,
  });
  const rows = data?.rows ?? [];

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

  // Mirrors legacy's List button (PayrollController::FilterList / PayrollProcessController::
  // FilterList): a single click seeds payroll_master from attendance for the branch/month, then
  // lists — not two separate steps.
  const list = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/payroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, month }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.error ?? 'List failed');
      return b;
    },
    onSuccess: () => { setListed(true); setMessage(null); refetch(); },
    onError: (err: Error) => setMessage(err.message),
  });

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

  const process = useMutation({
    mutationFn: () => postAction('/api/payroll/process', { ids: Array.from(selected), tax: taxInclude }),
    onSuccess: onBulkSuccess,
    onError: onBulkError,
  });
  // "Remove" mirrors legacy's removePayrollEntry(): nulls action, closes out open salary-slip
  // rows, and resets fixed-type emp_variables_upload flags — sends the row back to Not Processed.
  const remove = useMutation({
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
    cell: ({ row }: { row: Row<PayrollRow> }) => (
      <input
        type="checkbox"
        checked={selected.has(row.original.payroll_master_pkey)}
        onChange={(e) => { e.stopPropagation(); toggle(row.original.payroll_master_pkey); }}
        onClick={(e) => e.stopPropagation()}
        className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
      />
    ),
  };

  const nameColumn: ColumnDef<PayrollRow, unknown> = {
    accessorKey: 'emp_name',
    header: 'Employee',
    cell: ({ row }: { row: Row<PayrollRow> }) => (
      <span className="font-medium">
        {row.original.emp_name}
        {row.original.resigned && <span className="ml-2 text-[11px]">(separated)</span>}
      </span>
    ),
  };

  const slipColumn: ColumnDef<PayrollRow, unknown> = {
    id: 'slip',
    header: '',
    meta: { className: 'w-14' },
    cell: ({ row }: { row: Row<PayrollRow> }) => (
      <div className="flex justify-end">
        <button
          onClick={(e) => { e.stopPropagation(); setSlipId(row.original.payroll_master_pkey); }}
          className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150 inline-flex"
        >
          <FileText className="w-3.5 h-3.5" />
        </button>
      </div>
    ),
  };

  // Not Processed columns mirror showprocesspayrolltab.ctp tab 0: Employee name, Calender Days,
  // Working Days, Days present, Days on leave, Loss of pay, Net Salary.
  const notProcessedColumns: ColumnDef<PayrollRow, unknown>[] = [
    selectColumn,
    nameColumn,
    { id: 'calander_days', header: 'Calendar Days', cell: ({ row }) => row.original.calander_days ?? '-' },
    { id: 'working_days', header: 'Working Days', cell: ({ row }) => row.original.working_days ?? '-' },
    { id: 'present', header: 'Present', cell: ({ row }) => row.original.days_presant ?? '-' },
    { id: 'days_leave', header: 'Days on Leave', cell: ({ row }) => row.original.days_leave ?? '-' },
    { id: 'lop', header: 'LOP', cell: ({ row }) => row.original.loss_of_pay ?? '-' },
    { id: 'net', header: 'Net Salary', cell: ({ row }) => row.original.net_salary != null ? formatCurrency(row.original.net_salary) : '-' },
  ];

  // Processed columns mirror showprocesspayrolltab.ctp tab 1: View Slip, Employee name, Working
  // Days, Loss of pay, Monthly CTC, Gross Salary, Net Salary, Previous Salary, Difference.
  const processedColumns: ColumnDef<PayrollRow, unknown>[] = [
    selectColumn,
    slipColumn,
    nameColumn,
    { id: 'working_days', header: 'Working Days', cell: ({ row }) => row.original.working_days ?? '-' },
    { id: 'lop', header: 'LOP', cell: ({ row }) => row.original.loss_of_pay ?? '-' },
    { id: 'monthly_ctc', header: 'Monthly CTC', cell: ({ row }) => row.original.monthly_ctc != null ? formatCurrency(row.original.monthly_ctc) : '-' },
    { id: 'gross', header: 'Gross Salary', cell: ({ row }) => row.original.gross_salary != null ? formatCurrency(row.original.gross_salary) : '-' },
    { id: 'net', header: 'Net Salary', cell: ({ row }) => row.original.net_salary != null ? formatCurrency(row.original.net_salary) : '-' },
    { id: 'prev_net', header: 'Previous Salary', cell: ({ row }) => row.original.last_month_net_salary != null ? formatCurrency(row.original.last_month_net_salary) : '-' },
    { id: 'diff', header: 'Difference', cell: ({ row }) => row.original.diff != null ? formatCurrency(row.original.diff) : '-' },
    { id: 'status', header: 'Status', cell: ({ row }) => row.original.action || '-' },
  ];

  const columns = tab === 'pending' ? notProcessedColumns : processedColumns;

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Process Payroll
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Select a branch and month, then list to seed drafts from attendance and run payroll
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[160px]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select
            value={branch}
            onChange={(e) => { setBranch(e.target.value); setEmployee(''); setSelected(new Set()); setListed(false); }}
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
            onChange={(e) => { setMonth(e.target.value); setSelected(new Set()); setListed(false); }}
            className={INPUT_CLASS}
          />
        </div>
        <button
          onClick={() => list.mutate()}
          disabled={!branch || !month || list.isPending}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <ListFilter className="w-3.5 h-3.5" />
          {list.isPending ? 'Listing…' : 'List'}
        </button>
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

      {branch && month && listed && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-center gap-3">
          {tab === 'pending' && (
            <label className="flex items-center gap-1.5 text-[12.5px] text-slate-600">
              <input
                type="checkbox"
                checked={taxInclude}
                onChange={(e) => setTaxInclude(e.target.checked)}
                className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
              />
              Include TDS in this run
            </label>
          )}
          {tab === 'pending' && (
            <button
              onClick={() => process.mutate()}
              disabled={!selected.size || process.isPending}
              className={cn(BTN_BASE, 'bg-[color:var(--color-success)] hover:bg-[color:var(--color-success-dark)] text-white')}
            >
              <PlayCircle className="w-3.5 h-3.5" />
              {process.isPending ? 'Processing…' : `Process ${selected.size || ''}`}
            </button>
          )}
          {tab === 'not_pending' && (
            <button
              onClick={() => remove.mutate()}
              disabled={!selected.size || remove.isPending}
              className={cn(BTN_BASE, 'bg-[color:var(--color-danger)] hover:opacity-90 text-white')}
            >
              <XCircle className="w-3.5 h-3.5" />
              {remove.isPending ? 'Removing…' : 'Remove'}
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
        <div className="text-slate-500 text-[12.5px] px-1">Select a branch and month, then click List.</div>
      ) : !listed ? (
        <div className="text-slate-500 text-[12.5px] px-1">Click List to load payroll for this branch and month.</div>
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

export default function ProcessPayrollPage() {
  return (
    <Suspense fallback={null}>
      <ProcessPayrollContent />
    </Suspense>
  );
}
