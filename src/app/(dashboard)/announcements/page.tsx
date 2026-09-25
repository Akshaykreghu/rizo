'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Info, Megaphone, Pencil, Pin, PinOff, Plus, Search, Star, Trash2, Users, X,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { DataTable } from '@/components/data-table/DataTable';
import { SkeletonText } from '@/components/ui/Skeleton';

type Category = 'Emergency' | 'Important' | 'Information';
type AudienceType = 'ALL' | 'EMPLOYEE' | 'BRANCH' | 'DEPARTMENT' | 'DESIGNATION';
type Status = 'Live' | 'Scheduled' | 'Expired';

interface TargetOption { value: string; label: string }

interface AnnouncementRow {
  announcement_pkey: number;
  title: string;
  message: string;
  category: Category;
  is_pinned: boolean;
  audience_type: AudienceType;
  publish_from: string;
  expires_on: string | null;
  created_by: string | null;
  created_date: string | null;
  status: Status;
  recipient_count: number;
  read_count: number;
  targets: TargetOption[];
}

interface FormState {
  title: string;
  message: string;
  category: Category;
  isPinned: boolean;
  audienceType: AudienceType;
  targets: TargetOption[];
  publishFrom: string;
  expiresOn: string;
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyForm = (): FormState => ({
  title: '', message: '', category: 'Information', isPinned: false, audienceType: 'ALL', targets: [],
  publishFrom: todayISO(), expiresOn: '',
});

const CATEGORY_CFG: Record<Category, { icon: LucideIcon; badge: string; tone: string; hint: string }> = {
  Emergency: {
    icon: AlertTriangle,
    badge: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]',
    tone: 'border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-dark)]',
    hint: 'Urgent, time-critical',
  },
  Important: {
    icon: Star,
    badge: 'bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
    tone: 'border-[color:var(--color-highlight-dark)] bg-[color:var(--color-highlight-light)] text-[color:var(--color-highlight-dark)]',
    hint: 'Needs attention',
  },
  Information: {
    icon: Info,
    badge: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)]',
    tone: 'border-[color:var(--color-primary)] bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)]',
    hint: 'General update',
  },
};

const AUDIENCE_CFG: Record<AudienceType, { label: string; short: string }> = {
  ALL: { label: 'All employees', short: 'Everyone' },
  EMPLOYEE: { label: 'Selected members', short: 'Members' },
  BRANCH: { label: 'Branch', short: 'Branch' },
  DEPARTMENT: { label: 'Department', short: 'Department' },
  DESIGNATION: { label: 'Designation', short: 'Designation' },
};

const STATUS_COLORS: Record<Status, string> = {
  Live: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]',
  Scheduled: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)]',
  Expired: 'bg-slate-100 text-slate-500',
};

// Summary cards double as the status filter ('' = all).
const STATUS_CARDS: { key: '' | Status; label: string; icon: LucideIcon; tone: string }[] = [
  { key: '', label: 'All', icon: Megaphone, tone: 'bg-slate-100 text-slate-600' },
  { key: 'Live', label: 'Live', icon: CheckCircle2, tone: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-dark)]' },
  { key: 'Scheduled', label: 'Scheduled', icon: CalendarClock, tone: 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)]' },
  { key: 'Expired', label: 'Expired', icon: X, tone: 'bg-slate-100 text-slate-500' },
];

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const ICON_BTN = 'p-1.5 rounded-lg transition-colors duration-[180ms]';

const MODAL_BOX =
  'relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] w-full max-h-[calc(100vh-2rem)] flex flex-col animate-modal-in';

const LABEL = 'block text-[12px] font-medium text-slate-600 mb-1.5';

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(`${v.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
}

function audienceSummary(r: Pick<AnnouncementRow, 'audience_type' | 'targets'>) {
  if (r.audience_type === 'ALL') return 'All employees';
  const names = r.targets.map((t) => t.label);
  const head = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${head} +${names.length - 2} more` : head;
}

