'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Branch {
  branch_code: string;
  branch_name: string;
}

interface Device {
  DeviceId: number;
  DeviceFName: string;
  branch_code: string;
  branch_name: string | null;
  SerialNumber: string;
  DeviceLocation: string;
}

type FormState = {
  DeviceFName: string;
  branch_code: string;
  SerialNumber: string;
  DeviceLocation: string;
};

const EMPTY_FORM: FormState = { DeviceFName: '', branch_code: '', SerialNumber: '', DeviceLocation: '' };

export default function DevicesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Device | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: devices = [], isLoading } = useQuery<Device[]>({
    queryKey: ['setup/devices'],
    queryFn: () => fetch('/api/setup/devices').then((r) => r.json()),
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  const save = useMutation({
    mutationFn: async (data: FormState) => {
      const id = editing?.DeviceId;
      const url = id ? `/api/setup/devices/${id}` : '/api/setup/devices';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup/devices'] });
      closeModal();
    },
  });

  function openNew() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setIsNew(true);
  }

  function openEdit(d: Device) {
    setForm({
      DeviceFName: d.DeviceFName ?? '',
      branch_code: d.branch_code ?? '',
      SerialNumber: d.SerialNumber ?? '',
      DeviceLocation: d.DeviceLocation ?? '',
    });
    setEditing(d);
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
        <h1 className="text-2xl font-semibold text-gray-900">Devices</h1>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Device
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Device Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Branch</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Serial Number</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Location</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {devices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No devices found. Add one to get started.
                  </td>
                </tr>
              )}
              {devices.map((d) => (
                <tr key={d.DeviceId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{d.DeviceFName || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{d.branch_name ?? d.branch_code ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{d.SerialNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{d.DeviceLocation}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(d)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
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
              <h2 className="text-lg font-semibold text-gray-900">{isNew ? 'New Device' : 'Edit Device'}</h2>
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Device Name</label>
                <input
                  type="text"
                  value={form.DeviceFName}
                  onChange={(e) => setForm((f) => ({ ...f, DeviceFName: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                <select
                  value={form.branch_code}
                  onChange={(e) => setForm((f) => ({ ...f, branch_code: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">[--Select--]</option>
                  {branches.map((b) => (
                    <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Serial Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.SerialNumber}
                  onChange={(e) => setForm((f) => ({ ...f, SerialNumber: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Device Location <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.DeviceLocation}
                  onChange={(e) => setForm((f) => ({ ...f, DeviceLocation: e.target.value }))}
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
