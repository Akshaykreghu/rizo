'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { EmployeeSearch } from '@/components/employees/EmployeeSearch';
import { cn } from '@/lib/utils';
import { DataTable } from '@/components/data-table/DataTable';

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

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-lg border border-slate-200 bg-white text-sm text-[#0F172A] hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)]/60 transition-colors duration-150';

export function DeviceMappingPanel() {
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

  const columns: ColumnDef<EmpDevice, unknown>[] = [
    { accessorKey: 'emp_name', header: 'Employee', cell: ({ getValue }) => <span className="text-[#0F172A]">{String(getValue())}</span> },
    { accessorKey: 'emp_username', header: 'Username' },
    { id: 'device', header: 'Device', cell: ({ row }) => row.original.DeviceFName || row.original.deviceid },
    { id: 'empDeviceId', header: 'Employee Device ID', cell: ({ row }) => row.original.emp_device_id || '—' },
    {
      id: 'actions',
      header: '',
      meta: { className: 'w-24' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row.original); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-light)] transition-colors duration-150"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {deleteConfirm === row.original.emp_device_comp_branch_seq ? (
            <span className="flex items-center gap-1.5 text-xs pl-1">
              <button
                onClick={(e) => { e.stopPropagation(); remove.mutate(row.original.emp_device_comp_branch_seq); }}
                className="font-medium text-[color:var(--color-danger)] hover:underline"
              >
                Confirm
              </button>
              <span className="text-slate-300">·</span>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                className="text-slate-500 hover:underline"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(row.original.emp_device_comp_branch_seq); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-[13px] text-slate-500 max-w-lg">
          Restrict which employee is allowed to punch attendance from which registered biometric device.
        </p>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-colors duration-150 flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Mapping
        </button>
      </div>

      <DataTable
        data={mappings}
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
              <h2 className="text-[19px] font-semibold text-[#0F172A] tracking-tight">{isNew ? 'New Mapping' : 'Edit Mapping'}</h2>
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
              {isNew && (
                <div>
                  <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Employee</label>
                  <EmployeeSearch
                    value={form.emp_fkey}
                    onChange={(empPkey) => setForm((f) => ({ ...f, emp_fkey: empPkey }))}
                    placeholder="Search employee..."
                  />
                </div>
              )}
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Device</label>
                <select
                  required
                  value={form.deviceid}
                  onChange={(e) => setForm((f) => ({ ...f, deviceid: e.target.value }))}
                  className={INPUT_CLASS}
                >
                  <option value="">[--Select--]</option>
                  {devices.map((d) => (
                    <option key={d.DeviceId} value={d.DeviceId}>{d.DeviceFName || `Device ${d.DeviceId}`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-slate-600 mb-1.5">Employee Device ID</label>
                <input
                  type="number"
                  value={form.emp_device_id}
                  onChange={(e) => setForm((f) => ({ ...f, emp_device_id: e.target.value }))}
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
