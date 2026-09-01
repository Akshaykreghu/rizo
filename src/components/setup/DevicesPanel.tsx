'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/data-table/DataTable';

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

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-[#0F172A] hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)]/60 transition-colors duration-150';

export function DevicesPanel() {
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

  const columns: ColumnDef<Device, unknown>[] = [
    { accessorKey: 'DeviceFName', header: 'Device Name', cell: ({ getValue }) => <span className="text-[#0F172A]">{String(getValue()) || '—'}</span> },
    { id: 'branch', header: 'Branch', cell: ({ row }) => row.original.branch_name ?? row.original.branch_code ?? '—' },
    { accessorKey: 'SerialNumber', header: 'Serial Number' },
    { accessorKey: 'DeviceLocation', header: 'Location' },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-16' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row.original); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-end mb-5">
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-colors duration-150"
        >
          <Plus className="w-4 h-4" />
          Add Device
        </button>
      </div>

      <DataTable
        data={devices}
        columns={columns}
        pageSize={10}
        pageSizeOptions={[10, 20, 30, 50]}
        isLoading={isLoading}
      />

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={closeModal}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-6 w-full max-w-md animate-modal-in"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{isNew ? 'New Device' : 'Edit Device'}</h2>
              <button onClick={closeModal} aria-label="Close" className="p-1 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors duration-150">
                <X className="w-4.5 h-4.5" />
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
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Device Name</label>
                <input
                  type="text"
                  value={form.DeviceFName}
                  onChange={(e) => setForm((f) => ({ ...f, DeviceFName: e.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Branch</label>
                <select
                  value={form.branch_code}
                  onChange={(e) => setForm((f) => ({ ...f, branch_code: e.target.value }))}
                  className={INPUT_CLASS}
                >
                  <option value="">[--Select--]</option>
                  {branches.map((b) => (
                    <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
                  Serial Number <span className="text-[color:var(--color-danger)]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.SerialNumber}
                  onChange={(e) => setForm((f) => ({ ...f, SerialNumber: e.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">
                  Device Location <span className="text-[color:var(--color-danger)]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.DeviceLocation}
                  onChange={(e) => setForm((f) => ({ ...f, DeviceLocation: e.target.value }))}
                  className={INPUT_CLASS}
                />
              </div>

              {save.isError && <p className="text-[color:var(--color-danger)] text-[12.5px]">{String(save.error)}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-xl transition-colors duration-150"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={save.isPending}
                  className={cn(
                    'px-4 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm transition-colors duration-150',
                    save.isPending
                      ? 'bg-[color:var(--color-primary)]/60 cursor-not-allowed'
                      : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
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
