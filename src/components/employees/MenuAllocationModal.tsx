'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ChevronDown, Check, Minus, Search, Building2, Blocks, LayoutGrid, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MenuNode } from '@/components/employees/MenuTree';

interface FeatureRow { feature_id: number; feature_name: string; description: string | null }
interface FeatureAccess { mode: 'branch' | 'hierarchy'; branches: string[] }
interface BranchOption { branch_code: string; branch_name: string }

interface MenuAllocationData {
  tree: MenuNode[];
  assigned: number[];
  features: FeatureRow[];
  featureAccess: Record<number, FeatureAccess>;
}

interface MenuAllocationModalProps {
  empPkey: number;
  onClose: () => void;
}

const FEATURE_ACCENTS = [
  { fg: 'var(--color-primary)', bg: 'var(--color-primary-soft)' },
  { fg: 'var(--color-accent)', bg: 'var(--color-accent-soft)' },
  { fg: 'var(--color-success)', bg: 'var(--color-success-soft)' },
  { fg: 'var(--color-highlight-dark)', bg: 'var(--color-highlight-light)' },
  { fg: 'var(--color-danger)', bg: 'var(--color-danger-soft)' },
];

type TriState = 'full' | 'partial' | 'none';

function collectSubtreeIds(node: MenuNode): number[] {
  return [node.menu_id, ...node.children.flatMap(collectSubtreeIds)];
}

function collectParentIds(nodes: MenuNode[]): number[] {
  return nodes.flatMap((n) => (n.children.length ? [n.menu_id, ...collectParentIds(n.children)] : []));
}

function computeNodeState(node: MenuNode, checked: Set<number>): { state: TriState; selectedDirect: number; totalDirect: number } {
  if (node.children.length === 0) {
    return { state: checked.has(node.menu_id) ? 'full' : 'none', selectedDirect: 0, totalDirect: 0 };
  }
  const childStates = node.children.map((c) => computeNodeState(c, checked));
  const selectedDirect = childStates.filter((s) => s.state === 'full').length;
  const totalDirect = node.children.length;
  const anyPartial = childStates.some((s) => s.state === 'partial');
  const state: TriState = selectedDirect === totalDirect ? 'full' : selectedDirect === 0 && !anyPartial ? 'none' : 'partial';
  return { state, selectedDirect, totalDirect };
}

