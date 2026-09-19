'use client';

import { Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Plus, Check, X, Eye, CalendarCheck } from 'lucide-react';
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
  isAttendanceVerified: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  Applied: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
  Authorized: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)]',
  Approved: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
  Rejected: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]',
  Cancelled: 'bg-slate-100 text-slate-600',
  CancelledByAdmin: 'bg-slate-100 text-slate-600',
  CancellationOfAuthorized: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-dark)]',
  CancellationOfApproved: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-dark)]',
};

const STATUS_LABEL: Record<string, string> = {
  CancellationOfAuthorized: 'Cancellation of Authorized',
  CancellationOfApproved: 'Cancellation of Approved',
  CancelledByAdmin: 'Cancelled by Admin',
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
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
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

  // Ported from addeditleave_new.ctp's getLeaveBalance(): re-fetched whenever employee, leave type,
  // or From Date changes, so the balance shown reflects the date being applied for.
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

  // Ported from EmployeeLeavesController::showleavedays() / showleavedays.ctp — the "Leave Details"
  // modal, shown via the row's View action.
  const { data: details, isLoading: detailsLoading } = useQuery<{
    leaveType: string;
    leaveBalance: number;
    allowNegative: boolean;
    isSandwich: boolean;
    reason: string | null;
    status: string;
    transactions: { leaveDate: string; status: string; remarks: string }[];
    documents: { name: string; type: string }[];
  }>({
    queryKey: ['leave', 'requests', 'details', viewingId],
    queryFn: () => fetch(`/api/leave/requests/${viewingId}/details`).then((r) => r.json()),
    enabled: viewingId !== null,
  });

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
      setShowApply(false);
      setForm({ empFkey: '', salaryHeadItemFkey: '', fromDate: '', fromHalf: '1', toDate: '', toHalf: '2', reason: '', contactNo: '', contactPerson: '' });
      setToast({ message: `Leave applied successfully (${b.leaveDays} day(s))`, type: 'success' });
      refetch();
    },
    onError: (err: Error) => setToast({ message: err.message, type: 'error' }),
  });

  const ACTION_LABEL: Record<string, string> = {
    authorize: 'authorized',
    approve: 'approved',
    reject: 'rejected',
    cancel: 'cancelled',
    'cancellation/approve': 'cancellation confirmed',
    'cancellation/reject': 'cancellation rejected',
  };

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
    onSuccess: (_b, vars) => {
      setToast({ message: `Leave ${ACTION_LABEL[vars.action]} successfully`, type: 'success' });
      refetch();
    },
    onError: (err: Error) => setToast({ message: err.message, type: 'error' }),
  });

  type SkippedRow = { id: number; employeeName: string; reason: string };

  // Names the employees skipped specifically for verified attendance (the reason
  // checkAttendanceRegisterRangeVerified returns), separately from other skip reasons (e.g. an
  // already-processed row), so the toast reads "attendance already verified for Jane, John" rather
  // than a vague count.
  function formatBulkResult(actionVerb: string, processedCount: number, skipped: SkippedRow[]): string {
    if (skipped.length === 0) return `${processedCount} leave(s) ${actionVerb} successfully`;

    const attendanceNames = skipped
      .filter((s) => s.reason.toLowerCase().includes('attendance'))
      .map((s) => s.employeeName)
      .filter(Boolean);
    const otherCount = skipped.length - attendanceNames.length;

    const parts: string[] = [];
    if (processedCount > 0) parts.push(`${processedCount} ${actionVerb}`);
    if (attendanceNames.length > 0) parts.push(`attendance already verified for ${attendanceNames.join(', ')}`);
    if (otherCount > 0) parts.push(`${otherCount} skipped`);
    return parts.join(' — ');
  }

  // Bulk selection flow: mirrors EmployeeLeavesController's checkbox-grid approveleave()/deleteleave(),
  // and adds an attendance-verified guard those legacy endpoints never had — a row whose month is
  // already verified is skipped (not approved/cancelled) and reported back rather than silently
  // dropped or blocking the whole batch.
  const bulkApprove = useMutation({
    mutationFn: (ids: number[]) =>
      fetch('/api/leave/requests/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Bulk approve failed');
        return b as { approved: number[]; skipped: SkippedRow[] };
      }),
    onSuccess: (b) => {
      setSelected(new Set());
      setToast({
        message: formatBulkResult('approved', b.approved.length, b.skipped),
        type: b.approved.length > 0 || b.skipped.length === 0 ? 'success' : 'error',
      });
      refetch();
    },
    onError: (err: Error) => setToast({ message: err.message, type: 'error' }),
  });

  const bulkCancel = useMutation({
    mutationFn: (ids: number[]) =>
      fetch('/api/leave/requests/bulk-cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      }).then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error ?? 'Bulk cancel failed');
        return b as { cancelled: number[]; skipped: SkippedRow[] };
      }),
    onSuccess: (b) => {
      setSelected(new Set());
      setToast({
        message: formatBulkResult('cancelled', b.cancelled.length, b.skipped),
        type: b.cancelled.length > 0 || b.skipped.length === 0 ? 'success' : 'error',
      });
      refetch();
    },
    onError: (err: Error) => setToast({ message: err.message, type: 'error' }),
  });

  function toggleSelect(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Attendance-verified rows are excluded: bulk-approve/bulk-cancel would just skip them anyway
  // (checkAttendanceRegisterRangeVerified blocks them server-side), so there's nothing a checkbox
  // here could actually do for them.
  const isSelectable = (r: LeaveRow) =>
    !r.isAttendanceVerified && (r.LEAVESTATUS === 'Applied' || r.LEAVESTATUS === 'Authorized' || r.LEAVESTATUS === 'Approved');

  const columns: ColumnDef<LeaveRow, unknown>[] = [
    {
      id: 'select',
      // Scoped to the current page only: `table.getRowModel()` here is the *paginated* model
      // (DataTable builds the table with getPaginationRowModel()), so "select all" only ever
      // touches the rows actually rendered on this page, not every filtered row across all pages.
      header: ({ table }) => {
        const pageRows = table.getRowModel().rows.map((r) => r.original).filter(isSelectable);
        const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.LEAVEENTRYID));
        return (
          <input
            type="checkbox"
            checked={allOnPageSelected}
            onChange={() => {
              setSelected((s) => {
                const next = new Set(s);
                if (allOnPageSelected) {
                  pageRows.forEach((r) => next.delete(r.LEAVEENTRYID));
                } else {
                  pageRows.forEach((r) => next.add(r.LEAVEENTRYID));
                }
                return next;
              });
            }}
            className="w-3.5 h-3.5 rounded border-slate-300"
          />
        );
      },
      meta: { className: 'w-10' },
      cell: ({ row }) =>
        isSelectable(row.original) ? (
          <input
            type="checkbox"
            checked={selected.has(row.original.LEAVEENTRYID)}
            onChange={() => toggleSelect(row.original.LEAVEENTRYID)}
            onClick={(e) => e.stopPropagation()}
            className="w-3.5 h-3.5 rounded border-slate-300"
          />
        ) : null,
    },
    {
      id: 'employee',
      header: 'Employee',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          {row.original.first_name} {row.original.last_name}
          <span className="text-slate-400 text-[11px]">({row.original.emp_id})</span>
          {row.original.isAttendanceVerified && (
            <CalendarCheck
              className="w-3.5 h-3.5 text-[color:var(--color-success-dark)] shrink-0"
              aria-label="Attendance verified for this month"
            >
              <title>Attendance already verified for this month</title>
            </CalendarCheck>
          )}
        </span>
      ),
    },
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
      header: 'Action',
      meta: { className: 'w-32' },
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setViewingId(row.original.LEAVEENTRYID)}
            title="View Details"
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
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
        <div className="w-[28rem]">
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
            <option value="CancelledByAdmin">Cancelled by Admin</option>
            <option value="CancellationOfAuthorized">Cancellation of Authorized</option>
            <option value="CancellationOfApproved">Cancellation of Approved</option>
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => bulkApprove.mutate([...selected])}
              disabled={bulkApprove.isPending || bulkCancel.isPending}
              className={cn(BTN_BASE, 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)] hover:opacity-80')}
            >
              Approve
            </button>
            <button
              onClick={() => bulkCancel.mutate([...selected])}
              disabled={bulkApprove.isPending || bulkCancel.isPending}
              className={cn(BTN_BASE, 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
            >
              Cancel
            </button>
          </div>
          <span className="text-[12.5px] text-slate-500">{selected.size} selected</span>
        </div>
      )}

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

      {viewingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setViewingId(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-lg animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">Leave Details</h2>
              <button onClick={() => setViewingId(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {detailsLoading || !details ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-slate-500">Leave Type</span>
                    <span className="text-[13px] font-semibold text-[#0F172A]">{details.leaveType}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-slate-500">Leave Balance</span>
                    <span className="text-[13px] font-semibold text-[#0F172A]">{details.leaveBalance}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-slate-500">Negative</span>
                    <span className="text-[13px] font-semibold text-[#0F172A]">{details.allowNegative ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-slate-500">Sandwich</span>
                    <span className="text-[13px] font-semibold text-[#0F172A]">{details.isSandwich ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-slate-500">Reason</span>
                    <span className="text-[13px] font-semibold text-[#0F172A]">{details.reason ?? '—'}</span>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <div className="border border-slate-200 rounded-[9px] overflow-hidden">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="bg-[color:var(--color-danger-soft)] text-left">
                          <th className="px-3 py-1.5 font-medium text-slate-600">Leave Days</th>
                          <th className="px-3 py-1.5 font-medium text-slate-600">Leave Status</th>
                          <th className="px-3 py-1.5 font-medium text-slate-600">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.transactions.map((t, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-3 py-1.5">{t.leaveDate}</td>
                            <td className="px-3 py-1.5">{t.status}</td>
                            <td className="px-3 py-1.5 text-slate-500">{t.remarks}</td>
                          </tr>
                        ))}
                        {details.transactions.length === 0 && (
                          <tr><td colSpan={3} className="px-3 py-2 text-slate-400">No transactions</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-[11px] font-medium text-slate-500">Documents</span>
                  {details.documents.length === 0 ? (
                    <span className="text-[12.5px] text-slate-400">None</span>
                  ) : (
                    <span className="text-[12.5px] font-medium text-[#0F172A]">{details.documents.map((d) => d.name).join(', ')}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div
          className={cn(
            'fixed bottom-10 right-4 z-[60] min-w-[20rem] max-w-md px-5 py-3.5 rounded-xl shadow-lg text-sm font-medium text-white',
            toast.type === 'success' ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-danger)]'
          )}
        >
          {toast.message}
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
