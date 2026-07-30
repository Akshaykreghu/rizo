'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';
import { cn } from '@/lib/utils';

interface LeavePolicyGroup {
  LEAVEPOLICY_GROUP_ID: number;
  LEAVEPOLICY_GROUP_NAME: string;
}

interface EmployeeOption {
  value: number;
  label: string;
}

interface LeaveTypeOption {
  salary_head_item_pkey: number;
  item: string;
  occurance: string;
}

interface LeavePolicyRow {
  LEAVEPOLICYID: number;
  LEAVEPOLICY_GROUP_ID: number;
  salary_head_item_fkey: number;
  leave_type_name: string;
  occurance: string;
  leave_policy_type: string;
  leave_cycle_start_date: string | null;
  leave_cycle_end_date: string | null;
  alloted_leave_forthe_year: number;
  alloted_leave_forthe_month: number;
  CARRY_FORWARD_LIMIT: number;
  sanction_by: number | null;
  REMARKS: string;
  leave_encash_limit: number;
  minimum_leave: number | null;
  maximum_leave: number | null;
  min_day_before_apply: number | null;
  minimum_service: number | null;
  IS_SANDWICH: string;
  is_leave_encash: string;
  ALLOW_NEGETIVE: string;
  exceptions: string;
  allow_all_leaves: string;
  document_mandatory: string;
}

const DURATION_TYPES = [
  { value: 'M', label: 'Monthly (Attendance Cycle)' },
  { value: 'Q', label: 'Quarterly' },
  { value: 'H', label: 'Half Yearly' },
  { value: 'Y', label: 'Yearly' },
  { value: 'P', label: 'Present Days' },
];

type FormState = Record<string, string>;

function emptyForm(groupId: number): FormState {
  return {
    LEAVEPOLICY_GROUP_ID: String(groupId),
    salary_head_item_fkey: '',
    leave_policy_type: 'M',
    leave_cycle_start_date: '',
    leave_cycle_end_date: '',
    alloted_leave_forthe_year: '',
    alloted_leave_forthe_month: '',
    CARRY_FORWARD_LIMIT: '0',
    sanction_by: '',
    REMARKS: '',
    leave_encash_limit: '',
    minimum_leave: '',
    maximum_leave: '',
    min_day_before_apply: '',
    minimum_service: '',
    IS_SANDWICH: 'N',
    is_leave_encash: 'N',
    ALLOW_NEGETIVE: 'N',
    exceptions: 'N',
    allow_all_leaves: 'N',
    document_mandatory: 'N',
  };
}

function rowToForm(row: LeavePolicyRow): FormState {
  return {
    LEAVEPOLICY_GROUP_ID: String(row.LEAVEPOLICY_GROUP_ID),
    salary_head_item_fkey: String(row.salary_head_item_fkey),
    leave_policy_type: row.leave_policy_type,
    leave_cycle_start_date: row.leave_cycle_start_date?.slice(0, 10) ?? '',
    leave_cycle_end_date: row.leave_cycle_end_date?.slice(0, 10) ?? '',
    alloted_leave_forthe_year: String(row.alloted_leave_forthe_year ?? ''),
    alloted_leave_forthe_month: String(row.alloted_leave_forthe_month ?? ''),
    CARRY_FORWARD_LIMIT: String(row.CARRY_FORWARD_LIMIT ?? '0'),
    sanction_by: row.sanction_by != null ? String(row.sanction_by) : '',
    REMARKS: row.REMARKS ?? '',
    leave_encash_limit: String(row.leave_encash_limit ?? ''),
    minimum_leave: row.minimum_leave != null ? String(row.minimum_leave) : '',
    maximum_leave: row.maximum_leave != null ? String(row.maximum_leave) : '',
    min_day_before_apply: row.min_day_before_apply != null ? String(row.min_day_before_apply) : '',
    minimum_service: row.minimum_service != null ? String(row.minimum_service) : '',
    IS_SANDWICH: row.IS_SANDWICH === 'Y' ? 'Y' : 'N',
    is_leave_encash: row.is_leave_encash === 'Y' ? 'Y' : 'N',
    ALLOW_NEGETIVE: row.ALLOW_NEGETIVE === 'Y' ? 'Y' : 'N',
    exceptions: row.exceptions === 'Y' ? 'Y' : 'N',
    allow_all_leaves: row.allow_all_leaves === 'Y' ? 'Y' : 'N',
    document_mandatory: row.document_mandatory === 'Y' ? 'Y' : 'N',
  };
}

