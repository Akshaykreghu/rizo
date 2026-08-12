'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Plus, Search, UserX, UserCheck } from 'lucide-react';
import { DataTable } from '@/components/data-table/DataTable';
import { Avatar } from '@/components/ui/Avatar';
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
}

export default function EmployeesPage({ embedded = false }: EmployeesPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('1');
  const [branch, setBranch] = useState('');
  const pageSize = 25;

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
    { accessorKey: 'emp_id', header: 'Emp ID', size: 90 },
    {
      id: 'name',
      header: 'Name',
      accessorFn: (row) => `${row.first_name} ${row.last_name}`,
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={`${row.original.first_name} ${row.original.last_name}`} />
          <span className="font-medium text-slate-800">
            {row.original.first_name} {row.original.last_name}
          </span>
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
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) =>
        row.original.status === 2 ? (
          <span className="text-xs text-slate-400">Resigned — managed via Remove Employee</span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleStatus.mutate({
                empPkey: row.original.emp_pkey,
                newStatus: row.original.status === 1 ? 0 : 1,
              });
            }}
            className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-all duration-[180ms]',
              row.original.status === 1
                ? 'text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10'
                : 'text-[color:var(--color-success)] hover:bg-[color:var(--color-success)]/10'
            )}
            title={row.original.status === 1 ? 'Deactivate' : 'Activate'}
          >
            {row.original.status === 1 ? (
              <UserX className="w-4 h-4" />
            ) : (
              <UserCheck className="w-4 h-4" />
            )}
          </button>
        ),
    },
  ];

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  return (
    <div>
      <div className={cn('flex items-center justify-between', embedded ? 'justify-end mb-4' : 'mb-6')}>
        {!embedded && <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight">Employees</h1>}
        <button
          onClick={() => router.push('/employees/new')}
          className="flex items-center gap-2 bg-[color:var(--color-primary)] hover:scale-[1.03] text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-[color:var(--color-primary)]/20 transition-all duration-[180ms]"
        >
          <Plus className="w-4 h-4" />
          Add Employee
        </button>
      </div>

      <div className="sticky top-0 z-20 glass-card-strong rounded-2xl p-3 mb-4 flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="flex gap-2 max-w-sm flex-1 min-w-[220px]">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or employee ID"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full h-11 pl-10 pr-3 bg-white/80 border border-slate-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-2 bg-white/80 hover:bg-white border border-slate-200 rounded-full text-sm text-slate-600 transition-all duration-[180ms]"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-1 text-sm">
          {[
            { value: '1', label: 'Active' },
            { value: '0', label: 'Inactive' },
            { value: '2', label: 'Resigned' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setStatus(opt.value); setPage(1); }}
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
          onChange={(e) => { setBranch(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-white/80 border border-slate-200 rounded-xl text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/40"
        >
          <option value="">All Branches</option>
          {branches.map((b) => (
            <option key={b.branch_code} value={b.branch_code}>{b.branch_name}</option>
          ))}
        </select>
      </div>

      <DataTable
        data={data?.data ?? []}
        columns={columns}
        pageSize={pageSize}
        totalRows={data?.total ?? 0}
        onPageChange={(p) => setPage(p)}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/employees/${row.emp_pkey}`)}
      />
    </div>
  );
}