function subtreeMatchesSearch(node: MenuNode, query: string): boolean {
  if (node.menu_title.toLowerCase().includes(query)) return true;
  return node.children.some((c) => subtreeMatchesSearch(c, query));
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-[color:var(--color-highlight)]/45 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function MenuAllocationModal({ empPkey, onClose }: MenuAllocationModalProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'menus' | 'addons'>('menus');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [choiceFeature, setChoiceFeature] = useState<FeatureRow | null>(null);
  const [branchModalFeature, setBranchModalFeature] = useState<FeatureRow | null>(null);
  const [branchSelection, setBranchSelection] = useState<Set<string>>(new Set());
  const [justSaved, setJustSaved] = useState(false);

  const queryKey = ['employees/menu-allocation', empPkey];
  const { data, isLoading } = useQuery<MenuAllocationData>({
    queryKey,
    queryFn: () => fetch(`/api/employees/menu-allocation/${empPkey}`).then((r) => r.json()),
  });

  const { data: branches = [] } = useQuery<BranchOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ branch_code: String(r.branch_code), branch_name: String(r.branch_name) }))
    ),
  });

  useEffect(() => {
    if (data?.assigned) setChecked(new Set(data.assigned));
  }, [data]);

  useEffect(() => {
    if (data?.tree) setExpanded(new Set(collectParentIds(data.tree)));
  }, [data]);

  const save = useMutation({
    mutationFn: () => fetch(`/api/employees/menu-allocation/${empPkey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_ids: Array.from(checked) }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1800);
    },
  });

  const setFeature = useMutation({
    mutationFn: (vars: { featureId: number; active: boolean; mode: 'branch' | 'hierarchy' }) =>
      fetch(`/api/employees/menu-allocation/${empPkey}/feature`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: vars.featureId, active: vars.active, mode: vars.mode }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const saveBranches = useMutation({
    mutationFn: (vars: { featureId: number; branches: string[] }) =>
      fetch(`/api/employees/menu-allocation/${empPkey}/feature/branches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: vars.featureId, branches: vars.branches }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setBranchModalFeature(null);
    },
  });

  function toggleNode(node: MenuNode) {
    const { state } = computeNodeState(node, checked);
    const ids = collectSubtreeIds(node);
    setChecked((prev) => {
      const next = new Set(prev);
      if (state === 'full') ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    if (data?.tree) setExpanded(new Set(collectParentIds(data.tree)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  function toggleFeature(feature: FeatureRow, isOn: boolean) {
    if (isOn) {
      setChoiceFeature(feature);
    } else {
      setFeature.mutate({ featureId: feature.feature_id, active: false, mode: 'branch' });
    }
  }

  function chooseBranchWise(feature: FeatureRow) {
    setChoiceFeature(null);
    setFeature.mutate(
      { featureId: feature.feature_id, active: true, mode: 'branch' },
      { onSuccess: () => openBranchModal(feature, true) }
    );
  }

  function chooseHierarchy(feature: FeatureRow) {
    setChoiceFeature(null);
    setFeature.mutate({ featureId: feature.feature_id, active: true, mode: 'hierarchy' });
  }

  function openBranchModal(feature: FeatureRow, defaultAll: boolean) {
    const existing = data?.featureAccess[feature.feature_id];
    if (defaultAll || !existing || existing.mode === 'hierarchy' || existing.branches.length === 0) {
      setBranchSelection(new Set(branches.map((b) => b.branch_code)));
    } else {
      setBranchSelection(new Set(existing.branches));
    }
    setBranchModalFeature(feature);
  }

  function switchToHierarchy(feature: FeatureRow) {
    if (!confirm(`Switch to Hierarchy? This will remove all specific branch selections for ${feature.feature_name}.`)) return;
    setFeature.mutate({ featureId: feature.feature_id, active: true, mode: 'hierarchy' });
  }

  function toggleBranchSelection(code: string) {
    setBranchSelection((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function scopeText(feature: FeatureRow): string {
    const access = data?.featureAccess[feature.feature_id];
    if (!access) return 'Not Assigned';
    if (access.mode === 'hierarchy') return 'Reporting Hierarchy';
    if (access.branches.length === 0) return 'No branches selected';
    if (branches.length > 0 && access.branches.length === branches.length) return 'All Branches';
    return access.branches.map((code) => branches.find((b) => b.branch_code === code)?.branch_name ?? code).join(', ');
  }

  function renderTree(nodes: MenuNode[], depth: number) {
    const query = search.trim().toLowerCase();
    const visible = query ? nodes.filter((n) => subtreeMatchesSearch(n, query)) : nodes;
    if (!visible.length) return null;

    return (
      <ul className={cn(depth > 0 ? 'ml-[17px] pl-[14px] border-l border-slate-200/70 space-y-0.5' : 'space-y-0.5')}>
        {visible.map((node) => {
          const hasChildren = node.children.length > 0;
          const { state, selectedDirect, totalDirect } = computeNodeState(node, checked);
          const isExpanded = query ? true : expanded.has(node.menu_id);

          return (
            <li key={node.menu_id}>
              <div
                onClick={() => hasChildren && toggleExpand(node.menu_id)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors duration-[140ms]',
                  hasChildren && 'cursor-pointer',
                  state !== 'none' ? 'bg-[color:var(--color-primary)]/[0.045]' : 'hover:bg-[color:var(--color-primary)]/[0.025]'
                )}
              >
                {hasChildren ? (
                  isExpanded
                    ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                ) : (
                  <span className="w-3.5 flex-shrink-0" />
                )}

                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleNode(node); }}
                  aria-label={node.menu_title}
                  className={cn(
                    'w-[18px] h-[18px] rounded-[6px] flex items-center justify-center flex-shrink-0 border transition-colors duration-[140ms]',
                    state === 'none' ? 'border-slate-300 bg-white' : 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]'
                  )}
                >
                  {state === 'full' && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                  {state === 'partial' && <Minus className="w-3 h-3 text-white" strokeWidth={3} />}
                </button>

                <span className={cn('text-sm flex-1 truncate', hasChildren ? 'font-semibold text-[#0F172A]' : 'text-slate-600')}>
                  {highlightMatch(node.menu_title, query)}
                </span>

                {hasChildren && (
                  <span
                    className={cn(
                      'text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 tabular-nums',
                      state === 'full'
                        ? 'bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]'
                        : state === 'partial'
                          ? 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]'
                          : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    {selectedDirect} / {totalDirect}
                  </span>
                )}
              </div>
              {hasChildren && isExpanded && renderTree(node.children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  const menusSelectedCount = checked.size;
  const addonsSelectedCount = data ? data.features.filter((f) => data.featureAccess[f.feature_id]).length : 0;
  const totalAccessCount = menusSelectedCount + addonsSelectedCount;

  const summaryCards = [
    { label: 'Menus Selected', value: menusSelectedCount, icon: LayoutGrid, fg: 'var(--color-primary)', bg: 'var(--color-primary-soft)' },
    { label: 'Add-ons Selected', value: addonsSelectedCount, icon: Blocks, fg: 'var(--color-success)', bg: 'var(--color-success-soft)' },
    { label: 'Total Access', value: totalAccessCount, icon: ShieldCheck, fg: 'var(--color-accent)', bg: 'var(--color-accent-soft)' },
  ];

  return (
    <div className="flex flex-col -m-6 max-h-[85vh]">
      {/* Sticky header: title, tabs, summary */}
      <div className="flex-shrink-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 px-6 pt-6 pb-4 rounded-t-2xl">
        <h2 className="font-heading text-[20px] font-bold text-[#0F172A] tracking-tight">Menu Allocation</h2>
        <p className="text-[13.5px] text-slate-500 mt-1">Control which menus and add-on features this employee can access.</p>

        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
          <div className="inline-flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {([{ key: 'menus', label: 'Menu Structure' }, { key: 'addons', label: 'Add-on Features' }] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-[160ms]',
                  tab === t.key
                    ? 'bg-white text-[color:var(--color-primary)] shadow-sm border border-[color:var(--color-primary)]/15'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {summaryCards.map((c) => (
              <div key={c.label} className="flex items-center gap-2 rounded-xl px-3 py-1.5 bg-slate-50 border border-slate-100">
                <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: c.bg, color: c.fg }}>
                  <c.icon className="w-3.5 h-3.5" strokeWidth={1.75} />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-bold text-[#0F172A]">{c.value}</p>
                  <p className="text-[10px] text-slate-400 -mt-0.5">{c.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scroll-fade px-6 py-5">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : tab === 'menus' ? (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search menus..."
                  className="w-full h-9 pl-8 pr-3 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/30 focus:border-[color:var(--color-primary)]/30 transition-colors duration-[140ms]"
                />
              </div>
              <button onClick={expandAll} className="text-xs font-medium text-slate-500 hover:text-[color:var(--color-primary)] px-2 py-1.5 transition-colors duration-[140ms]">
                Expand All
              </button>
              <button onClick={collapseAll} className="text-xs font-medium text-slate-500 hover:text-[color:var(--color-primary)] px-2 py-1.5 transition-colors duration-[140ms]">
                Collapse All
              </button>
            </div>

            <div className="border border-slate-200 rounded-2xl p-3">
              {renderTree(data?.tree ?? [], 0)}
            </div>
          </div>
        ) : (
          <div>
            <p className="text-xs text-slate-500 mb-4">
              Scope each add-on to specific branches, or to the employee&apos;s reporting hierarchy.
            </p>
            <div>
              {(data?.features ?? []).map((feature, i) => {
                const access = data?.featureAccess[feature.feature_id];
                const isOn = !!access;
                const isHierarchy = access?.mode === 'hierarchy';
                const accent = FEATURE_ACCENTS[i % FEATURE_ACCENTS.length];
                const isLast = i === (data?.features.length ?? 0) - 1;

                return (
                  <div key={feature.feature_id}>
                    <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                      <span
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: accent.bg, color: accent.fg }}
                      >
                        <Blocks className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-[#0F172A] truncate">{feature.feature_name}</p>
                          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={(e) => toggleFeature(feature, e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-checked:bg-[color:var(--color-primary)] rounded-full transition-colors relative">
                              <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                            </div>
                          </label>
                        </div>
                        {feature.description && (
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{feature.description}</p>
                        )}
                        {isOn && (
                          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => !isHierarchy && openBranchModal(feature, false)}
                              disabled={isHierarchy}
                              className={cn(
                                'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg transition-colors duration-[140ms]',
                                isHierarchy
                                  ? 'text-slate-500 bg-slate-50 cursor-default'
                                  : 'text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/[0.06] hover:bg-[color:var(--color-primary)]/[0.12] cursor-pointer'
                              )}
                            >
                              <Building2 className="w-3 h-3" /> {scopeText(feature)}
                            </button>
                            {!isHierarchy ? (
                              <button
                                onClick={() => switchToHierarchy(feature)}
                                className="text-xs text-slate-400 hover:text-[color:var(--color-danger)] transition-colors duration-[140ms]"
                              >
                                Switch to Hierarchy
                              </button>
                            ) : (
                              <button
                                onClick={() => openBranchModal(feature, false)}
                                className="text-xs text-slate-400 hover:text-[color:var(--color-primary)] transition-colors duration-[140ms]"
                              >
                                Switch to Branch Wise
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {!isLast && (
                      <div className="flex pl-[35px]">
                        <div className="w-px h-3 bg-slate-200" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 bg-white/95 backdrop-blur-sm rounded-b-2xl">
        <button
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors duration-[180ms]"
        >
          Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-[color:var(--color-primary)] hover:scale-[1.03] disabled:opacity-50 disabled:hover:scale-100 text-white shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
        >
          {save.isPending ? 'Saving…' : justSaved ? (<><Check className="w-4 h-4" strokeWidth={2.5} /> Saved</>) : 'Save Menu Access'}
        </button>
      </div>

      {choiceFeature && (
        <div className="fixed inset-0 z-[60] bg-slate-900/35 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" onClick={() => setChoiceFeature(null)}>
          <div className="surface-card rounded-2xl p-6 w-full max-w-sm animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[#0F172A]">Access Configuration: {choiceFeature.feature_name}</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">Select how to allocate this feature for the employee.</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => chooseBranchWise(choiceFeature)}
                className="border-2 border-slate-100 hover:border-[color:var(--color-primary)]/50 rounded-xl p-4 text-center transition-colors duration-[180ms]"
              >
                <div className="text-sm font-semibold text-[#0F172A]">Branch Wise</div>
                <div className="text-xs text-slate-500 mt-1">Allocate to specific branches. Defaults to all.</div>
              </button>
              <button
                onClick={() => chooseHierarchy(choiceFeature)}
                className="border-2 border-slate-100 hover:border-[color:var(--color-primary)]/50 rounded-xl p-4 text-center transition-colors duration-[180ms]"
              >
                <div className="text-sm font-semibold text-[#0F172A]">Hierarchy Wise</div>
                <div className="text-xs text-slate-500 mt-1">Follows the employee&apos;s reporting hierarchy.</div>
              </button>
            </div>
            <button onClick={() => setChoiceFeature(null)} className="mt-4 text-xs text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {branchModalFeature && (
        <div className="fixed inset-0 z-[60] bg-slate-900/35 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" onClick={() => setBranchModalFeature(null)}>
          <div className="surface-card rounded-2xl w-full max-w-sm max-h-[70vh] flex flex-col animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-[#0F172A]">Manage Branch Access: {branchModalFeature.feature_name}</h3>
            </div>
            <div className="p-4 overflow-y-auto scroll-fade flex-1">
              <label className="flex items-center gap-2 text-sm font-medium mb-2 pb-2 border-b border-slate-100">
                <input
                  type="checkbox"
                  checked={branchSelection.size === branches.length && branches.length > 0}
                  onChange={(e) => setBranchSelection(e.target.checked ? new Set(branches.map((b) => b.branch_code)) : new Set())}
                  className="accent-[color:var(--color-primary)]"
                />
                All Branches
              </label>
              {branches.map((b) => (
                <label key={b.branch_code} className="flex items-center gap-2 text-sm py-1.5">
                  <input
                    type="checkbox"
                    checked={branchSelection.has(b.branch_code)}
                    onChange={() => toggleBranchSelection(b.branch_code)}
                    className="accent-[color:var(--color-primary)]"
                  />
                  {b.branch_name} ({b.branch_code})
                </label>
              ))}
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 rounded-b-2xl">
              <button onClick={() => setBranchModalFeature(null)} className="text-sm px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors duration-[180ms]">
                Cancel
              </button>
              <button
                onClick={() => saveBranches.mutate({ featureId: branchModalFeature.feature_id, branches: Array.from(branchSelection) })}
                disabled={saveBranches.isPending}
                className="text-sm px-3 py-1.5 rounded-lg text-white bg-[color:var(--color-primary)] hover:opacity-90 disabled:opacity-50 transition-colors duration-[180ms]"
              >
                {saveBranches.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
