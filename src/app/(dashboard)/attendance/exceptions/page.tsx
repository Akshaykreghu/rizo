'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSetupOptions } from '@/lib/setupOptions';
import { Plus, Pencil, Trash2, Play, Undo2, X, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { RequiredMark } from '@/components/ui/RequiredMark';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// Ports ExceptionRuleController (menu label "Exceptions"). See lib/exceptionRules.ts for the full
// behavior notes — applying a rule is consequential (auto-regularizes punches, can auto-approve
// LOP/leave deductions for a whole branch-month via the confirmed-live exception_rule_apply_prce
// proc), and legacy only allows one applied rule per branch/month total, not just one per rule.
// Layout follows legacy's index.ctp: an "Exception Rules" tab (rule grid + create/edit modal from
// newform.ctp) and an "Apply Rules" tab (branch/month/rule pickers + applied history with Excel
// change-log export and reversal).

interface Rule {
  exceptionId: number; ruleName: string; ruleType: string; dataType: number;
  exceptionDays: number | null; exceptionTime: number | null; actionAfterException: number;
  detectCount: number; leaveDetectType: number | null; resetStatus: boolean; activateStatus: boolean;
  creationTime: string | null;
}
interface AppliedRow {
  exceptionAppliedPkey: number; ruleId: number; ruleName: string; branchCode: string;
  branchName: string | null; appliedDate: string; monthYear: string; createdBy: string | null;
}
type Tab = 'rules' | 'apply';
type Notice = { kind: 'success' | 'error'; text: string };
type PendingConfirm = { kind: 'apply' } | { kind: 'reverse'; row: AppliedRow } | { kind: 'delete'; rule: Rule };

const PAGE_SIZE = 10;
const RULE_NAME_MAX = 50;
const normalizeName = (v: string) => v.replace(/\s+/g, ' ').trim();

const DATA_TYPE_OPTIONS = [
  { value: '0', label: 'Early Out' }, { value: '1', label: 'Late In' }, { value: '2', label: 'Late In and Early Out' },
];
const ACTION_OPTIONS = [{ value: '0', label: 'Leave Deduction' }, { value: '1', label: 'Loss of Pay' }];
const DEDUCTION_OPTIONS = [{ value: '0.5', label: '0.5' }, { value: '1', label: '1' }];
const LEAVE_TYPE_OPTIONS = [
  { value: '87', label: 'Casual Leave' }, { value: '86', label: 'Sick Leave' },
  { value: '88', label: 'Earned Leave' }, { value: '114', label: 'Compensatory Off' },
  { value: '89', label: 'Privilege Leave' },
];
function labelOf(options: { value: string; label: string }[], v: number | null) {
  return options.find((o) => o.value === String(v))?.label;
}

// Legacy's month picker: current month back 44 months, shown as "Sep-2026".
const MONTH_OPTIONS = Array.from({ length: 44 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - i);
  return {
    value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    label: `${d.toLocaleString('en-US', { month: 'short' })}-${d.getFullYear()}`,
  };
});
function monthLabel(v: string) {
  return MONTH_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
function formatDate(v: string | null) {
  if (!v) return '—';
  const [y, m, d] = v.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';
const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_PRIMARY = cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white');
const LABEL_CLASS = 'block text-[12px] font-medium text-slate-600 mb-1.5';
const ICON_BTN = 'p-1.5 rounded-lg text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed';

interface RuleForm {
  ruleName: string; ruleType: '' | 'daily' | 'monthly'; dataType: string; actionAfterException: string;
  exceptionLimit: string; detectCount: string; leaveType: string; resetStatus: boolean; activateStatus: boolean;
}
const EMPTY_FORM: RuleForm = {
  ruleName: '', ruleType: '', dataType: '', actionAfterException: '', exceptionLimit: '',
  detectCount: '', leaveType: '', resetStatus: false, activateStatus: false,
};

// Mirrors newform.ctp's submit checks plus its field-level ones (no leading zeros, 1–999).
function validateForm(form: RuleForm): string | null {
  if (!normalizeName(form.ruleName) || !form.ruleType || !form.dataType || !form.actionAfterException ||
      !form.exceptionLimit || !form.detectCount || (form.actionAfterException === '0' && !form.leaveType)) {
    return 'Please fill all required fields before saving.';
  }
  if (!/^[1-9]\d{0,2}$/.test(form.exceptionLimit)) {
    return form.ruleType === 'daily' ? 'Exception count must be a number from 1 to 999.' : 'Exception time limit must be a number from 1 to 999.';
  }
  return null;
}

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const pages = Math.ceil(total / PAGE_SIZE);
  return (
    <div className="flex items-center justify-end gap-3 mt-2 text-[12.5px] text-slate-600">
      <span className="text-slate-400">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
      <button disabled={page === 1} onClick={() => onChange(page - 1)} className="disabled:opacity-40">Previous</button>
      <span className="text-slate-400">Page {page} of {pages}</span>
      <button disabled={page >= pages} onClick={() => onChange(page + 1)} className="disabled:opacity-40">Next</button>
    </div>
  );
}

export default function ExceptionsPage() {
  const { slotEl } = useHeaderSlot();
  const [tab, setTab] = useState<Tab>('rules');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rulesPage, setRulesPage] = useState(1);
  const [applyBranch, setApplyBranch] = useState('');
  const [applyMonth, setApplyMonth] = useState(MONTH_OPTIONS[0].value);
  const [applyRuleId, setApplyRuleId] = useState('');
  const [appliedPage, setAppliedPage] = useState(1);
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const { data: branches = [] } = useSetupOptions('setup/branches', 'branch_code', (r) => String(r.branch_name));
  const { data: rules = [], refetch: refetchRules } = useQuery<Rule[]>({
    queryKey: ['exception-rules'],
    queryFn: () => fetch('/api/attendance/exceptions/rules').then((r) => r.json()).then((b) => b.data ?? []),
  });
  const { data: appliedData, refetch: refetchApplied } = useQuery<{ rows: AppliedRow[]; total: number }>({
    queryKey: ['exception-applied', appliedPage],
    queryFn: () => fetch(`/api/attendance/exceptions/applied?page=${appliedPage}`).then((r) => r.json()),
  });

  const activeRuleOptions = useMemo(
    () => rules.filter((r) => r.activateStatus).map((r) => ({ value: String(r.exceptionId), label: r.ruleName })),
    [rules]
  );
  const pagedRules = rules.slice((rulesPage - 1) * PAGE_SIZE, rulesPage * PAGE_SIZE);

  // Legacy re-reads the active rule list and applied grid every time the Apply tab opens, and
  // the rule grid when going back — so a rule created/deactivated a moment ago shows up right away.
  function switchTab(next: Tab) {
    setTab(next);
    setNotice(null);
    refetchRules();
    if (next === 'apply') refetchApplied();
  }
  // A selection whose rule was since deactivated/deleted counts as no selection.
  const selectedRuleId = activeRuleOptions.some((o) => o.value === applyRuleId) ? applyRuleId : '';

  function set<K extends keyof RuleForm>(key: K, value: RuleForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setFormError(null);
  }
  function openNew() { setForm(EMPTY_FORM); setFormError(null); setEditing('new'); }
  function openEdit(rule: Rule) {
    const ruleType = rule.ruleType === 'daily' || rule.ruleType === 'monthly' ? rule.ruleType : '';
    const limit = ruleType === 'daily' ? rule.exceptionDays : rule.exceptionTime;
    setForm({
      ruleName: rule.ruleName, ruleType, dataType: String(rule.dataType),
      actionAfterException: String(rule.actionAfterException),
      exceptionLimit: limit != null ? String(limit) : '',
      detectCount: rule.detectCount === 0.5 || rule.detectCount === 1 ? String(rule.detectCount) : '',
      leaveType: rule.actionAfterException === 0 && rule.leaveDetectType ? String(rule.leaveDetectType) : '',
      resetStatus: rule.resetStatus, activateStatus: rule.activateStatus,
    });
    setFormError(null);
    setEditing(rule);
  }

  const nameTaken = useMemo(() => {
    const name = normalizeName(form.ruleName).toLowerCase();
    if (!name) return false;
    const ownId = editing && editing !== 'new' ? editing.exceptionId : null;
    return rules.some((r) => r.exceptionId !== ownId && normalizeName(r.ruleName).toLowerCase() === name);
  }, [form.ruleName, rules, editing]);

  const save = useMutation({
    mutationFn: () => {
      const limit = Number(form.exceptionLimit);
      const payload = {
        ruleName: normalizeName(form.ruleName), ruleType: form.ruleType, dataType: Number(form.dataType),
        exceptionDays: form.ruleType === 'daily' ? limit : null,
        exceptionTime: form.ruleType === 'monthly' ? limit : null,
        actionAfterException: Number(form.actionAfterException), detectCount: Number(form.detectCount),
        leaveType: form.actionAfterException === '0' ? Number(form.leaveType) : null,
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
        return isNew;
      });
    },
    onSuccess: (isNew) => {
      setEditing(null);
      setNotice({ kind: 'success', text: isNew ? 'Rule saved successfully' : 'Rule updated successfully' });
      refetchRules();
    },
    onError: (err: Error) => setFormError(err.message),
  });

  function submitForm() {
    if (nameTaken) return setFormError('This rule name already exists!');
    const invalid = validateForm(form);
    if (invalid) return setFormError(invalid);
    save.mutate();
  }

  const removeRule = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/attendance/exceptions/rules/${id}`, { method: 'DELETE' }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? 'Failed to delete rule');
      }),
    onSuccess: () => { setNotice({ kind: 'success', text: 'Rule deleted successfully' }); refetchRules(); },
    onError: (err: Error) => setNotice({ kind: 'error', text: err.message }),
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      fetch('/api/attendance/exceptions/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchCode: applyBranch, ruleId: Number(selectedRuleId), month: applyMonth }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to apply rule');
        return body as { message: string };
      }),
    onSuccess: (body) => {
      setNotice({ kind: 'success', text: `Rule applied successfully. ${body.message ?? ''}`.trim() });
      if (appliedPage === 1) refetchApplied(); else setAppliedPage(1);
    },
    onError: (err: Error) => setNotice({ kind: 'error', text: err.message }),
  });

  const reverseMutation = useMutation({
    mutationFn: (row: AppliedRow) =>
      fetch('/api/attendance/exceptions/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exceptionAppliedPkey: row.exceptionAppliedPkey }),
      }).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? 'Failed to reverse rule');
        return body as { message: string };
      }),
    onSuccess: (body) => { setNotice({ kind: 'success', text: body.message || 'Rule reversed successfully' }); refetchApplied(); },
    onError: (err: Error) => setNotice({ kind: 'error', text: err.message }),
  });

  // Legacy locks Apply / Export / Reverse together while any of them is running.
  const busy = applyMutation.isPending || reverseMutation.isPending || exportingId !== null;

  function applyRule() {
    if (!applyBranch || !selectedRuleId || !applyMonth) {
      setNotice({ kind: 'error', text: 'Please select Branch, Month and Rule before applying.' });
      return;
    }
    setPendingConfirm({ kind: 'apply' });
  }

  // The dialog stays open (with a spinner) until the action settles, then closes either way —
  // the outcome lands in the notice banner.
  const closeConfirm = () => setPendingConfirm(null);
  function runConfirmed() {
    if (!pendingConfirm) return;
    if (pendingConfirm.kind === 'apply') applyMutation.mutate(undefined, { onSettled: closeConfirm });
    else if (pendingConfirm.kind === 'reverse') reverseMutation.mutate(pendingConfirm.row, { onSettled: closeConfirm });
    else removeRule.mutate(pendingConfirm.rule.exceptionId, { onSettled: closeConfirm });
  }
  const confirmPending = applyMutation.isPending || reverseMutation.isPending || removeRule.isPending;

  async function exportLog(row: AppliedRow) {
    setExportingId(row.exceptionAppliedPkey);
    try {
      const res = await fetch(`/api/attendance/exceptions/export?appliedId=${row.exceptionAppliedPkey}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to download change log');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Exception_Logs_${row.ruleId}_${row.appliedDate?.slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice({ kind: 'error', text: (err as Error).message });
    } finally {
      setExportingId(null);
    }
  }

  const appliedTotal = appliedData?.total ?? 0;

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

      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        {([['rules', 'Exception Rules'], ['apply', 'Apply Rules']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={cn(
              'px-4 py-2 -mb-px text-[13px] font-semibold border-b-2 transition-colors',
              tab === key
                ? 'border-[color:var(--color-primary)] text-[color:var(--color-primary)]'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {notice && (
        <div
          className={cn(
            'rounded-xl px-4 py-2.5 mb-4 flex items-center justify-between gap-3 text-[12.5px] border',
            notice.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          )}
        >
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {tab === 'rules' && (
        <>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-[#0F172A]">Exception Rules</h2>
            <button onClick={openNew} className={BTN_PRIMARY}>
              <Plus className="w-3.5 h-3.5" /> Create New Rule
            </button>
          </div>
          <div className="surface-card rounded-xl overflow-x-auto">
            {rules.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No rules yet</div>
            ) : (
              <table className="w-full text-[12.5px] [&_th]:align-bottom [&_td]:align-top [&_th]:break-words [&_td]:break-words [&_td]:[overflow-wrap:anywhere]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-500">
                    <th className="px-3 py-2 font-medium w-14">Sl.No</th>
                    <th className="px-3 py-2 font-medium">Rule Name</th>
                    <th className="px-3 py-2 font-medium">Rule Type</th>
                    <th className="px-3 py-2 font-medium">Data Type</th>
                    <th className="px-3 py-2 font-medium">Exception</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Leave Deduct Count</th>
                    <th className="px-3 py-2 font-medium">Leave Type</th>
                    <th className="px-3 py-2 font-medium">Reset</th>
                    <th className="px-3 py-2 font-medium">Active</th>
                    <th className="px-3 py-2 font-medium">Created On</th>
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRules.map((rule, i) => (
                    <tr key={rule.exceptionId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2 text-slate-400">{(rulesPage - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-3 py-2 font-medium text-[#0F172A] min-w-[120px] max-w-[260px]">{rule.ruleName}</td>
                      <td className="px-3 py-2 capitalize">{rule.ruleType}</td>
                      <td className="px-3 py-2">{labelOf(DATA_TYPE_OPTIONS, rule.dataType) ?? 'Unknown'}</td>
                      <td className="px-3 py-2">{rule.exceptionDays ? `${rule.exceptionDays} Days` : rule.exceptionTime != null ? `${rule.exceptionTime} min` : '—'}</td>
                      <td className="px-3 py-2">{rule.actionAfterException === 1 ? 'Loss of Pay' : 'Leave Deduction'}</td>
                      <td className="px-3 py-2">{rule.detectCount}</td>
                      <td className="px-3 py-2">{labelOf(LEAVE_TYPE_OPTIONS, rule.leaveDetectType) ?? 'LOP'}</td>
                      <td className="px-3 py-2">{rule.resetStatus ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-2">
                        <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-semibold', rule.activateStatus ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                          {rule.activateStatus ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{formatDate(rule.creationTime)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(rule)} title="Edit" className={cn(ICON_BTN, 'hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)]')}>
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setPendingConfirm({ kind: 'delete', rule })}
                            disabled={removeRule.isPending}
                            title="Remove"
                            className={cn(ICON_BTN, 'hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10')}
                          >
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
          <Pager page={rulesPage} total={rules.length} onChange={setRulesPage} />
        </>
      )}

      {tab === 'apply' && (
        <>
          <div className="surface-card rounded-xl px-4 py-3 mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] items-end gap-3">
            <div>
              <label className={LABEL_CLASS}>Branch<RequiredMark /></label>
              <SearchableSelect value={applyBranch} onChange={setApplyBranch} options={branches} placeholder="-- Select Branch --" buttonClassName={INPUT_CLASS} wrap disabled={busy} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Month<RequiredMark /></label>
              <SearchableSelect value={applyMonth} onChange={(v) => setApplyMonth(v || MONTH_OPTIONS[0].value)} options={MONTH_OPTIONS} placeholder="-- Select Month --" buttonClassName={INPUT_CLASS} wrap disabled={busy} />
            </div>
            <div>
              <label className={LABEL_CLASS}>Rule<RequiredMark /></label>
              <SearchableSelect value={selectedRuleId} onChange={setApplyRuleId} options={activeRuleOptions} placeholder="-- Select Rule --" buttonClassName={INPUT_CLASS} wrap disabled={busy} />
            </div>
            <button onClick={applyRule} disabled={busy || !applyBranch || !selectedRuleId} className={cn(BTN_PRIMARY, 'justify-center h-[34px]')}>
              <Play className="w-3.5 h-3.5" /> {applyMutation.isPending ? 'Applying…' : 'Apply'}
            </button>
          </div>

          <h2 className="text-sm font-semibold text-[#0F172A] mb-2">Applied Rules</h2>
          <div className="surface-card rounded-xl overflow-x-auto">
            {(appliedData?.rows.length ?? 0) === 0 ? (
              <div className="px-4 py-6 text-center text-[12.5px] text-slate-400">No rules applied yet</div>
            ) : (
              <table className="w-full text-[12.5px] [&_th]:align-bottom [&_td]:align-top [&_th]:break-words [&_td]:break-words [&_td]:[overflow-wrap:anywhere]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-slate-500">
                    <th className="px-3 py-2 font-medium w-14">Sl.No</th>
                    <th className="px-3 py-2 font-medium">Rule Name</th>
                    <th className="px-3 py-2 font-medium">Branch Name</th>
                    <th className="px-3 py-2 font-medium">Applied Date</th>
                    <th className="px-3 py-2 font-medium">Applied Month</th>
                    <th className="px-3 py-2 font-medium">Applied By</th>
                    <th className="px-3 py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {appliedData?.rows.map((row, i) => (
                    <tr key={row.exceptionAppliedPkey} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2 text-slate-400">{(appliedPage - 1) * PAGE_SIZE + i + 1}</td>
                      <td className="px-3 py-2 font-medium text-[#0F172A] min-w-[120px] max-w-[260px]">{row.ruleName}</td>
                      <td className="px-3 py-2 min-w-[120px] max-w-[260px]">{row.branchName ?? row.branchCode}</td>
                      <td className="px-3 py-2">{formatDate(row.appliedDate)}</td>
                      <td className="px-3 py-2">{monthLabel(row.monthYear)}</td>
                      <td className="px-3 py-2">{row.createdBy || '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => exportLog(row)} disabled={busy} title="Download change log (Excel)" className={cn(ICON_BTN, 'hover:text-emerald-600 hover:bg-emerald-50')}>
                            <FileSpreadsheet className={cn('w-3.5 h-3.5', exportingId === row.exceptionAppliedPkey && 'animate-pulse')} />
                          </button>
                          <button onClick={() => setPendingConfirm({ kind: 'reverse', row })} disabled={busy} title="Reverse" className={cn(ICON_BTN, 'hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10')}>
                            <Undo2 className={cn('w-3.5 h-3.5', reverseMutation.isPending && reverseMutation.variables?.exceptionAppliedPkey === row.exceptionAppliedPkey && 'animate-spin')} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Pager page={appliedPage} total={appliedTotal} onChange={setAppliedPage} />
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in">
          <div className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-3xl animate-modal-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{editing === 'new' ? 'Rule Creation' : 'Edit Rule'}</h2>
              <button onClick={() => setEditing(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 max-h-[70vh] overflow-y-auto pr-1 pb-1">
              <div>
                <div className="flex items-baseline justify-between">
                  <label className={LABEL_CLASS}>Rule Name<RequiredMark /></label>
                  <span className={cn('text-[11px] tabular-nums', form.ruleName.length >= RULE_NAME_MAX ? 'text-amber-600' : 'text-slate-400')}>
                    {form.ruleName.length}/{RULE_NAME_MAX}
                  </span>
                </div>
                <input
                  type="text"
                  maxLength={RULE_NAME_MAX}
                  placeholder="Letters, numbers and spaces only"
                  value={form.ruleName}
                  onChange={(e) =>
                    set('ruleName', e.target.value.replace(/[^A-Za-z0-9\s]/g, '').replace(/\s+/g, ' ').replace(/^ /, '').slice(0, RULE_NAME_MAX))
                  }
                  onBlur={() => set('ruleName', normalizeName(form.ruleName))}
                  className={cn(INPUT_CLASS, 'w-full', nameTaken && 'border-red-400')}
                />
                {nameTaken && <p className="text-[11.5px] text-red-600 mt-1">This rule name already exists!</p>}
              </div>
              <div>
                <label className={LABEL_CLASS}>Rule Type<RequiredMark /></label>
                <div className="flex items-center gap-5 h-[34px]">
                  {(['daily', 'monthly'] as const).map((t) => (
                    <label key={t} className="flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                      <input
                        type="radio"
                        name="ruleType"
                        checked={form.ruleType === t}
                        onChange={() => setForm((f) => ({ ...f, ruleType: t, exceptionLimit: '' }))}
                        className="accent-[color:var(--color-primary)]"
                      />
                      {t === 'daily' ? 'Daily' : 'Monthly'}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={LABEL_CLASS}>Data Type<RequiredMark /></label>
                <SearchableSelect value={form.dataType} onChange={(v) => set('dataType', v)} options={DATA_TYPE_OPTIONS} placeholder="Select" buttonClassName={INPUT_CLASS} wrap />
              </div>
              <div>
                <label className={LABEL_CLASS}>Action for Exception<RequiredMark /></label>
                <SearchableSelect
                  value={form.actionAfterException}
                  onChange={(v) => setForm((f) => ({ ...f, actionAfterException: v, leaveType: v === '0' ? f.leaveType : '' }))}
                  options={ACTION_OPTIONS}
                  placeholder="Select"
                  buttonClassName={INPUT_CLASS} wrap
                />
              </div>

              <div>
                <label className={LABEL_CLASS}>
                  {form.ruleType === 'monthly' ? 'Exception Time Limit (Minutes)' : 'Exception Count'}<RequiredMark />
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={3}
                  disabled={!form.ruleType}
                  placeholder={!form.ruleType ? 'Select a rule type first' : form.ruleType === 'monthly' ? 'Enter time limit in minutes' : 'Enter count'}
                  value={form.exceptionLimit}
                  onChange={(e) => set('exceptionLimit', e.target.value.replace(/\D/g, '').replace(/^0+/, ''))}
                  className={cn(INPUT_CLASS, 'w-full disabled:bg-slate-50 disabled:cursor-not-allowed')}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Count of Deduction<RequiredMark /></label>
                <SearchableSelect value={form.detectCount} onChange={(v) => set('detectCount', v)} options={DEDUCTION_OPTIONS} placeholder="Select (0.5 or 1)" buttonClassName={INPUT_CLASS} wrap />
              </div>

              {form.actionAfterException !== '1' && (
                <div>
                  <label className={LABEL_CLASS}>Leave Type<RequiredMark /></label>
                  <SearchableSelect value={form.leaveType} onChange={(v) => set('leaveType', v)} options={LEAVE_TYPE_OPTIONS} placeholder="Select Leave Type" buttonClassName={INPUT_CLASS} wrap />
                </div>
              )}
              <div className={cn('flex items-end gap-6 pb-1.5', form.actionAfterException === '1' && 'md:col-span-2')}>
                <label className="flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={form.resetStatus} onChange={(e) => set('resetStatus', e.target.checked)} className="accent-[color:var(--color-primary)]" />
                  Reset After Each Cycle
                </label>
                <label className="flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={form.activateStatus} onChange={(e) => set('activateStatus', e.target.checked)} className="accent-[color:var(--color-primary)]" />
                  Activate
                </label>
              </div>
            </div>

            {formError && <p className="mt-4 text-[12px] text-red-600 break-words [overflow-wrap:anywhere]">{formError}</p>}

            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => { setForm(EMPTY_FORM); setFormError(null); }}
                className={cn(BTN_BASE, 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50')}
              >
                Clear
              </button>
              <button onClick={submitForm} disabled={save.isPending} className={BTN_PRIMARY}>
                {save.isPending ? 'Saving…' : 'Save Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingConfirm?.kind === 'apply' && (
        <ConfirmDialog
          open
          title="Apply exception rule?"
          description="The rule will run for every employee in the branch for the selected month."
          details={[
            { label: 'Rule', value: activeRuleOptions.find((o) => o.value === selectedRuleId)?.label ?? '—' },
            { label: 'Branch', value: branches.find((b) => b.value === applyBranch)?.label ?? applyBranch },
            { label: 'Month', value: monthLabel(applyMonth) },
          ]}
          warning="Late-in / early-out punches will be regularized and leave / LOP deductions posted automatically. Only one rule can be applied per branch per month."
          confirmLabel="Apply Rule"
          pendingLabel="Applying…"
          pending={confirmPending}
          onConfirm={runConfirmed}
          onCancel={closeConfirm}
        />
      )}
      {pendingConfirm?.kind === 'reverse' && (
        <ConfirmDialog
          open
          tone="danger"
          title="Reverse applied rule?"
          description="This will undo everything this rule did for the branch and month below."
          details={[
            { label: 'Rule', value: pendingConfirm.row.ruleName },
            { label: 'Branch', value: pendingConfirm.row.branchName ?? pendingConfirm.row.branchCode },
            { label: 'Month', value: monthLabel(pendingConfirm.row.monthYear) },
          ]}
          warning="All attendance regularizations and leave entries applied by this rule will be undone. To restore them, the rule has to be applied again."
          confirmLabel="Reverse Rule"
          pendingLabel="Reversing…"
          pending={confirmPending}
          onConfirm={runConfirmed}
          onCancel={closeConfirm}
        />
      )}
      {pendingConfirm?.kind === 'delete' && (
        <ConfirmDialog
          open
          tone="danger"
          title="Delete rule?"
          description={<>The rule <span className="font-semibold text-[#0F172A] [overflow-wrap:anywhere]">{pendingConfirm.rule.ruleName}</span> will be removed and can no longer be applied. Months it was already applied to are not affected.</>}
          confirmLabel="Delete Rule"
          pendingLabel="Deleting…"
          pending={confirmPending}
          onConfirm={runConfirmed}
          onCancel={closeConfirm}
        />
      )}
    </div>
  );
}
