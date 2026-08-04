'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { MenuTree, type MenuNode } from '@/components/employees/MenuTree';

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

  const { data: branches = [] } = useQuery<BranchOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()).then((rows: Record<string, unknown>[]) =>
      rows.map((r) => ({ branch_code: String(r.branch_code), branch_name: String(r.branch_name) }))
    ),
  });

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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Menu Allocation</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
        <EmployeeSearch
          value={empFkey}
          onChange={(v) => { setEmpFkey(v); setChecked(new Set()); }}
        />
      </div>

      {empFkey && (
        isLoading ? (
          <p className="text-sm text-gray-500">Loading menu tree…</p>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Standard Menus</h2>
              <div className="max-h-96 overflow-y-auto border border-gray-100 rounded-lg p-3">
                <MenuTree nodes={data?.tree ?? []} checked={checked} onToggle={toggle} />
              </div>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="mt-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {save.isPending ? 'Saving…' : 'Save Menu Access'}
              </button>
              {save.isSuccess && <span className="ml-3 text-sm text-emerald-600">Saved</span>}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Add-on Menus</h2>
              <p className="text-xs text-gray-400 mb-3">
                Scope each add-on to specific branches, or to the employee&apos;s reporting hierarchy.
              </p>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {(data?.features ?? []).map((feature) => {
                  const access = data?.featureAccess[feature.feature_id];
                  const isOn = !!access;
                  const isHierarchy = access?.mode === 'hierarchy';
                  return (
                    <div key={feature.feature_id} className="border border-gray-100 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">{feature.feature_name}</div>
                          {feature.description && (
                            <div className="text-xs text-gray-400 truncate">{feature.description}</div>
                          )}
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                          <input
                            type="checkbox"
                            checked={isOn}
                            onChange={(e) => toggleFeature(feature, e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-gray-200 peer-checked:bg-indigo-600 rounded-full transition-colors relative">
                            <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                          </div>
                        </label>
                      </div>
                      {isOn && (
                        <div className="flex gap-2 mt-2">
                          {isHierarchy ? (
                            <button
                              onClick={() => openBranchModal(feature, false)}
                              className="text-xs border border-indigo-300 text-indigo-600 hover:bg-indigo-50 px-2.5 py-1 rounded-md"
                            >
                              Set Branch Wise
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => openBranchModal(feature, false)}
                                className="text-xs border border-indigo-300 text-indigo-600 hover:bg-indigo-50 px-2.5 py-1 rounded-md"
                              >
                                Manage Branch
                              </button>
                              <button
                                onClick={() => switchToHierarchy(feature)}
                                className="text-xs border border-red-300 text-red-600 hover:bg-red-50 px-2.5 py-1 rounded-md"
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setChoiceFeature(null)}>
          <div className="bg-white rounded-xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold mb-1">Access Configuration: {choiceFeature.feature_name}</h3>
            <p className="text-xs text-gray-500 mb-4">Select how to allocate this feature for the employee.</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => chooseBranchWise(choiceFeature)}
                className="border-2 border-gray-100 hover:border-indigo-400 rounded-lg p-4 text-center transition-colors"
              >
                <div className="text-sm font-semibold text-gray-900">Branch Wise</div>
                <div className="text-xs text-gray-500 mt-1">Allocate to specific branches. Defaults to all.</div>
              </button>
              <button
                onClick={() => chooseHierarchy(choiceFeature)}
                className="border-2 border-gray-100 hover:border-indigo-400 rounded-lg p-4 text-center transition-colors"
              >
                <div className="text-sm font-semibold text-gray-900">Hierarchy Wise</div>
                <div className="text-xs text-gray-500 mt-1">Follows the employee&apos;s reporting hierarchy.</div>
              </button>
            </div>
            <button onClick={() => setChoiceFeature(null)} className="mt-4 text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {branchModalFeature && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setBranchModalFeature(null)}>
          <div className="bg-white rounded-xl w-96 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-base font-semibold">Manage Branch Access: {branchModalFeature.feature_name}</h3>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <label className="flex items-center gap-2 text-sm font-medium mb-2 pb-2 border-b border-gray-100">
                <input
                  type="checkbox"
                  checked={branchSelection.size === branches.length && branches.length > 0}
                  onChange={(e) => setBranchSelection(e.target.checked ? new Set(branches.map((b) => b.branch_code)) : new Set())}
                />
                All Branches
              </label>
              {branches.map((b) => (
                <label key={b.branch_code} className="flex items-center gap-2 text-sm py-1.5">
                  <input
                    type="checkbox"
                    checked={branchSelection.has(b.branch_code)}
                    onChange={() => toggleBranchSelection(b.branch_code)}
                  />
                  {b.branch_name} ({b.branch_code})
                </label>
              ))}
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50 rounded-b-xl">
              <button onClick={() => setBranchModalFeature(null)} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">
                Cancel
              </button>
              <button
                onClick={() => saveBranches.mutate({ featureId: branchModalFeature.feature_id, branches: Array.from(branchSelection) })}
                disabled={saveBranches.isPending}
                className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white"
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
