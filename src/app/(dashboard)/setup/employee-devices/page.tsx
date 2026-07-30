'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn } from '@/lib/utils';

interface Device {
  DeviceId: number;
  DeviceFName: string;
}

interface EmpDevice {
  emp_device_comp_branch_seq: number;
  deviceid: number;
  emp_device_id: number;
  emp_fkey: number;
  emp_username: string;
  emp_name: string;
  DeviceFName: string | null;
  SerialNumber: string | null;
}

type FormState = {
  emp_fkey: string;
  deviceid: string;
  emp_device_id: string;
};

const EMPTY_FORM: FormState = { emp_fkey: '', deviceid: '', emp_device_id: '' };

export default function EmployeeDevicesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<EmpDevice | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const { data: mappings = [], isLoading } = useQuery<EmpDevice[]>({
    queryKey: ['setup/employee-devices'],
    queryFn: () => fetch('/api/setup/employee-devices').then((r) => r.json()),
  });

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['setup/devices'],
    queryFn: () => fetch('/api/setup/devices').then((r) => r.json()),
  });

  const save = useMutation({
    mutationFn: async (data: FormState) => {
      const id = editing?.emp_device_comp_branch_seq;
      const url = id ? `/api/setup/employee-devices/${id}` : '/api/setup/employee-devices';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/employee-devices'] });
      closeModal();
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/setup/employee-devices/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/employee-devices'] });
      setDeleteConfirm(null);
    },
  });

  function openNew() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setIsNew(true);
  }

  function openEdit(m: EmpDevice) {
    setForm({
      emp_fkey: String(m.emp_fkey),
      deviceid: String(m.deviceid),
      emp_device_id: String(m.emp_device_id ?? ''),
    });
    setEditing(m);
    setIsNew(false);
  }

  function closeModal() {
    setEditing(null);
    setIsNew(false);
    setForm(EMPTY_FORM);
  }

  const showModal = isNew || editing !== null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Employee Devices</h1>
          <p className="text-sm text-gray-500 mt-1">
            Restrict which employee is allowed to punch attendance from which registered biometric device.
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Mapping
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Device</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee Device ID</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {mappings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No employee-device mappings found. Add one to get started.
                  </td>
                </tr>
              )}
              {mappings.map((m) => (
                <tr key={m.emp_device_comp_branch_seq} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{m.emp_name}</td>
                  <td className="px-4 py-3 text-gray-600">{m.emp_username}</td>
                  <td className="px-4 py-3 text-gray-600">{m.DeviceFName || m.deviceid}</td>
                  <td className="px-4 py-3 text-gray-600">{m.emp_device_id || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(m)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {deleteConfirm === m.emp_device_comp_branch_seq ? (
                        <span className="flex items-center gap-1 text-xs">
                          <button onClick={() => remove.mutate(m.emp_device_comp_branch_seq)} className="text-red-600 hover:underline">
                            Confirm
                          </button>
                          <span className="text-gray-400">·</span>
                          <button onClick={() => setDeleteConfirm(null)} className="text-gray-500 hover:underline">
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(m.emp_device_comp_branch_seq)}
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

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeModal} />
          <div className="relative bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">{isNew ? 'New Mapping' : 'Edit Mapping'}</h2>
              <button onClick={closeModal} className="p-1 rounded hover:bg-gray-100">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(form);
              }}
              className="space-y-4"
            >
              {isNew && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                  <EmployeeSearch
                    value={form.emp_fkey}
                    onChange={(empPkey) => setForm((f) => ({ ...f, emp_fkey: empPkey }))}
                    placeholder="Search employee..."
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Device</label>
                <select
                  required
                  value={form.deviceid}
                  onChange={(e) => setForm((f) => ({ ...f, deviceid: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">[--Select--]</option>
                  {devices.map((d) => (
                    <option key={d.DeviceId} value={d.DeviceId}>{d.DeviceFName || `Device ${d.DeviceId}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee Device ID</label>
                <input
                  type="number"
                  value={form.emp_device_id}
                  onChange={(e) => setForm((f) => ({ ...f, emp_device_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {save.isError && <p className="text-red-500 text-sm">{String(save.error)}</p>}

              <div className="flex justify-end gap-3 pt-2">
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
