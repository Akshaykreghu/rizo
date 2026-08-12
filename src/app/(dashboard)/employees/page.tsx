'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Search, UserX, UserCheck, Eye } from 'lucide-react';
import { DataTable } from '@/components/data-table/DataTable';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { FloatingActionPanel, type FloatingAction } from '@/components/ui/FloatingActionPanel';
import { EmployeeDetail } from '@/components/employees/EmployeeDetail';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn, formatDate } from '@/lib/utils';
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
}

export default function EmployeesPage({ embedded = false, search: searchProp, pageSize: pageSizeProp }: EmployeesPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearchInput = useDebouncedValue(searchInput, 300);
  const [status, setStatus] = useState('1');
  const [branch, setBranch] = useState('');
  const [selectedEmpPkey, setSelectedEmpPkey] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const search = embedded ? (searchProp ?? '') : debouncedSearchInput;
  const pageSize = embedded ? (pageSizeProp ?? 25) : 25;

  useEffect(() => {
    setPage(1);
  }, [search, status, branch, pageSize]);

  const { data: branches = [] } = useQuery<BranchOption[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
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
      cell: ({ row, table }) => {
        const { pageIndex, pageSize } = table.getState().pagination;
        return <span className="text-slate-400">{pageIndex * pageSize + row.index + 1}</span>;
      },
    },
    {
      id: 'name',
      header: 'Employee',
      accessorFn: (row) => `${row.first_name} ${row.last_name}`,
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={`${row.original.first_name} ${row.original.last_name}`} />
          <div className="leading-tight">
            <p className="font-medium text-[#0F172A]">
              {row.original.first_name} {row.original.last_name}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">EMP {row.original.emp_id}</p>
          </div>
        </div>
      ),
    },
    { accessorKey: 'branch_name', header: 'Branch' },
    {
      accessorKey: 'dept_name',
      header: 'Department',
      cell: ({ getValue }) => <span className="font-medium text-[#0F172A]">{String(getValue() ?? '')}</span>,
    },
    {
      accessorKey: 'desig_name',
      header: 'Designation',
      cell: ({ getValue }) => <span className="text-[#64748B]">{String(getValue() ?? '')}</span>,
    },
    {
      accessorKey: 'joining_date',
      header: 'Joining Date',
      cell: ({ getValue }) => formatDate(String(getValue() ?? '')),
    },
    { accessorKey: 'mobile_no', header: 'Mobile' },
  ];

  const selectedEmployee = data?.data?.find((e: Employee) => e.emp_pkey === selectedEmpPkey);
  const panelActions: FloatingAction[] = selectedEmployee
    ? [
        { key: 'view', label: 'View', icon: Eye, variant: 'primary', onClick: () => setModalOpen(true) },
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

      <div className="sticky top-0 z-20 glass-card-strong rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
        {!embedded && (
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or employee ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full h-11 pl-10 pr-3 bg-white/80 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
            />
          </div>
        )}

        <div className="flex items-center gap-1 text-sm">
          {[
            { value: '1', label: 'Active' },
            { value: '0', label: 'Inactive' },
            { value: '2', label: 'Resigned' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatus(opt.value)}
              className={cn(
                'px-3 py-2 rounded-xl transition-all duration-[180ms] font-medium',
                status === opt.value
                  ? 'bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]'
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}>
        {selectedEmpPkey !== null && (
          <EmployeeDetail id={String(selectedEmpPkey)} onBack={() => setModalOpen(false)} showBackLink={false} />
        )}
      </Modal>
    </div>
  );
}
