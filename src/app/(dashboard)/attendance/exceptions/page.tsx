'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Play, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

// Ports ExceptionRuleController (menu label "Exceptions"). See lib/exceptionRules.ts for the full
// behavior notes — applying a rule is consequential (auto-regularizes punches, can auto-approve
// LOP/leave deductions for a whole branch-month via the confirmed-live exception_rule_apply_prce
// proc), and legacy only allows one applied rule per branch/month total, not just one per rule.

interface Rule {
  exceptionId: number; ruleName: string; ruleType: string; dataType: number;
  exceptionDays: number | null; exceptionTime: number | null; actionAfterException: number;
  detectCount: number; leaveDetectType: number | null; resetStatus: boolean; activateStatus: boolean;
}
interface AppliedRow {
  exceptionAppliedPkey: number; ruleId: number; ruleName: string; branchCode: string;
  branchName: string | null; appliedDate: string; monthYear: string; createdBy: string | null;
}
interface Option { value: string; label: string }

function useLookup(path: string, valueKey: string, labelFn: (r: Record<string, unknown>) => string) {
  return useQuery<Option[]>({
    queryKey: [path],
    queryFn: () => fetch(`/api/${path}`).then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ value: String(r[valueKey]), label: labelFn(r) }))
    ),
  });
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const DATA_TYPE_LABELS = ['Early Out', 'Late In', 'Late In and Early Out'];
const LEAVE_TYPE_OPTIONS = [
  { value: 87, label: 'Casual Leave' }, { value: 86, label: 'Sick Leave' },
  { value: 88, label: 'Earned Leave' }, { value: 114, label: 'Compensatory Off' },
  { value: 89, label: 'Privilege Leave' },
];
function leaveTypeLabel(v: number | null) {
  return LEAVE_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? 'LOP';
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';
const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const EMPTY_FORM = {
  ruleName: '', ruleType: 'monthly', dataType: 1, exceptionDays: '' as number | '', exceptionTime: '' as number | '',
  actionAfterException: 0, detectCount: 1, leaveType: 87 as number | '', resetStatus: false, activateStatus: true,
};

export default function ExceptionsPage() {
  const { slotEl } = useHeaderSlot();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [applyBranch, setApplyBranch] = useState('');
  const [applyMonth, setApplyMonth] = useState(currentMonth());
  const [applyRuleId, setApplyRuleId] = useState('');
  const [appliedPage, setAppliedPage] = useState(1);

  const { data: branches = [] } = useLookup('setup/branches', 'branch_code', (r) => String(r.branch_name));
  const { data: rules = [], refetch: refetchRules } = useQuery<Rule[]>({
    queryKey: ['exception-rules'],
    queryFn: () => fetch('/api/attendance/exceptions/rules').then((r) => r.json()).then((b) => b.data),
  });
  const { data: appliedData, refetch: refetchApplied } = useQuery<{ rows: AppliedRow[]; total: number }>({
    queryKey: ['exception-applied', appliedPage],
    queryFn: () => fetch(`/api/attendance/exceptions/applied?page=${appliedPage}`).then((r) => r.json()),
  });

  function openNew() { setForm(EMPTY_FORM); setEditing('new'); }
  function openEdit(rule: Rule) {
    setForm({
      ruleName: rule.ruleName, ruleType: rule.ruleType, dataType: rule.dataType,
      exceptionDays: rule.exceptionDays ?? '', exceptionTime: rule.exceptionTime ?? '',
      actionAfterException: rule.actionAfterException, detectCount: rule.detectCount,
      leaveType: rule.leaveDetectType ?? '', resetStatus: rule.resetStatus, activateStatus: rule.activateStatus,
    });
    setEditing(rule);
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ruleName: form.ruleName, ruleType: form.ruleType, dataType: form.dataType,
        exceptionDays: form.exceptionDays === '' ? null : Number(form.exceptionDays),
        exceptionTime: form.exceptionTime === '' ? null : Number(form.exceptionTime),
        actionAfterException: form.actionAfterException, detectCount: form.detectCount,
        leaveType: form.leaveType === '' ? null : Number(form.leaveType),
        resetStatus: form.resetStatus, activateStatus: form.activateStatus,
      };
      const isNew = editing === 'new';
      return fetch(isNew ? '/api/attendance/exceptions/rules' : `/api/attendance/exceptions/rules/${(editing as Rule).exceptionId}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to save rule');
        return body;
      });
    },
    onSuccess: () => { setEditing(null); refetchRules(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const removeRule = useMutation({
    mutationFn: (id: number) => fetch(`/api/attendance/exceptions/rules/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => refetchRules(),
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/exceptions/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchCode: applyBranch, ruleId: Number(applyRuleId), month: applyMonth }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to apply rule');
        return body as { message: string };
      }),
    onSuccess: (body) => { setMessage(body.message); qc.invalidateQueries({ queryKey: ['exception-applied'] }); refetchApplied(); },
    onError: (err: Error) => setMessage(err.message),
  });

  const reverseMutation = useMutation({
    mutationFn: (row: AppliedRow) =>
      fetch('/api/attendance/exceptions/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceptionAppliedPkey: row.exceptionAppliedPkey, branchCode: row.branchCode, ruleId: row.ruleId, monthYear: row.monthYear }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to reverse rule');
        return body as { message: string };
      }),
    onSuccess: (body) => { setMessage(body.message); refetchApplied(); },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Exceptions
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Rule-based auto-regularization for late-in / early-out patterns
            </p>
          </div>,
          slotEl
        )}

      {message && (
        <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex items-center justify-between text-[12.5px]">
          <span>{message}</span>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-slate-600">Dismiss</button>
        </div>
      )}

      {/* Rules */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-[#0F172A]">Rules</h2>
        <button onClick={openNew} className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
          <Plus className="w-3.5 h-3.5" /> New Rule
        </button>
      </div>
      <div className="surface-card rounded-xl overflow-hidden mb-6">
        {rules.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No rules yet</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Detects</th>
                <th className="px-4 py-2 font-medium">Tolerance</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Active</th>
                <th className="px-4 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.exceptionId} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2">{rule.ruleName}</td>
                  <td className="px-4 py-2 capitalize">{rule.ruleType}</td>
                  <td className="px-4 py-2">{DATA_TYPE_LABELS[rule.dataType] ?? 'Unknown'}</td>
                  <td className="px-4 py-2">{rule.exceptionDays ? `${rule.exceptionDays} days` : rule.exceptionTime != null ? `${rule.exceptionTime} min` : '—'}</td>
                  <td className="px-4 py-2">{rule.actionAfterException === 1 ? 'Loss of Pay' : `Leave (${leaveTypeLabel(rule.leaveDetectType)}, ${rule.detectCount})`}</td>
                  <td className="px-4 py-2">{rule.activateStatus ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(rule)} className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)]">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => removeRule.mutate(rule.exceptionId)} className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Apply */}
      <h2 className="text-sm font-semibold text-[#0F172A] mb-2">Apply Rule</h2>
      <div className="surface-card rounded-xl px-4 py-2.5 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Branch</label>
          <select value={applyBranch} onChange={(e) => setApplyBranch(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[160px]')}>
            <option value="">Select branch</option>
            {branches.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Month</label>
          <input type="month" value={applyMonth} onChange={(e) => setApplyMonth(e.target.value)} className={INPUT_CLASS} />
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Rule</label>
          <select value={applyRuleId} onChange={(e) => setApplyRuleId(e.target.value)} className={cn(INPUT_CLASS, 'min-w-[160px]')}>
            <option value="">Select rule</option>
            {rules.filter((r) => r.activateStatus).map((r) => <option key={r.exceptionId} value={r.exceptionId}>{r.ruleName}</option>)}
          </select>
        </div>
        <button
          onClick={() => applyMutation.mutate()}
          disabled={!applyBranch || !applyRuleId || applyMutation.isPending}
          className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          <Play className="w-3.5 h-3.5" /> {applyMutation.isPending ? 'Applying…' : 'Apply'}
        </button>
      </div>

      <h2 className="text-sm font-semibold text-[#0F172A] mb-2">Applied History</h2>
      <div className="surface-card rounded-xl overflow-hidden">
        {(appliedData?.rows.length ?? 0) === 0 ? (
          <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No rules applied yet</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-500">
                <th className="px-4 py-2 font-medium">Rule</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Month</th>
                <th className="px-4 py-2 font-medium">Applied On</th>
                <th className="px-4 py-2 font-medium">By</th>
                <th className="px-4 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {appliedData?.rows.map((row) => (
                <tr key={row.exceptionAppliedPkey} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2">{row.ruleName}</td>
                  <td className="px-4 py-2">{row.branchName ?? row.branchCode}</td>
                  <td className="px-4 py-2">{row.monthYear}</td>
                  <td className="px-4 py-2">{row.appliedDate?.slice(0, 10)}</td>
                  <td className="px-4 py-2">{row.createdBy || '—'}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => reverseMutation.mutate(row)}
                      disabled={reverseMutation.isPending}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10"
                      title="Reverse"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {(appliedData?.total ?? 0) > 10 && (
        <div className="flex items-center justify-end gap-2 mt-2 text-[12.5px]">
          <button disabled={appliedPage === 1} onClick={() => setAppliedPage((p) => p - 1)} className="disabled:opacity-40">Previous</button>
          <span className="text-slate-400">Page {appliedPage}</span>
          <button disabled={appliedPage * 10 >= (appliedData?.total ?? 0)} onClick={() => setAppliedPage((p) => p + 1)} className="disabled:opacity-40">Next</button>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{editing === 'new' ? 'New Rule' : 'Edit Rule'}</h2>
              <button onClick={() => setEditing(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
            <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Rule Name</label>
                <input type="text" value={form.ruleName} onChange={(e) => setForm((f) => ({ ...f, ruleName: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Rule Type</label>
                <input type="text" value={form.ruleType} onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value }))} className={cn(INPUT_CLASS, 'w-full')} />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Detects</label>
                <select value={form.dataType} onChange={(e) => setForm((f) => ({ ...f, dataType: Number(e.target.value) }))} className={cn(INPUT_CLASS, 'w-full')}>
                  {DATA_TYPE_LABELS.map((label, i) => <option key={i} value={i}>{label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Days Allowed</label>
                  <input type="number" min={0} value={form.exceptionDays} onChange={(e) => setForm((f) => ({ ...f, exceptionDays: e.target.value === '' ? '' : Number(e.target.value) }))} className={cn(INPUT_CLASS, 'w-full')} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Minutes Tolerance</label>
                  <input type="number" min={0} value={form.exceptionTime} onChange={(e) => setForm((f) => ({ ...f, exceptionTime: e.target.value === '' ? '' : Number(e.target.value) }))} className={cn(INPUT_CLASS, 'w-full')} />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Action After Exception</label>
                <select value={form.actionAfterException} onChange={(e) => setForm((f) => ({ ...f, actionAfterException: Number(e.target.value) }))} className={cn(INPUT_CLASS, 'w-full')}>
                  <option value={0}>Leave Deduction</option>
                  <option value={1}>Loss of Pay</option>
                </select>
              </div>
              {form.actionAfterException === 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Leave Type</label>
                    <select value={form.leaveType} onChange={(e) => setForm((f) => ({ ...f, leaveType: Number(e.target.value) }))} className={cn(INPUT_CLASS, 'w-full')}>
                      {LEAVE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-slate-600 mb-1.5">Detect Count</label>
                    <input type="number" step={0.5} min={0.5} value={form.detectCount} onChange={(e) => setForm((f) => ({ ...f, detectCount: Number(e.target.value) }))} className={cn(INPUT_CLASS, 'w-full')} />
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
                <input type="checkbox" checked={form.resetStatus} onChange={(e) => setForm((f) => ({ ...f, resetStatus: e.target.checked }))} />
                Reset detection count after each cycle
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
                <input type="checkbox" checked={form.activateStatus} onChange={(e) => setForm((f) => ({ ...f, activateStatus: e.target.checked }))} />
                Active
              </label>
            </div>
            <button
              onClick={() => save.mutate()}
              disabled={!form.ruleName.trim() || !form.ruleType.trim() || save.isPending}
              className={cn(BTN_BASE, 'w-full justify-center mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
            >
              {save.isPending ? 'Saving…' : 'Save Rule'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