// Checkbox list with a filter box, for picking branches / departments / designations.
function ChecklistPicker({ options, selected, onChange, loading }: {
  options: TargetOption[];
  selected: TargetOption[];
  onChange: (next: TargetOption[]) => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState('');
  const chosen = new Set(selected.map((s) => s.value));
  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));
  const allFilteredChosen = filtered.length > 0 && filtered.every((o) => chosen.has(o.value));

  const toggle = (o: TargetOption) =>
    onChange(chosen.has(o.value) ? selected.filter((s) => s.value !== o.value) : [...selected, o]);
  const toggleAll = () =>
    onChange(allFilteredChosen
      ? selected.filter((s) => !filtered.some((f) => f.value === s.value))
      : [...selected, ...filtered.filter((f) => !chosen.has(f.value))]);

  return (
    <div className="border border-slate-200 rounded-[11px] overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-100 bg-slate-50/60">
        <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="flex-1 bg-transparent text-[12.5px] text-[#0F172A] focus:outline-none"
        />
        <button type="button" onClick={toggleAll} disabled={!filtered.length}
          className="text-[11.5px] font-semibold text-[color:var(--color-primary)] hover:underline disabled:opacity-40">
          {allFilteredChosen ? 'Clear' : 'Select all'}
        </button>
      </div>
      <div className="max-h-44 overflow-y-auto py-1">
        {loading && <div className="px-3 py-2"><SkeletonText lines={4} /></div>}
        {!loading && !filtered.length && <p className="px-3 py-2 text-[12px] text-slate-400">No matches</p>}
        {filtered.map((o) => (
          <label key={o.value} className="flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] text-[#0F172A] hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o)} className="accent-[color:var(--color-primary)]" />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

interface EmployeeHit { emp_pkey: number; first_name: string; last_name: string | null; emp_id: string; emp_company_id?: string | null; desig_name?: string | null }

// Search-and-add picker for individual employees; chosen ones show as removable chips.
function MemberPicker({ selected, onChange }: { selected: TargetOption[]; onChange: (next: TargetOption[]) => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery<{ data: EmployeeHit[] }>({
    queryKey: ['employees', 'search', debounced, 'announcement-picker'],
    queryFn: () => fetch(`/api/employees?search=${encodeURIComponent(debounced)}&pageSize=10`).then((r) => r.json()),
    enabled: debounced.length > 0,
  });
  const chosen = new Set(selected.map((s) => s.value));
  const hits = (data?.data ?? []).filter((e) => !chosen.has(String(e.emp_pkey)));

  const add = (e: EmployeeHit) => {
    const code = e.emp_company_id?.trim() || e.emp_id;
    onChange([...selected, { value: String(e.emp_pkey), label: `${e.first_name} ${e.last_name ?? ''}`.trim() + ` (${code})` }]);
    setQuery('');
  };

  return (
    <div>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or employee ID…"
          className={cn(INPUT_CLASS, 'w-full pl-9 py-2')}
        />
        {debounced && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-[11px] shadow-lg max-h-56 overflow-y-auto py-1">
            {isFetching && !hits.length && <p className="px-3 py-2 text-[12px] text-slate-400">Searching…</p>}
            {!isFetching && !hits.length && <p className="px-3 py-2 text-[12px] text-slate-400">No employees found</p>}
            {hits.map((e) => (
              <button type="button" key={e.emp_pkey} onClick={() => add(e)}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-3">
                <span className="text-[12.5px] text-[#0F172A] truncate">{e.first_name} {e.last_name ?? ''}</span>
                <span className="text-[11px] text-slate-400 flex-shrink-0">{e.emp_company_id?.trim() || e.emp_id}{e.desig_name ? ` · ${e.desig_name}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {selected.map((s) => (
            <span key={s.value} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-[color:var(--color-primary-light)] text-[color:var(--color-primary-dark)] text-[11.5px] font-medium">
              {s.label}
              <button type="button" onClick={() => onChange(selected.filter((x) => x.value !== s.value))} aria-label={`Remove ${s.label}`}
                className="p-0.5 rounded-full hover:bg-white/60">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function useMasterOptions(audienceType: AudienceType) {
  const source = {
    BRANCH: { url: '/api/setup/branches', value: 'branch_code', label: 'branch_name' },
    DEPARTMENT: { url: '/api/setup/departments', value: 'dept_code', label: 'dept_name' },
    DESIGNATION: { url: '/api/setup/designations', value: 'desig_code', label: 'desig_name' },
  }[audienceType as 'BRANCH' | 'DEPARTMENT' | 'DESIGNATION'];

  return useQuery<TargetOption[]>({
    queryKey: ['announcement-audience-options', audienceType],
    queryFn: async () => {
      const rows: Record<string, string>[] = await fetch(source!.url).then((r) => r.json());
      return rows
        .filter((r) => r[source!.value])
        .map((r) => ({ value: String(r[source!.value]), label: String(r[source!.label] ?? r[source!.value]) }));
    },
    enabled: !!source,
    staleTime: 5 * 60_000,
  });
}

function AnnouncementForm({ initial, editingId, onClose }: { initial: FormState; editingId: number | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(initial);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const options = useMasterOptions(form.audienceType);

  const targetKey = form.targets.map((t) => t.value).join(',');
  const { data: reach } = useQuery<{ count: number }>({
    queryKey: ['announcement-reach', form.audienceType, targetKey],
    queryFn: () =>
      fetch('/api/announcements/audience-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audienceType: form.audienceType, targets: form.targets.map((t) => t.value) }),
      }).then(jsonOrThrow),
  });

  const save = useMutation({
    mutationFn: () =>
      fetch(editingId ? `/api/announcements/${editingId}` : '/api/announcements', {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          message: form.message,
          category: form.category,
          isPinned: form.isPinned,
          audienceType: form.audienceType,
          targets: form.targets.map((t) => t.value),
          publishFrom: form.publishFrom,
          expiresOn: form.expiresOn || null,
        }),
      }).then(jsonOrThrow),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      onClose();
    },
  });

  const needsTargets = form.audienceType !== 'ALL';
  const canSave = form.title.trim() && form.message.trim() && form.publishFrom && (!needsTargets || form.targets.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={cn(MODAL_BOX, 'max-w-2xl')}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-lg bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] flex items-center justify-center">
              <Megaphone className="w-4.5 h-4.5" />
            </span>
            <h2 className="text-[17px] font-semibold text-[#0F172A] tracking-tight">{editingId ? 'Edit Announcement' : 'New Announcement'}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="flex flex-col min-h-0">
          <div className="px-6 py-4 space-y-5 overflow-y-auto">
            <div>
              <label className={LABEL}>Type *</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(CATEGORY_CFG) as Category[]).map((c) => {
                  const cfg = CATEGORY_CFG[c];
                  const Icon = cfg.icon;
                  const active = form.category === c;
                  return (
                    <button type="button" key={c} onClick={() => set('category', c)}
                      className={cn('flex items-center gap-2.5 px-3 py-2.5 rounded-[11px] border text-left transition-colors',
                        active ? cfg.tone : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold">{c}</span>
                        <span className={cn('block text-[11px] truncate', active ? 'opacity-80' : 'text-slate-400')}>{cfg.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className={LABEL}>Title *</label>
              <input value={form.title} maxLength={200} onChange={(e) => set('title', e.target.value)}
                placeholder="e.g. Office closed on Friday due to heavy rain" className={cn(INPUT_CLASS, 'w-full py-2')} />
            </div>

            <div>
              <label className={LABEL}>Message *</label>
              <textarea value={form.message} onChange={(e) => set('message', e.target.value)} rows={5}
                placeholder="Write the full announcement…" className={cn(INPUT_CLASS, 'w-full')} />
            </div>

            <div>
              <label className={LABEL}>Send to *</label>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(Object.keys(AUDIENCE_CFG) as AudienceType[]).map((a) => (
                  <button type="button" key={a}
                    onClick={() => setForm((f) => (f.audienceType === a ? f : { ...f, audienceType: a, targets: [] }))}
                    className={cn('px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors',
                      form.audienceType === a
                        ? 'bg-[color:var(--color-primary)] border-[color:var(--color-primary)] text-white'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                    {AUDIENCE_CFG[a].label}
                  </button>
                ))}
              </div>
              {form.audienceType === 'EMPLOYEE' && (
                <MemberPicker selected={form.targets} onChange={(t) => set('targets', t)} />
              )}
              {(form.audienceType === 'BRANCH' || form.audienceType === 'DEPARTMENT' || form.audienceType === 'DESIGNATION') && (
                <ChecklistPicker options={options.data ?? []} loading={options.isLoading} selected={form.targets} onChange={(t) => set('targets', t)} />
              )}
              <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500 mt-2">
                <Users className="w-3.5 h-3.5" />
                {needsTargets && !form.targets.length
                  ? 'Pick at least one recipient'
                  : `Reaches ${reach?.count ?? '…'} active employee${reach?.count === 1 ? '' : 's'}`}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div>
                <label className={LABEL}>Publish from *</label>
                <input type="date" required value={form.publishFrom} onChange={(e) => set('publishFrom', e.target.value)}
                  className={cn(INPUT_CLASS, 'w-full py-2')} />
              </div>
              <div>
                <label className={LABEL}>Expires on</label>
                <input type="date" value={form.expiresOn} min={form.publishFrom} onChange={(e) => set('expiresOn', e.target.value)}
                  className={cn(INPUT_CLASS, 'w-full py-2')} />
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-[#0F172A] pb-2 cursor-pointer">
                <input type="checkbox" checked={form.isPinned} onChange={(e) => set('isPinned', e.target.checked)} className="accent-[color:var(--color-primary)]" />
                <Pin className="w-3.5 h-3.5 text-slate-500" /> Pin to top
              </label>
            </div>

            {save.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{save.error.message}</p>}
          </div>

          <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
              Cancel
            </button>
            <button type="submit" disabled={save.isPending || !canSave}
              className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
              {save.isPending ? 'Saving…' : editingId ? 'Save Changes' : 'Publish'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AnnouncementsPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ id: number | null; initial: FormState } | null>(null);
  const [viewRow, setViewRow] = useState<AnnouncementRow | null>(null);
  const [removeRow, setRemoveRow] = useState<AnnouncementRow | null>(null);

  const { data, isLoading } = useQuery<{ data: AnnouncementRow[] }>({
    queryKey: ['announcements'],
    queryFn: () => fetch('/api/announcements').then(jsonOrThrow),
  });
  const all = useMemo(() => data?.data ?? [], [data]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': all.length, Live: 0, Scheduled: 0, Expired: 0 };
    for (const r of all) c[r.status] += 1;
    return c;
  }, [all]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) =>
      (!statusFilter || r.status === statusFilter) &&
      (!q || r.title.toLowerCase().includes(q) || r.message.toLowerCase().includes(q) || audienceSummary(r).toLowerCase().includes(q)));
  }, [all, statusFilter, search]);

  const pin = useMutation({
    mutationFn: (r: AnnouncementRow) =>
      fetch(`/api/announcements/${r.announcement_pkey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: !r.is_pinned }),
      }).then(jsonOrThrow),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['announcements'] }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => fetch(`/api/announcements/${id}`, { method: 'DELETE' }).then(jsonOrThrow),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      setRemoveRow(null);
    },
  });

  const openEdit = (r: AnnouncementRow) =>
    setEditor({
      id: r.announcement_pkey,
      initial: {
        title: r.title, message: r.message, category: r.category, isPinned: r.is_pinned,
        audienceType: r.audience_type, targets: r.targets, publishFrom: r.publish_from, expiresOn: r.expires_on ?? '',
      },
    });

  const columns: ColumnDef<AnnouncementRow, unknown>[] = [
    {
      id: 'title',
      header: 'Announcement',
      accessorKey: 'title',
      cell: ({ row: { original: r } }) => {
        const cfg = CATEGORY_CFG[r.category];
        const Icon = cfg.icon;
        return (
          <div className="flex items-start gap-2.5 min-w-[240px] max-w-md">
            <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', cfg.badge)}>
              <Icon className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#0F172A] truncate flex items-center gap-1.5">
                {r.is_pinned && <Pin className="w-3 h-3 text-[color:var(--color-primary)] flex-shrink-0" />}
                {r.title}
              </p>
              <p className="text-[11.5px] text-slate-500 truncate">{r.message}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: 'category',
      header: 'Type',
      accessorKey: 'category',
      cell: ({ row: { original: r } }) => (
        <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', CATEGORY_CFG[r.category].badge)}>{r.category}</span>
      ),
    },
    {
      id: 'audience',
      header: 'Audience',
      accessorFn: (r) => audienceSummary(r),
      cell: ({ row: { original: r } }) => (
        <div className="max-w-[220px]">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{AUDIENCE_CFG[r.audience_type].short}</p>
          <p className="text-[12.5px] text-[#0F172A] truncate" title={r.targets.map((t) => t.label).join(', ')}>{audienceSummary(r)}</p>
        </div>
      ),
    },
    {
      id: 'dates',
      header: 'Visible',
      accessorKey: 'publish_from',
      cell: ({ row: { original: r } }) => (
        <span className="text-[12.5px] text-slate-600 whitespace-nowrap">
          {fmtDate(r.publish_from)} → {r.expires_on ? fmtDate(r.expires_on) : 'No expiry'}
        </span>
      ),
    },
    {
      id: 'reads',
      header: 'Seen',
      accessorKey: 'read_count',
      cell: ({ row: { original: r } }) => (
        <span className="text-[12.5px] text-slate-600 tabular-nums whitespace-nowrap">
          {r.read_count} / {r.recipient_count}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      cell: ({ row: { original: r } }) => (
        <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_COLORS[r.status])}>{r.status}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => pin.mutate(r)} title={r.is_pinned ? 'Unpin' : 'Pin to top'} aria-label={r.is_pinned ? 'Unpin' : 'Pin'}
            className={cn(ICON_BTN, 'bg-slate-100 text-slate-600 hover:bg-slate-700 hover:text-white')}>
            {r.is_pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
          </button>
          <button onClick={() => openEdit(r)} title="Edit" aria-label="Edit announcement"
            className={cn(ICON_BTN, 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)] hover:text-white')}>
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => { remove.reset(); setRemoveRow(r); }} title="Delete" aria-label="Delete announcement"
            className={cn(ICON_BTN, 'text-slate-400 hover:bg-[color:var(--color-danger-soft)] hover:text-[color:var(--color-danger)]')}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const detail = (label: string, value: React.ReactNode) => (
    <div className="flex gap-3 py-2 border-b border-slate-100 last:border-0">
      <span className="w-28 flex-shrink-0 text-[12px] text-slate-500">{label}</span>
      <span className="text-[12.5px] text-[#0F172A] break-words min-w-0">{value || '—'}</span>
    </div>
  );

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">Announcements</h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Post emergency alerts and company updates to employees&apos; home page
            </p>
          </div>,
          slotEl
        )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {STATUS_CARDS.map((c) => {
          const active = statusFilter === c.key;
          const Icon = c.icon;
          return (
            <button key={c.key || 'all'} onClick={() => setStatusFilter(c.key)}
              className={cn(
                'surface-card rounded-xl px-4 py-3 text-left flex items-center gap-3 transition-all duration-150 border',
                active ? 'border-[color:var(--color-primary)] ring-2 ring-[color:var(--color-primary)]/15' : 'border-transparent hover:border-slate-200'
              )}>
              <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', c.tone)}>
                <Icon className="w-4.5 h-4.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11.5px] font-medium text-slate-500">{c.label}</span>
                <span className="block text-[17px] font-bold text-[#0F172A] leading-tight">{counts[c.key] ?? 0}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, message, audience…"
            className={cn(INPUT_CLASS, 'w-full pl-9 py-2')} />
        </div>
        <button onClick={() => setEditor({ id: null, initial: emptyForm() })}
          className={cn(BTN_BASE, 'ml-auto py-2 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}>
          <Plus className="w-3.5 h-3.5" />
          New Announcement
        </button>
      </div>

      {pin.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mb-3">{pin.error.message}</p>}

      <DataTable data={rows} columns={columns} pageSize={10} pageSizeOptions={[10, 20, 30, 50]} isLoading={isLoading}
        onRowClick={(r) => setViewRow(r)} />

      {editor && (
        <AnnouncementForm key={editor.id ?? 'new'} initial={editor.initial} editingId={editor.id} onClose={() => setEditor(null)} />
      )}

      {viewRow && (() => {
        const cfg = CATEGORY_CFG[viewRow.category];
        const Icon = cfg.icon;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setViewRow(null)}>
            <div onClick={(e) => e.stopPropagation()} className={cn(MODAL_BOX, 'max-w-lg')}>
              <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
                <span className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', cfg.badge)}>
                  <Icon className="w-4.5 h-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[16px] font-semibold text-[#0F172A] truncate">{viewRow.title}</h2>
                  <p className="text-[11.5px] text-slate-400">{viewRow.category}{viewRow.is_pinned ? ' · Pinned' : ''}</p>
                </div>
                <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_COLORS[viewRow.status])}>{viewRow.status}</span>
                <button onClick={() => setViewRow(null)} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
              <div className="px-6 py-3 overflow-y-auto">
                <p className="rounded-xl bg-slate-50 px-4 py-3 mb-3 text-[13px] text-[#0F172A] whitespace-pre-wrap">{viewRow.message}</p>
                {detail('Audience', viewRow.audience_type === 'ALL' ? 'All employees' : (
                  <span className="flex flex-wrap gap-1">
                    {viewRow.targets.map((t) => (
                      <span key={t.value} className="px-2 py-0.5 rounded-full bg-slate-100 text-[11.5px]">{t.label}</span>
                    ))}
                  </span>
                ))}
                {detail('Seen by', `${viewRow.read_count} of ${viewRow.recipient_count} employees`)}
                {detail('Publish from', fmtDate(viewRow.publish_from))}
                {detail('Expires on', viewRow.expires_on ? fmtDate(viewRow.expires_on) : 'No expiry')}
                {detail('Posted by', viewRow.created_by ? `${viewRow.created_by} · ${viewRow.created_date ?? ''}` : null)}
              </div>
            </div>
          </div>
        );
      })()}

      {removeRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setRemoveRow(null)}>
          <div onClick={(e) => e.stopPropagation()} className={cn(MODAL_BOX, 'max-w-sm p-6 text-center')}>
            <span className="w-11 h-11 rounded-full bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger)] flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-5 h-5" />
            </span>
            <h2 className="text-[16px] font-semibold text-[#0F172A]">Delete this announcement?</h2>
            <p className="text-[12.5px] text-slate-500 mt-1">
              &ldquo;{removeRow.title}&rdquo; will disappear from every employee&apos;s home page.
            </p>
            {remove.isError && <p className="text-[color:var(--color-danger)] text-[12.5px] mt-2">{remove.error.message}</p>}
            <div className="flex justify-center gap-2 pt-5">
              <button onClick={() => setRemoveRow(null)} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150">
                Cancel
              </button>
              <button onClick={() => remove.mutate(removeRow.announcement_pkey)} disabled={remove.isPending}
                className={cn(BTN_BASE, 'bg-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-dark)] text-white')}>
                {remove.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
