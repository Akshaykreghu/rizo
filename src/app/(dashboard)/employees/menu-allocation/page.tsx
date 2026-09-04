'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { MenuTree, type MenuNode } from '@/components/employees/MenuTree';
import { cn } from '@/lib/utils';
import { useSetupRows } from '@/lib/setupOptions';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface FeatureRow { feature_id: number; feature_name: string; description: string | null }
interface FeatureAccess { mode: 'branch' | 'hierarchy'; branches: string[] }
interface BranchOption { branch_code: string; branch_name: string }

interface MenuAllocationData {
  tree: MenuNode[];
  assigned: number[];
  features: FeatureRow[];
  featureAccess: Record<number, FeatureAccess>;
}

export default function MenuAllocationPage() {
  const { slotEl } = useHeaderSlot();
  const queryClient = useQueryClient();
  const [empFkey, setEmpFkey] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [choiceFeature, setChoiceFeature] = useState<FeatureRow | null>(null);
  const [branchModalFeature, setBranchModalFeature] = useState<FeatureRow | null>(null);
  const [branchSelection, setBranchSelection] = useState<Set<string>>(new Set());

  const queryKey = ['employees/menu-allocation', empFkey];
  const { data, isLoading } = useQuery<MenuAllocationData>({
    queryKey,
    queryFn: () => fetch(`/api/employees/menu-allocation/${empFkey}`).then((r) => r.json()),
    enabled: !!empFkey,
  });

  const { data: branches = [] } = useSetupRows<BranchOption>('setup/branches');

  useEffect(() => {
    if (data?.assigned) setChecked(new Set(data.assigned));
  }, [data]);

  const save = useMutation({
    mutationFn: () => fetch(`/api/employees/menu-allocation/${empFkey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menu_ids: Array.from(checked) }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const setFeature = useMutation({
    mutationFn: (vars: { featureId: number; active: boolean; mode: 'branch' | 'hierarchy' }) =>
      fetch(`/api/employees/menu-allocation/${empFkey}/feature`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: vars.featureId, active: vars.active, mode: vars.mode }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const saveBranches = useMutation({
    mutationFn: (vars: { featureId: number; branches: string[] }) =>
      fetch(`/api/employees/menu-allocation/${empFkey}/feature/branches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature_id: vars.featureId, branches: vars.branches }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setBranchModalFeature(null);
    },
  });

  function toggle(menuId: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(menuId)) next.delete(menuId);
      else next.add(menuId);
      return next;
    });
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

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Menu Allocation
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Assign standard menus and add-on feature access per employee
            </p>
          </div>,
          slotEl
        )}

      <div className="surface-card rounded-xl px-4 py-4 max-w-2xl mb-5">
        <label className="block text-[11.5px] font-medium text-slate-500 mb-1">Employee</label>
        <EmployeeSearch
          value={empFkey}
          onChange={(v) => { setEmpFkey(v); setChecked(new Set()); }}
        />
      </div>

      {empFkey && (
        isLoading ? (
          <p className="text-[12.5px] text-slate-500">Loading menu tree…</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="surface-card rounded-2xl p-5">
              <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Standard Menus</h2>
              <div className="max-h-96 overflow-y-auto border border-slate-100 rounded-xl p-3">
                <MenuTree nodes={data?.tree ?? []} checked={checked} onToggle={toggle} />
              </div>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className={cn(BTN_BASE, 'mt-4 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
              >
                {save.isPending ? 'Saving…' : 'Save Menu Access'}
              </button>
              {save.isSuccess && <span className="ml-3 text-[12.5px] text-[color:var(--color-success-dark)]">Saved</span>}
            </div>

            <div className="surface-card rounded-2xl p-5">
              <h2 className="text-[13.5px] font-semibold text-slate-600 uppercase tracking-wide mb-3">Add-on Menus</h2>
              <p className="text-[11.5px] text-slate-400 mb-3">
                Scope each add-on to specific branches, or to the employee&apos;s reporting hierarchy.
              </p>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {(data?.features ?? []).map((feature) => {
                  const access = data?.featureAccess[feature.feature_id];
                  const isOn = !!access;
                  const isHierarchy = access?.mode === 'hierarchy';
                  return (
                    <div key={feature.feature_id} className="border border-slate-100 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-[#0F172A] truncate">{feature.feature_name}</div>
                          {feature.description && (
                            <div className="text-[11px] text-slate-400 truncate">{feature.description}</div>
                          )}
                        </div>
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
                      {isOn && (
                        <div className="flex gap-2 mt-2">
                          {isHierarchy ? (
                            <button
                              onClick={() => openBranchModal(feature, false)}
                              className="text-[11.5px] border border-[color:var(--color-primary)]/30 text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] px-2.5 py-1 rounded-md"
                            >
                              Set Branch Wise
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => openBranchModal(feature, false)}
                                className="text-[11.5px] border border-[color:var(--color-primary)]/30 text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] px-2.5 py-1 rounded-md"
                              >
                                Manage Branch
                              </button>
                              <button
                                onClick={() => switchToHierarchy(feature)}
                                className="text-[11.5px] border border-[color:var(--color-danger)]/30 text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-light)] px-2.5 py-1 rounded-md"
                              >
                                Set Hierarchy
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      )}

      {choiceFeature && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setChoiceFeature(null)}>
          <div onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-96 animate-modal-in">
            <h3 className="text-[16px] font-semibold text-[#0F172A] mb-1">Access Configuration: {choiceFeature.feature_name}</h3>
            <p className="text-[11.5px] text-slate-500 mb-4">Select how to allocate this feature for the employee.</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => chooseBranchWise(choiceFeature)}
                className="border-2 border-slate-100 hover:border-[color:var(--color-primary)]/50 rounded-xl p-4 text-center transition-colors"
              >
                <div className="text-[13px] font-semibold text-[#0F172A]">Branch Wise</div>
                <div className="text-[11px] text-slate-500 mt-1">Allocate to specific branches. Defaults to all.</div>
              </button>
              <button
                onClick={() => chooseHierarchy(choiceFeature)}
                className="border-2 border-slate-100 hover:border-[color:var(--color-primary)]/50 rounded-xl p-4 text-center transition-colors"
              >
                <div className="text-[13px] font-semibold text-[#0F172A]">Hierarchy Wise</div>
                <div className="text-[11px] text-slate-500 mt-1">Follows the employee&apos;s reporting hierarchy.</div>
              </button>
            </div>
            <button onClick={() => setChoiceFeature(null)} className="mt-4 text-[11.5px] text-slate-400 hover:text-slate-600">Cancel</button>
          </div>
        </div>
      )}

      {branchModalFeature && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={() => setBranchModalFeature(null)}>
          <div onClick={(e) => e.stopPropagation()} className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] w-96 max-h-[70vh] flex flex-col animate-modal-in">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-[16px] font-semibold text-[#0F172A]">Manage Branch Access: {branchModalFeature.feature_name}</h3>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <label className="flex items-center gap-2 text-[13px] font-medium mb-2 pb-2 border-b border-slate-100">
                <input
                  type="checkbox"
                  checked={branchSelection.size === branches.length && branches.length > 0}
                  onChange={(e) => setBranchSelection(e.target.checked ? new Set(branches.map((b) => b.branch_code)) : new Set())}
                  className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
                />
                All Branches
              </label>
              {branches.map((b) => (
                <label key={b.branch_code} className="flex items-center gap-2 text-[13px] py-1.5">
                  <input
                    type="checkbox"
                    checked={branchSelection.has(b.branch_code)}
                    onChange={() => toggleBranchSelection(b.branch_code)}
                    className="rounded border-slate-300 text-[color:var(--color-primary)] focus:ring-[color:var(--color-primary)]/40"
                  />
                  {b.branch_name} ({b.branch_code})
                </label>
              ))}
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 rounded-b-[20px]">
              <button onClick={() => setBranchModalFeature(null)} className="text-[12.5px] px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600">
                Cancel
              </button>
              <button
                onClick={() => saveBranches.mutate({ featureId: branchModalFeature.feature_id, branches: Array.from(branchSelection) })}
                disabled={saveBranches.isPending}
                className={cn(BTN_BASE, 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
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
