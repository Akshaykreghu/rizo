'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

interface UploadResult { imported: number; errors: { row: number; message: string }[] }

interface LeaveType { salaryHeadItemFkey: number; name: string }

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

function BulkUploadCard() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const queryClient = useQueryClient();

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
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['leave', 'bulk-upload', 'list'] });
    },
  });

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  }

  return (
    <div className="surface-card rounded-xl px-4 py-4 max-w-xl space-y-3">
      <div className="flex items-center gap-2">
        <a
          href="/api/leave/bulk-upload/template"
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
      {upload.isError && <p className="text-[12.5px] text-[color:var(--color-danger)]">{String(upload.error)}</p>}

      {result && (
        <div className="mt-1 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span>
              <span className="font-medium text-[color:var(--color-success-dark)]">{result.imported} leave request{result.imported === 1 ? '' : 's'} applied &amp; approved</span>
              {result.errors.length > 0 && (
                <span className="text-[color:var(--color-danger)] ml-2">{result.errors.length} row(s) skipped</span>
              )}
            </span>
            <button onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600 text-[11.5px]">Dismiss</button>
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11.5px] text-[color:var(--color-danger)]">
              {result.errors.map((err, i) => (
                <li key={i}>Row {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const emptyForm = { empFkey: '', salaryHeadItemFkey: '', fromDate: '', fromHalf: '1', toDate: '', toHalf: '2', reason: '' };

function ManualGrid() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState('');
  const [employee, setEmployee] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data, isLoading } = useQuery<{ data: LeaveUploadRow[]; total: number }>({
    queryKey: ['leave', 'bulk-upload', 'list', month, employee, page, pageSize],
    queryFn: () =>
      fetch(`/api/leave/bulk-upload/list?rows=${pageSize}&page=${page}&month=${month}&employee=${employee}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const { data: leaveTypesData } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave', 'types', form.empFkey],
    queryFn: () => fetch(`/api/leave/types?employee=${form.empFkey}`).then((r) => r.json()),
    enabled: !!form.empFkey,
  });
  const leaveTypes = leaveTypesData?.data ?? [];

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
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold text-[#0F172A]">Leave Upload Records</h2>
        <button
          onClick={() => setShowAdd(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      </div>

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={employee} onChange={(v) => { setEmployee(v); setPage(1); }} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPage(1); }} className={INPUT_CLASS} />
        </div>
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

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
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Add Leave</h2>
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

      <BulkUploadCard />
      <ManualGrid />
    </div>
  );
}
