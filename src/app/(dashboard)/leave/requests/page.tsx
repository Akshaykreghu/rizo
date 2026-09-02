'use client';

import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Plus, Check, X, ThumbsUp, Ban } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';

interface LeaveType {
  salaryHeadItemFkey: number;
  name: string;
  allowNegative: boolean;
}

interface LeaveRow {
  LEAVEENTRYID: number;
  EMP_fkey: number;
  leave_type: string;
  FROMDATE: string;
  FROMHALF: number;
  TODATE: string;
  TOHALF: number;
  leave_days: number;
  LEAVESTATUS: string;
  Reason: string | null;
  first_name: string;
  last_name: string;
  emp_id: string;
}

const STATUS_STYLE: Record<string, string> = {
  Applied: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
  Authorized: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)]',
  Approved: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
  Rejected: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]',
  Cancelled: 'bg-slate-100 text-slate-600',
  CancellationOfAuthorized: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-dark)]',
  CancellationOfApproved: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-dark)]',
};

const STATUS_LABEL: Record<string, string> = {
  CancellationOfAuthorized: 'Cancellation Requested',
  CancellationOfApproved: 'Cancellation Requested',
};

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

function LeaveRequestsContent() {
  const { slotEl } = useHeaderSlot();
  const searchParams = useSearchParams();
  const [employee, setEmployee] = useState('');
  // Seeds from ?status= so a deep link (e.g. Year-End's pending-leave nudge) can land already
  // filtered, matching the click-through it replaces.
  const [status, setStatus] = useState(() => searchParams.get('status') ?? '');
  const [showApply, setShowApply] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    empFkey: '', salaryHeadItemFkey: '', fromDate: '', fromHalf: '1', toDate: '', toHalf: '2',
    reason: '', contactNo: '', contactPerson: '',
  });

  const { data: leaveTypesData } = useQuery<{ data: LeaveType[] }>({
    queryKey: ['leave', 'types', form.empFkey],
    queryFn: () => fetch(`/api/leave/types?employee=${form.empFkey}`).then((r) => r.json()),
    enabled: !!form.empFkey,
  });
  const leaveTypes = leaveTypesData?.data ?? [];

  const { data, isLoading, refetch } = useQuery<{ data: LeaveRow[] }>({
    queryKey: ['leave', 'requests', employee, status],
    queryFn: () => fetch(`/api/leave/requests?employee=${employee}&status=${status}`).then((r) => r.json()),
  });
  const rows = data?.data ?? [];

  const apply = useMutation({
    mutationFn: () =>
      fetch('/api/leave/requests', {
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
        if (!r.ok) throw new Error(b.error ?? 'Failed to apply');
        return b;
      }),
    onSuccess: (b) => {
      setMessage(`Leave applied (${b.leaveDays} day(s))`);
      setShowApply(false);
      setForm({ empFkey: '', salaryHeadItemFkey: '', fromDate: '', fromHalf: '1', toDate: '', toHalf: '2', reason: '', contactNo: '', contactPerson: '' });
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const act = useMutation({
    mutationFn: (vars: { id: number; action: 'authorize' | 'approve' | 'reject' | 'cancel' | 'cancellation/approve' | 'cancellation/reject' }) =>
      fetch(`/api/leave/requests/${vars.id}/${vars.action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Action failed');
        return b;
      }),
    onSuccess: (b) => {
      setMessage(b.autoApproved ? 'Authorized and auto-approved (same authorizer/approver)' : `Status updated to ${b.status}`);
      refetch();
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const columns: ColumnDef<LeaveRow, unknown>[] = [
    { id: 'employee', header: 'Employee', cell: ({ row }) => <>{row.original.first_name} {row.original.last_name} <span className="text-slate-400 text-[11px]">({row.original.emp_id})</span></> },
    { accessorKey: 'leave_type', header: 'Leave Type' },
    { accessorKey: 'FROMDATE', header: 'From' },
    { accessorKey: 'TODATE', header: 'To' },
    { accessorKey: 'leave_days', header: 'Days' },
    { id: 'reason', header: 'Reason', cell: ({ row }) => <span className="text-slate-500">{row.original.Reason}</span> },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className={cn('px-2 py-0.5 rounded text-[11px] font-medium', STATUS_STYLE[row.original.LEAVESTATUS] ?? 'bg-slate-100 text-slate-700')}>
          {STATUS_LABEL[row.original.LEAVESTATUS] ?? row.original.LEAVESTATUS}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-28' },
      cell: ({ row }) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {row.original.LEAVESTATUS === 'Applied' && (
            <button onClick={() => act.mutate({ id: row.original.LEAVEENTRYID, action: 'authorize' })} title="Authorize" className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150">
              <ThumbsUp className="w-3.5 h-3.5" />
            </button>
          )}
          {row.original.LEAVESTATUS === 'Authorized' && (
            <button onClick={() => act.mutate({ id: row.original.LEAVEENTRYID, action: 'approve' })} title="Approve" className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success-soft)] transition-colors duration-150">
              <Check className="w-3.5 h-3.5" />
            </button>
          )}
          {(row.original.LEAVESTATUS === 'Applied' || row.original.LEAVESTATUS === 'Authorized') && (
            <button onClick={() => act.mutate({ id: row.original.LEAVEENTRYID, action: 'reject' })} title="Reject" className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {(row.original.LEAVESTATUS === 'Applied' || row.original.LEAVESTATUS === 'Authorized' || row.original.LEAVESTATUS === 'Approved') && (
            <button onClick={() => act.mutate({ id: row.original.LEAVEENTRYID, action: 'cancel' })} title="Cancel" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors duration-150">
              <Ban className="w-3.5 h-3.5" />
            </button>
          )}
          {(row.original.LEAVESTATUS === 'CancellationOfAuthorized' || row.original.LEAVESTATUS === 'CancellationOfApproved') && (
            <>
              <button onClick={() => act.mutate({ id: row.original.LEAVEENTRYID, action: 'cancellation/approve' })} title="Confirm Cancellation" className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-success-dark)] hover:bg-[color:var(--color-success-soft)] transition-colors duration-150">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => act.mutate({ id: row.original.LEAVEENTRYID, action: 'cancellation/reject' })} title="Reject Cancellation (keep leave)" className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150">
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Leave Requests
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Apply, authorize, and approve employee leave
            </p>
          </div>,
          slotEl
        )}

      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => setShowApply(true)}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Plus className="w-3.5 h-3.5" /> Apply Leave
        </button>
      </div>

      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
          <EmployeeSearch value={employee} onChange={setEmployee} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT_CLASS}>
            <option value="">All</option>
            <option value="Applied">Applied</option>
            <option value="Authorized">Authorized</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Cancelled">Cancelled</option>
            <option value="CancellationOfAuthorized">Cancellation Requested</option>
            <option value="CancellationOfApproved">Cancellation Requested</option>
          </select>
        </div>
        {message && <span className="text-[12.5px] text-slate-500">{message}</span>}
      </div>

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading} />

      {showApply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setShowApply(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Apply Leave</h2>
              <button onClick={() => setShowApply(false)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
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
            <button
              onClick={() => apply.mutate()}
              disabled={!form.empFkey || !form.salaryHeadItemFkey || !form.fromDate || !form.toDate || apply.isPending}
              className={cn(BTN_BASE, 'w-full justify-center mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {apply.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeaveRequestsPage() {
  return (
    <Suspense fallback={null}>
      <LeaveRequestsContent />
    </Suspense>
  );
}
