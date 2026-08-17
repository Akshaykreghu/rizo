'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Search, UserX, UserCheck, Eye, KeyRound, ListTree } from 'lucide-react';
import { DataTable } from '@/components/data-table/DataTable';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { FloatingActionPanel, type FloatingAction } from '@/components/ui/FloatingActionPanel';
import { EmployeeDetail } from '@/components/employees/EmployeeDetail';
import { AccessManageModal } from '@/components/employees/AccessManageModal';
import { MenuAllocationModal } from '@/components/employees/MenuAllocationModal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn, formatDate } from '@/lib/utils';
import { STATUS_FILTERS } from '@/lib/statusFilters';
import type { ColumnDef } from '@tanstack/react-table';

interface Employee {
  emp_pkey: number;
  emp_id: string;
  first_name: string;
  last_name: string;
  mobile_no: string;
  branch_name: string;
  dept_name: string;
  desig_name: string;
  joining_date: string;
  status: number;
  profile_pic: string | null;
}

interface BranchOption {
  branch_code: string;
  branch_name: string;
}

interface EmployeesPageProps {
  /** Set when rendered inside another page (e.g. the Employee Join "All Employees" tab) that already shows its own title. */
  embedded?: boolean;
  /** When embedded, the search term is controlled by the parent's shared search bar. */
  search?: string;
  /** When embedded, rows-per-page is controlled by the parent's shared toolbar. */
  pageSize?: number;
  /** When embedded, the status filter is controlled by the parent's shared toolbar. */
  status?: string;
  onStatusChange?: (status: string) => void;
  /** When embedded, the branch filter is controlled by the parent's shared toolbar. */
  branch?: string;
  onBranchChange?: (branch: string) => void;
}

