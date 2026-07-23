'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { Plus, Check, X, ThumbsUp, Ban } from 'lucide-react';

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
  Applied: 'bg-amber-100 text-amber-700',
  Authorized: 'bg-blue-100 text-blue-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Cancelled: 'bg-gray-100 text-gray-600',
  CancellationOfAuthorized: 'bg-purple-100 text-purple-700',
  CancellationOfApproved: 'bg-purple-100 text-purple-700',
};

const STATUS_LABEL: Record<string, string> = {
  CancellationOfAuthorized: 'Cancellation Requested',
  CancellationOfApproved: 'Cancellation Requested',
};

export default function LeaveRequestsPage() {
  const [employee, setEmployee] = useState('');
  const [status, setStatus] = useState('');
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Leave Requests</h1>
        <button
          onClick={() => setShowApply(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> Apply Leave
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-64">
          <label className="block text-xs text-gray-500 mb-1">Employee</label>
          <EmployeeSearch value={employee} onChange={setEmployee} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
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
      </div>

      {message && <div className="mb-4 text-sm bg-blue-50 text-blue-700 px-3 py-2 rounded-lg">{message}</div>}

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && rows.length === 0 && <p className="text-sm text-gray-400">No requests found.</p>}
      {rows.length > 0 && (
        <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Employee</th>
              <th className="p-2">Leave Type</th>
              <th className="p-2">From</th>
              <th className="p-2">To</th>
              <th className="p-2">Days</th>
              <th className="p-2">Reason</th>
              <th className="p-2">Status</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.LEAVEENTRYID} className="border-t border-gray-100">
                <td className="p-2">{row.first_name} {row.last_name} <span className="text-gray-400 text-xs">({row.emp_id})</span></td>
                <td className="p-2">{row.leave_type}</td>
                <td className="p-2">{row.FROMDATE}</td>
                <td className="p-2">{row.TODATE}</td>
                <td className="p-2">{row.leave_days}</td>
                <td className="p-2 text-gray-500">{row.Reason}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[row.LEAVESTATUS] ?? 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABEL[row.LEAVESTATUS] ?? row.LEAVESTATUS}
                  </span>
                </td>
                <td className="p-2 flex gap-2">
                  {row.LEAVESTATUS === 'Applied' && (
                    <button onClick={() => act.mutate({ id: row.LEAVEENTRYID, action: 'authorize' })} title="Authorize" className="text-blue-600 hover:text-blue-800">
                      <ThumbsUp className="w-4 h-4" />
                    </button>
                  )}
                  {row.LEAVESTATUS === 'Authorized' && (
                    <button onClick={() => act.mutate({ id: row.LEAVEENTRYID, action: 'approve' })} title="Approve" className="text-green-600 hover:text-green-800">
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  {(row.LEAVESTATUS === 'Applied' || row.LEAVESTATUS === 'Authorized') && (
                    <button onClick={() => act.mutate({ id: row.LEAVEENTRYID, action: 'reject' })} title="Reject" className="text-red-600 hover:text-red-800">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  {(row.LEAVESTATUS === 'Applied' || row.LEAVESTATUS === 'Authorized' || row.LEAVESTATUS === 'Approved') && (
                    <button onClick={() => act.mutate({ id: row.LEAVEENTRYID, action: 'cancel' })} title="Cancel" className="text-gray-500 hover:text-gray-700">
                      <Ban className="w-4 h-4" />
                    </button>
                  )}
                  {(row.LEAVESTATUS === 'CancellationOfAuthorized' || row.LEAVESTATUS === 'CancellationOfApproved') && (
                    <>
                      <button onClick={() => act.mutate({ id: row.LEAVEENTRYID, action: 'cancellation/approve' })} title="Confirm Cancellation" className="text-green-600 hover:text-green-800">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => act.mutate({ id: row.LEAVEENTRYID, action: 'cancellation/reject' })} title="Reject Cancellation (keep leave)" className="text-red-600 hover:text-red-800">
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showApply && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowApply(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold mb-4">Apply Leave</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Employee</label>
                <EmployeeSearch value={form.empFkey} onChange={(v) => setForm((f) => ({ ...f, empFkey: v, salaryHeadItemFkey: '' }))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Leave Type</label>
                <select
                  value={form.salaryHeadItemFkey}
                  onChange={(e) => setForm((f) => ({ ...f, salaryHeadItemFkey: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
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
                  <label className="block text-xs text-gray-500 mb-1">From Date</label>
                  <input type="date" value={form.fromDate} onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">From Half</label>
                  <select value={form.fromHalf} onChange={(e) => setForm((f) => ({ ...f, fromHalf: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="1">First Half</option>
                    <option value="2">Second Half</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">To Date</label>
                  <input type="date" value={form.toDate} onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">To Half</label>
                  <select value={form.toHalf} onChange={(e) => setForm((f) => ({ ...f, toHalf: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="1">First Half</option>
                    <option value="2">Second Half</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Reason</label>
                <input type="text" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Contact No.</label>
                  <input type="text" value={form.contactNo} onChange={(e) => setForm((f) => ({ ...f, contactNo: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Contact Person</label>
                  <input type="text" value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
            <button
              onClick={() => apply.mutate()}
              disabled={!form.empFkey || !form.salaryHeadItemFkey || !form.fromDate || !form.toDate || apply.isPending}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
            >
              {apply.isPending ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