export default function LeavePolicyPage() {
  const queryClient = useQueryClient();
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [editing, setEditing] = useState<LeavePolicyRow | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<FormState>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: groups = [] } = useQuery<LeavePolicyGroup[]>({
    queryKey: ['setup/leavepolicy-groups', undefined],
    queryFn: () => fetch('/api/setup/leavepolicy-groups').then((r) => r.json()),
  });

  const activeGroupId = selectedGroupId ?? groups[0]?.LEAVEPOLICY_GROUP_ID ?? null;

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) setSelectedGroupId(groups[0].LEAVEPOLICY_GROUP_ID);
  }, [groups, selectedGroupId]);

  const { data: policies = [], isLoading } = useQuery<LeavePolicyRow[]>({
    queryKey: ['setup/leave-policies', activeGroupId],
    queryFn: () =>
      fetch(`/api/setup/leave-policies?groupId=${activeGroupId}`).then((r) => r.json()),
    enabled: !!activeGroupId,
  });

  const { data: employees = [] } = useQuery<EmployeeOption[]>({
    queryKey: ['reports/employee-options'],
    queryFn: () => fetch('/api/reports/employee-options').then((r) => r.json()).then((d) => d.rows ?? []),
  });

  const { data: availableTypes = [] } = useQuery<LeaveTypeOption[]>({
    queryKey: ['setup/leave-policies/available-types', activeGroupId, editing?.LEAVEPOLICYID],
    queryFn: () => {
      const params = new URLSearchParams({ groupId: String(activeGroupId) });
      if (editing) params.set('excludeId', String(editing.LEAVEPOLICYID));
      return fetch(`/api/setup/leave-policies/available-types?${params}`).then((r) => r.json());
    },
    enabled: !!activeGroupId && (isNew || editing !== null),
  });

  const save = useMutation({
    mutationFn: async (data: FormState) => {
      const id = editing?.LEAVEPOLICYID;
      const url = id ? `/api/setup/leave-policies/${id}` : '/api/setup/leave-policies';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/leave-policies', activeGroupId] });
      closeModal();
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/setup/leave-policies/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/leave-policies', activeGroupId] });
      setDeleteConfirm(null);
    },
  });

  function openNew() {
    if (!activeGroupId) return;
    setForm(emptyForm(activeGroupId));
    setEditing(null);
    setIsNew(true);
  }

  function openEdit(row: LeavePolicyRow) {
    setForm(rowToForm(row));
    setEditing(row);
    setIsNew(false);
  }

  function closeModal() {
    setEditing(null);
    setIsNew(false);
    setForm({});
  }

  const showModal = isNew || editing !== null;
  const isPresentDays = form.leave_policy_type === 'P';

  return (
    <div className="space-y-10">
      <SetupCrudPage
        title="Leave Policy Groups"
        apiPath="setup/leavepolicy-groups"
        primaryKey="LEAVEPOLICY_GROUP_ID"
        displayKey="LEAVEPOLICY_GROUP_NAME"
        fields={[{ key: 'LEAVEPOLICY_GROUP_NAME', label: 'Leave Policy Group Name', required: true }]}
        columns={[{ key: 'LEAVEPOLICY_GROUP_NAME', label: 'Group Name' }]}
      />

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Leave Policies</h2>
        {groups.length === 0 ? (
          <p className="text-sm text-gray-500">Create a Leave Policy Group first.</p>
        ) : (
          <>
            <div className="mb-4 max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">Leave Policy Group</label>
              <select
                value={activeGroupId ?? ''}
                onChange={(e) => setSelectedGroupId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {groups.map((g) => (
                  <option key={g.LEAVEPOLICY_GROUP_ID} value={g.LEAVEPOLICY_GROUP_ID}>
                    {g.LEAVEPOLICY_GROUP_NAME}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">
                Each row below is a leave type available under this group, with its own allotment rules.
              </p>
              <button
                onClick={openNew}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Leave Type
              </button>
            </div>

            {isLoading ? (
              <div className="text-gray-500 text-sm">Loading...</div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Leave Type</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Duration</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Limit / Days</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Carry Forward</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Negative Balance</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {policies.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                          No leave types configured for this group yet.
                        </td>
                      </tr>
                    )}
                    {policies.map((row) => (
                      <tr key={row.LEAVEPOLICYID} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-800">{row.leave_type_name?.trim()}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {DURATION_TYPES.find((d) => d.value === row.leave_policy_type)?.label ?? row.leave_policy_type}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {row.leave_policy_type === 'P' ? row.alloted_leave_forthe_month : row.alloted_leave_forthe_year}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{row.CARRY_FORWARD_LIMIT}</td>
                        <td className="px-4 py-3 text-gray-600">{row.ALLOW_NEGETIVE === 'Y' ? 'Yes' : 'No'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEdit(row)}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            {deleteConfirm === row.LEAVEPOLICYID ? (
                              <span className="flex items-center gap-1 text-xs">
                                <button onClick={() => remove.mutate(row.LEAVEPOLICYID)} className="text-red-600 hover:underline">
                                  Confirm
                                </button>
                                <span className="text-gray-400">·</span>
                                <button onClick={() => setDeleteConfirm(null)} className="text-gray-500 hover:underline">
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirm(row.LEAVEPOLICYID)}
                                className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                {isNew ? 'Add Leave Type' : `Edit ${editing?.leave_type_name?.trim()}`}
              </h2>
              <button onClick={closeModal} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
              className="space-y-5"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Leave Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    disabled={!isNew}
                    value={form.salary_head_item_fkey ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, salary_head_item_fkey: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                  >
                    <option value="">[--Select--]</option>
                    {!isNew && editing && (
                      <option value={editing.salary_head_item_fkey}>{editing.leave_type_name?.trim()}</option>
                    )}
                    {availableTypes.map((t) => (
                      <option key={t.salary_head_item_pkey} value={t.salary_head_item_pkey}>
                        {t.item.trim()}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Available Duration</label>
                  <select
                    value={form.leave_policy_type ?? 'M'}
                    onChange={(e) => setForm((f) => ({ ...f, leave_policy_type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {DURATION_TYPES.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={form.leave_cycle_start_date ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, leave_cycle_start_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={form.leave_cycle_end_date ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, leave_cycle_end_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {isPresentDays ? 'Present days for one leave' : 'Limit'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={isPresentDays ? form.alloted_leave_forthe_month ?? '' : form.alloted_leave_forthe_year ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        [isPresentDays ? 'alloted_leave_forthe_month' : 'alloted_leave_forthe_year']: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Carry Forward Limit</label>
                  <input
                    type="number"
                    min={0}
                    value={form.CARRY_FORWARD_LIMIT ?? '0'}
                    onChange={(e) => setForm((f) => ({ ...f, CARRY_FORWARD_LIMIT: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sanction By</label>
                <select
                  value={form.sanction_by ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, sanction_by: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">[--Select--]</option>
                  {employees.map((e) => (
                    <option key={e.value} value={e.value}>{e.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  value={form.REMARKS ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, REMARKS: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-3 gap-3 pt-1">
                {[
                  { key: 'IS_SANDWICH', label: 'Sandwich Leave' },
                  { key: 'is_leave_encash', label: 'Allow Encashment' },
                  { key: 'ALLOW_NEGETIVE', label: 'Allow Negative Balance' },
                  { key: 'exceptions', label: 'Exceptions' },
                  { key: 'document_mandatory', label: 'Document Mandatory' },
                  { key: 'allow_all_leaves', label: 'Allow all leaves' },
                ].map((cb) => (
                  <label key={cb.key} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form[cb.key] === 'Y'}
                      onChange={(e) => setForm((f) => ({ ...f, [cb.key]: e.target.checked ? 'Y' : 'N' }))}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {cb.label}
                  </label>
                ))}
              </div>

              {form.is_leave_encash === 'Y' && (
                <div className="max-w-xs">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Leave Encashment Limit</label>
                  <input
                    type="number"
                    value={form.leave_encash_limit ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, leave_encash_limit: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              )}

              {form.exceptions === 'Y' && (
                <div className="grid grid-cols-4 gap-3 border-t pt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Min. Leave</label>
                    <input
                      type="number"
                      value={form.minimum_leave ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, minimum_leave: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Max. Leave</label>
                    <input
                      type="number"
                      value={form.maximum_leave ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, maximum_leave: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Advance Notice Days</label>
                    <input
                      type="number"
                      value={form.min_day_before_apply ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, min_day_before_apply: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Min. Service (Month)</label>
                    <input
                      type="number"
                      value={form.minimum_service ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, minimum_service: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {save.isError && <p className="text-red-500 text-sm">{String(save.error)}</p>}

              <div className="flex justify-end gap-3 pt-2 border-t mt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className={cn(
                    'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors',
                    save.isPending ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'
                  )}
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