export default function EmployeesPage({
  embedded = false,
  search: searchProp,
  pageSize: pageSizeProp,
  status: statusProp,
  onStatusChange,
  branch: branchProp,
  onBranchChange,
}: EmployeesPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearchInput = useDebouncedValue(searchInput, 300);
  const [internalStatus, setInternalStatus] = useState('1');
  const [internalBranch, setInternalBranch] = useState('');
  const [selectedEmpPkey, setSelectedEmpPkey] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [menuAllocationOpen, setMenuAllocationOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const search = embedded ? (searchProp ?? '') : debouncedSearchInput;
  const pageSize = embedded ? (pageSizeProp ?? 25) : 25;
  const status = embedded ? (statusProp ?? '1') : internalStatus;
  const branch = embedded ? (branchProp ?? '') : internalBranch;
  const setStatus = embedded ? (onStatusChange ?? (() => {})) : setInternalStatus;
  const setBranch = embedded ? (onBranchChange ?? (() => {})) : setInternalBranch;

  useEffect(() => {
    setPage(1);
  }, [search, status, branch, pageSize]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const { data: branches = [] } = useQuery<BranchOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
    enabled: !embedded,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['employees', page, pageSize, search, status, branch],
    queryFn: () =>
      fetch(`/api/employees?page=${page}&pageSize=${pageSize}&search=${search}&status=${status}&branch=${branch}`)
        .then((r) => r.json()),
  });

  const toggleStatus = useMutation({
    mutationFn: ({ empPkey, newStatus }: { empPkey: number; newStatus: number }) =>
      fetch(`/api/employees/${empPkey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });

  const columns: ColumnDef<Employee, unknown>[] = [
    {
      id: 'slNo',
      header: 'Sl No',
      meta: { className: 'w-12' },
      cell: ({ row, table }) => {
        const { pageIndex, pageSize } = table.getState().pagination;
        return <span className="text-slate-400">{pageIndex * pageSize + row.index + 1}</span>;
      },
    },
    {
      id: 'name',
      header: 'Employee',
      accessorFn: (row) => `${row.first_name} ${row.last_name}`,
      meta: { className: 'w-[26%]' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={`${row.original.first_name} ${row.original.last_name}`} imageUrl={row.original.profile_pic} />
          <div className="leading-tight">
            <p className="font-semibold text-sm text-[#0F172A]">
              {row.original.first_name} {row.original.last_name}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">EMP {row.original.emp_id}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'branch_name',
      header: 'Branch',
      meta: { className: 'w-[14%]' },
      cell: ({ getValue }) => <span className="text-slate-600">{String(getValue() ?? '')}</span>,
    },
    {
      accessorKey: 'dept_name',
      header: 'Department',
      meta: { className: 'w-[15%]' },
      cell: ({ getValue }) => <span className="text-slate-600">{String(getValue() ?? '')}</span>,
    },
    {
      accessorKey: 'desig_name',
      header: 'Designation',
      meta: { className: 'w-[15%]' },
      cell: ({ getValue }) => <span className="text-[#64748B]">{String(getValue() ?? '')}</span>,
    },
    {
      accessorKey: 'joining_date',
      header: 'Joining Date',
      meta: { className: 'w-[13%]' },
      cell: ({ getValue }) => <span className="text-slate-600">{formatDate(String(getValue() ?? ''))}</span>,
    },
    {
      accessorKey: 'mobile_no',
      header: 'Mobile',
      meta: { className: 'w-[12%]' },
      cell: ({ getValue }) => <span className="text-[#64748B]">{String(getValue() ?? '')}</span>,
    },
  ];

  const selectedEmployee = data?.data?.find((e: Employee) => e.emp_pkey === selectedEmpPkey);
  const panelActions: FloatingAction[] = selectedEmployee
    ? [
        { key: 'view', label: 'View', icon: Eye, variant: 'primary', onClick: () => setModalOpen(true) },
        { key: 'access', label: 'Manage Access', icon: KeyRound, variant: 'default', onClick: () => setAccessModalOpen(true) },
        { key: 'menu-allocation', label: 'Menu Allocation', icon: ListTree, variant: 'default', onClick: () => setMenuAllocationOpen(true) },
        ...(selectedEmployee.status === 2
          ? []
          : [
              selectedEmployee.status === 1
                ? {
                    key: 'deactivate',
                    label: 'Deactivate',
                    icon: UserX,
                    variant: 'danger' as const,
                    onClick: () => toggleStatus.mutate({ empPkey: selectedEmployee.emp_pkey, newStatus: 0 }),
                  }
                : {
                    key: 'activate',
                    label: 'Activate',
                    icon: UserCheck,
                    variant: 'success' as const,
                    onClick: () => toggleStatus.mutate({ empPkey: selectedEmployee.emp_pkey, newStatus: 1 }),
                  },
            ]),
      ]
    : [];

  return (
    <div>
      {!embedded && (
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight">Employees</h1>
          <button
            onClick={() => router.push('/employees/new')}
            className="flex items-center gap-2 bg-[color:var(--color-primary)] hover:scale-[1.03] text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
          >
            <Plus className="w-4 h-4" />
            Add Employee
          </button>
        </div>
      )}

      {!embedded && (
        <div className="sticky top-0 z-20 glass-card-strong rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search employees by name or ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full h-10 pl-10 pr-3 bg-white/80 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
            />
          </div>

          <div className="flex items-center gap-1 text-sm">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatus(opt.value)}
                className={cn(
                  'px-3 py-2 rounded-xl transition-all duration-[180ms] font-medium',
                  status === opt.value
                    ? opt.selectedClass
                    : 'bg-white/80 text-slate-500 hover:bg-white border border-slate-200'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="px-3 py-2 bg-white/80 border border-slate-200 rounded-xl text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
          >
            <option value="">All Branches</option>
            {branches.map((b) => (
              <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>
            ))}
          </select>
        </div>
      )}

      <DataTable
        key={pageSize}
        data={data?.data ?? []}
        columns={columns}
        pageSize={pageSize}
        totalRows={data?.total ?? 0}
        onPageChange={(p) => setPage(p)}
        isLoading={isLoading}
        onRowClick={(row) => setSelectedEmpPkey((prev) => (prev === row.emp_pkey ? null : row.emp_pkey))}
        isRowSelected={(row) => selectedEmpPkey === row.emp_pkey}
      />

      <FloatingActionPanel visible={selectedEmpPkey !== null} actions={panelActions} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} className="max-w-[1100px] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <EmployeeDetail id={String(selectedEmpPkey)} onBack={() => setModalOpen(false)} showBackLink={false} />
        )}
      </Modal>

      <Modal open={accessModalOpen} onClose={() => setAccessModalOpen(false)} className="max-w-[560px] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <AccessManageModal
            empPkey={selectedEmpPkey}
            onSaved={() => setAccessModalOpen(false)}
            onNotify={(message, type) => setToast({ message, type })}
          />
        )}
      </Modal>

      <Modal open={menuAllocationOpen} onClose={() => setMenuAllocationOpen(false)} className="max-w-[760px] rounded-[22px]">
        {selectedEmpPkey !== null && (
          <MenuAllocationModal empPkey={selectedEmpPkey} onClose={() => setMenuAllocationOpen(false)} />
        )}
      </Modal>

      {toast && (
        <div
          className={cn(
            'fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white',
            toast.type === 'success' ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-danger)]'
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
