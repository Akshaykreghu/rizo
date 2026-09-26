'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { useSetupOptions, type SetupOption } from '@/lib/setupOptions';
import { recentMonthOptions } from '@/lib/attendance';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

interface UploadResult { imported: number; errors: { row: number; message: string }[] }

interface LeaveType { salaryHeadItemFkey: number; name: string }

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

interface LeaveUploadRow {
  emp_leave_upload_pkey: number;
  leave_start_date: string;
  leave_start_session: number;
  leave_end_date: string;
  leave_end_session: number;
  employee_id: string;
  EmpName: string;
  item: string;
  Reason: string | null;
  created_date: string;
}

const emptyForm = { empFkey: '', salaryHeadItemFkey: '', fromDate: '', fromHalf: '1', toDate: '', toHalf: '2', reason: '', contactNo: '', contactPerson: '' };

function ManualGrid({
  branch, setBranch, employee, setEmployee, branches,
}: {
  branch: string;
  setBranch: (v: string) => void;
  employee: string;
  setEmployee: (v: string) => void;
  branches: SetupOption[];
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Starts empty so server and first client render match exactly (avoiding a hydration
  // mismatch from computing "now" during render), then fills in the current month client-side.
  const [month, setMonth] = useState('');
  useEffect(() => { setMonth(currentMonth()); }, []);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const templateHref = `/api/leave/bulk-upload/template?branch=${encodeURIComponent(branch)}&employee=${encodeURIComponent(employee)}`;

  const { data: employeeOptions = [] } = useQuery<{ value: string; label: string }[]>({
    queryKey: ['leave-bulk-upload-employees', branch],
    queryFn: () =>
      fetch(`/api/employees?branch=${encodeURIComponent(branch)}&pageSize=1000`)
        .then((r) => r.json())
        .then((body) => (body.data ?? []).map((e: { emp_pkey: number; first_name: string; last_name: string; emp_id: string }) => ({
          value: String(e.emp_pkey),
          label: `${e.first_name} ${e.last_name ?? ''}`.trim() + (e.emp_id ? ` (${e.emp_id})` : ''),
        }))),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch('/api/leave/bulk-upload', { method: 'POST', body: formData }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Upload failed');
        return res.json();
      });
    },
    onSuccess: (data: UploadResult) => {
      setUploadResult(data);
      queryClient.invalidateQueries({ queryKey: ['leave', 'bulk-upload', 'list'] });
    },
  });

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  }

  const { data, isLoading } = useQuery<{ data: LeaveUploadRow[]; total: number }>({
    queryKey: ['leave', 'bulk-upload', 'list', month, employee, branch, page, pageSize],
    queryFn: () =>
      fetch(`/api/leave/bulk-upload/list?rows=${pageSize}&page=${page}&month=${month}&employee=${employee}&branch=${branch}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const { data: leaveTypesData } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave', 'types', form.empFkey],
    queryFn: () => fetch(`/api/leave/types?employee=${form.empFkey}`).then((r) => r.json()),
    enabled: !!form.empFkey,
  });
  const leaveTypes = leaveTypesData?.data ?? [];

  // Ported from addeditleave_new.ctp's getLeaveBalance(): re-fetched whenever employee, leave
  // type, or From Date changes, so the balance shown reflects the date being applied for.
  const { data: balancePreview } = useQuery<{
    balance: number;
    allowNegative: boolean;
    minLeaveLimit: number;
    maxLeaveLimit: number;
    minServiceOk: boolean;
    minServiceMessage: string | null;
    advanceNoticeOk: boolean;
    advanceNoticeMessage: string | null;
  }>({
    queryKey: ['leave', 'balance-preview', form.empFkey, form.salaryHeadItemFkey, form.fromDate],
    queryFn: () =>
      fetch(
        `/api/leave/balance-preview?employee=${form.empFkey}&leaveType=${form.salaryHeadItemFkey}&fromDate=${form.fromDate}`
      ).then((r) => r.json()),
    enabled: !!form.empFkey && !!form.salaryHeadItemFkey && !!form.fromDate,
  });

  const add = useMutation({
    mutationFn: () =>
      fetch('/api/leave/bulk-upload/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          empFkey: Number(form.empFkey),
          salaryHeadItemFkey: Number(form.salaryHeadItemFkey),
          fromHalf: Number(form.fromHalf),
          toHalf: Number(form.toHalf),
        }),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Failed to save');
        return b;
      }),
    onSuccess: (b) => {
      setMessage(`Leave saved (${b.leaveDays} day(s))`);
      setShowAdd(false);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ['leave', 'bulk-upload', 'list'] });
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const del = useMutation({
    mutationFn: (id: number) => fetch(`/api/leave/bulk-upload/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave', 'bulk-upload', 'list'] }),
  });

  const columns: ColumnDef<LeaveUploadRow, unknown>[] = [
    { id: 'employee', header: 'Employee', cell: ({ row }) => <>{row.original.EmpName} <span className="text-slate-400 text-[11px]">({row.original.employee_id})</span></> },
    { accessorKey: 'item', header: 'Leave Type' },
    {
      id: 'from', header: 'From',
      cell: ({ row }) => <>{row.original.leave_start_date} {row.original.leave_start_session === 1 ? '(FH)' : '(SH)'}</>,
    },
    {
      id: 'to', header: 'To',
      cell: ({ row }) => <>{row.original.leave_end_date} {row.original.leave_end_session === 1 ? '(FH)' : '(SH)'}</>,
    },
    { id: 'reason', header: 'Reason', cell: ({ row }) => <span className="text-slate-500">{row.original.Reason}</span> },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-16' },
      cell: ({ row }) => (
        <button
          onClick={(e) => { e.stopPropagation(); del.mutate(row.original.emp_leave_upload_pkey); }}
          title="Delete"
          className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div className="mt-6">
      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <SearchableSelect
            value={month}
            onChange={(v) => { setMonth(v); setPage(1); }}
            options={recentMonthOptions()}
            placeholder="Select month"
            className="min-w-[150px]"
            buttonClassName="!py-1.5 !text-[12.5px] !rounded-[9px]"
          />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <SearchableSelect
            value={branch}
            onChange={(v) => { setBranch(v); setEmployee(''); setPage(1); }}
            options={branches}
            placeholder="All branches"
            className="min-w-[170px]"
            buttonClassName="!py-1.5 !text-[12.5px] !rounded-[9px]"
          />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <SearchableSelect
            value={employee}
            onChange={(v) => { setEmployee(v); setPage(1); }}
            options={employeeOptions}
            placeholder="All employees"
            className="min-w-[200px]"
            buttonClassName="!py-1.5 !text-[12.5px] !rounded-[9px]"
          />
        </div>
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
        <button
          onClick={() => setShowAdd(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white ml-auto')}
        >
          <Plus className="w-3.5 h-3.5" /> Apply Leave
        </button>
        {message && <span className="w-full text-[12.5px] text-slate-500">{message}</span>}
      </div>

      {upload.isError && <p className="text-[12.5px] text-[color:var(--color-danger)] mb-3">{String(upload.error)}</p>}

      {uploadResult && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-[color:var(--color-success-dark)]">{uploadResult.imported} leave request{uploadResult.imported === 1 ? '' : 's'} applied &amp; approved</span>
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
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Apply Leave</h2>
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
              {balancePreview && (
                <div className="rounded-[9px] bg-slate-50 border border-slate-200 px-3 py-2 text-[12.5px] space-y-1">
                  <div className="font-medium text-[#0F172A]">
                    Available Leave Balance: {balancePreview.balance}
                  </div>
                  {!balancePreview.minServiceOk && (
                    <div className="text-[color:var(--color-danger-dark)]">{balancePreview.minServiceMessage}</div>
                  )}
                  {!balancePreview.advanceNoticeOk && (
                    <div className="text-[color:var(--color-danger-dark)]">{balancePreview.advanceNoticeMessage}</div>
                  )}
                  {balancePreview.balance === 0 && !balancePreview.allowNegative && (
                    <div className="text-[color:var(--color-danger-dark)]">You have no leave balance!</div>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">From Date</label>
                  <input type="date" value={form.fromDate} onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">From Half</label>
                  <select value={form.fromHalf} onChange={(e) => setForm((f) => ({ ...f, fromHalf: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')}>
                    <option value="1">First Half</option>
                    <option value="2">Second Half</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">To Date</label>
                  <input type="date" value={form.toDate} onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">To Half</label>
                  <select value={form.toHalf} onChange={(e) => setForm((f) => ({ ...f, toHalf: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')}>
                    <option value="1">First Half</option>
                    <option value="2">Second Half</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Reason</label>
                <input type="text" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Contact No.</label>
                  <input type="text" value={form.contactNo} onChange={(e) => setForm((f) => ({ ...f, contactNo: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Contact Person</label>
                  <input type="text" value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
                </div>
              </div>
            </div>
            {add.isError && <p className="text-[12.5px] text-[color:var(--color-danger)] mt-3">{(add.error as Error).message}</p>}
            <button
              onClick={() => add.mutate()}
              disabled={!form.empFkey || !form.salaryHeadItemFkey || !form.fromDate || !form.toDate || add.isPending}
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

export default function BulkLeaveUploadPage() {
  const { slotEl } = useHeaderSlot();
  const router = useRouter();
  const [branch, setBranch] = useState('');
  const [employee, setEmployee] = useState('');
  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', (r) => String(r.branch_name));

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Bulk Leave Upload
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Apply leave for multiple employees from a spreadsheet, or add/manage entries one at a time
            </p>
          </div>,
          slotEl
        )}

      <button
        onClick={() => router.push('/leave/requests')}
        className="flex items-center gap-1.5 text-[12.5px] text-slate-500 hover:text-slate-800 mb-4 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Leave Requests
      </button>

      <p className="text-[12.5px] text-slate-500 mb-4 max-w-xl">
        Matches legacy behavior: every successfully imported or added row is applied and <span className="font-medium">auto-approved</span>{' '}
        immediately — no separate authorize/approve step, unlike leave applied through the Leave
        Requests page. Employee ID is the employee&apos;s login username, and Leave Type is its short
        code (see the template).
      </p>

      <ManualGrid branch={branch} setBranch={setBranch} employee={employee} setEmployee={setEmployee} branches={branches} />
    </div>
  );
}
