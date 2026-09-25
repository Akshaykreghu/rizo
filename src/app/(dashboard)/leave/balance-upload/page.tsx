'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, Plus, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { BranchSearch } from '@/components/employees/BranchSearch';
import { useSetupOptions } from '@/lib/setupOptions';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

interface UploadResult { imported: number; errors: { row: number; message: string }[] }

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

interface LeaveType { salaryHeadItemFkey: number; name: string }

interface LeaveBalanceUploadRow {
  leave_balance_upload_pky: number;
  emp_id: string;
  emp_name: string;
  item: string;
  leave_balance: number;
  created_by: string;
  created_date: string;
}

const emptyForm = { empFkey: '', salaryHeadItemFkey: '', leaveBalance: '' };

export default function LeaveBalanceUploadPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', (r) => String(r.branch_name));

  const [branch, setBranch] = useState('');
  const [employee, setEmployee] = useState('');
  // Starts empty so server and first client render match exactly, then fills in the current
  // month client-side (avoids a hydration mismatch from computing "now" during render).
  const [month, setMonth] = useState('');
  useEffect(() => { setMonth(currentMonth()); }, []);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const templateHref = `/api/leave/balance-upload/template?branch=${encodeURIComponent(branch)}&employee=${encodeURIComponent(employee)}`;

  const { data, isLoading } = useQuery<{ data: LeaveBalanceUploadRow[]; total: number }>({
    queryKey: ['leave', 'balance-upload', 'list', employee, branch, month, page, pageSize],
    queryFn: () =>
      fetch(`/api/leave/balance-upload/list?rows=${pageSize}&page=${page}&employee=${employee}&branch=${branch}&month=${month}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const { data: leaveTypesData } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave', 'types', form.empFkey],
    queryFn: () => fetch(`/api/leave/types?employee=${form.empFkey}`).then((r) => r.json()),
    enabled: !!form.empFkey,
  });
  const leaveTypes = leaveTypesData?.data ?? [];

  const { data: currentBalance } = useQuery<{ balance: number }>({
    queryKey: ['leave', 'balance-upload', 'current', form.empFkey, form.salaryHeadItemFkey],
    queryFn: () =>
      fetch(`/api/leave/balance-upload/current?employee=${form.empFkey}&leaveType=${form.salaryHeadItemFkey}`).then((r) => r.json()),
    enabled: !!form.empFkey && !!form.salaryHeadItemFkey,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch('/api/leave/balance-upload', { method: 'POST', body: formData }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
        return res.json();
      });
    },
    onSuccess: (result: UploadResult) => {
      setUploadResult(result);
      queryClient.invalidateQueries({ queryKey: ['leave', 'balance-upload', 'list'] });
    },
  });

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  }

  const add = useMutation({
    mutationFn: () =>
      fetch('/api/leave/balance-upload/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empFkey: Number(form.empFkey),
          salaryHeadItemFkey: Number(form.salaryHeadItemFkey),
          leaveBalance: Number(form.leaveBalance),
        }),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Failed to save');
        return b;
      }),
    onSuccess: () => {
      setMessage('Leave balance saved');
      setShowAdd(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['leave', 'balance-upload', 'list'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const columns: ColumnDef<LeaveBalanceUploadRow, unknown>[] = [
    { id: 'employee', header: 'Employee', cell: ({ row }) => <>{row.original.emp_name} <span className="text-slate-400 text-[11px]">({row.original.emp_id})</span></> },
    { accessorKey: 'item', header: 'Leave Type' },
    { accessorKey: 'leave_balance', header: 'Uploaded Balance' },
    { accessorKey: 'created_by', header: 'Created By' },
    { accessorKey: 'created_date', header: 'Uploaded Time' },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Leave Balance Upload
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Correct or set an employee&apos;s leave balance directly, independent of the computed policy balance
            </p>
          </div>,
          slotEl
        )}

      <p className="text-[12.5px] text-slate-500 mb-4 max-w-2xl">
        Download the template to see each employee&apos;s current computed balance per leave type, fill in
        the &quot;Upload &lt;Leave Type&gt;&quot; column with the actual/corrected balance, then upload it back.
        The system stores the difference as a carry-forward adjustment rather than overwriting the
        computed balance directly.
      </p>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-[#0F172A]">Leave Balance Upload Records</h2>
        <button
          onClick={() => setShowAdd(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      </div>

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <BranchSearch value={branch} onChange={(v) => { setBranch(v); setEmployee(''); setPage(1); }} branches={branches} />
        </div>
        <div className="w-[28rem]">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={employee} onChange={(v) => { setEmployee(v); setPage(1); }} emptyLabel="All employees" branch={branch} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} className={INPUT_CLASS} />
        </div>
        <div className="flex items-center gap-2">
          <a
            href={templateHref}
            className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600')}
          >
            <Download className="w-3.5 h-3.5" /> Download Template
          </a>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
          >
            <Upload className="w-3.5 h-3.5" /> {upload.isPending ? 'Uploading…' : 'Upload File'}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileSelected} />
        </div>
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      {upload.isError && <p className="text-[12.5px] text-[color:var(--color-danger)] mb-3">{String(upload.error)}</p>}

      {uploadResult && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-[color:var(--color-success-dark)]">{uploadResult.imported} employee record(s) uploaded</span>
              {uploadResult.errors.length > 0 && (
                <span className="text-[color:var(--color-danger)] ml-2">{uploadResult.errors.length} row(s) skipped</span>
              )}
            </span>
            <button onClick={() => setUploadResult(null)} className="text-slate-400 hover:text-slate-600 text-[11.5px]">Dismiss</button>
          </div>
          {uploadResult.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-[color:var(--color-danger)]">
              {uploadResult.errors.map((err, i) => (
                <li key={i}>Row {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <DataTable
        data={rows}
        columns={columns}
        pageSize={pageSize}
        pageSizeOptions={[10, 20, 30, 50]}
        totalRows={data?.total ?? 0}
        onPageChange={(p, ps) => { setPage(p); setPageSize(ps); }}
        isLoading={isLoading}
      />

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowAdd(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Add Leave Balance</h2>
              <button onClick={() => setShowAdd(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Employee</label>
                <EmployeeSearch value={form.empFkey} onChange={(v) => setForm((f) => ({ ...f, empFkey: v, salaryHeadItemFkey: '' }))} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Leave Type</label>
                <select
                  value={form.salaryHeadItemFkey}
                  onChange={(e) => setForm((f) => ({ ...f, salaryHeadItemFkey: e.target.value }))}
                  className={cn(INPUT_CLASS, 'w-full')}
                  disabled={!form.empFkey}
                >
                  <option value="">Select leave type</option>
                  {leaveTypes.map((t) => (
                    <option key={t.salaryHeadItemFkey} value={t.salaryHeadItemFkey}>{t.name}</option>
                  ))}
                </select>
              </div>
              {form.empFkey && form.salaryHeadItemFkey && (
                <div className="rounded-[9px] bg-slate-50 border border-slate-200 px-3 py-2 text-[12.5px]">
                  <span className="font-medium text-[#0F172A]">
                    Current Balance: {currentBalance?.balance ?? '…'}
                  </span>
                </div>
              )}
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Leave Balance to Upload</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.leaveBalance}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Only allow empty, "N." (an in-progress typed decimal, any whole number), or a
                    // non-negative value in multiples of 0.5 with no leading zero (0, 0.5, 1, 1.5, 2, ...).
                    // A plain text input (not type="number") is used deliberately — a number input's DOM
                    // value goes to '' for any unparseable text (e.g. "$$$$$"), so a regex check against
                    // e.target.value can't actually reject what the user typed; it just silently clears it,
                    // leaving stray characters visibly stuck in the field. Leading-zero must also be
                    // rejected explicitly: without it, "0" then "." then "6" leaves "0." rejected but "06"
                    // (typed right after the still-"0" field) would pass a bare /^\d+(\.5)?$/ check.
                    const wholePart = /^(0|[1-9]\d*)\.$/;
                    if (v === '' || wholePart.test(v) || /^(0|[1-9]\d*)(\.5)?$/.test(v)) {
                      setForm((f) => ({ ...f, leaveBalance: v }));
                    } else if (wholePart.test(form.leaveBalance)) {
                      // Typing any digit but "5" right after "N." (e.g. "1.6") is invalid — snap back to
                      // "N" instead of letting it fall through as "16", or leaving "N." stuck in the field.
                      setForm((f) => ({ ...f, leaveBalance: form.leaveBalance.slice(0, -1) }));
                    }
                  }}
                  className={cn(INPUT_CLASS, 'w-full')}
                />
              </div>
            </div>
            {add.isError && <p className="text-[12.5px] text-[color:var(--color-danger)] mt-3">{(add.error as Error).message}</p>}
            <button
              onClick={() => add.mutate()}
              disabled={!form.empFkey || !form.salaryHeadItemFkey || form.leaveBalance === '' || add.isPending}
              className={cn(BTN_BASE, 'w-full justify-center mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {add.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
