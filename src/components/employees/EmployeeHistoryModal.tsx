'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HistoryRow {
  type: string;
  day_time_desc: string | null;
  status: string;
  creation_date: string;
  created_by: string | null;
}

const STATUS_TONE: Record<string, string> = {
  Active: 'bg-[color:var(--color-success-light)] text-[color:var(--color-success-dark)]',
  Changed: 'bg-slate-100 text-slate-500',
};

// Legacy's "History Table" (View/Promo/promotion.ctp) opened by the All Employees History button:
// Type / Role / Status / Date / Approval By, from the emp_config_history view.
export function EmployeeHistoryModal({ empPkey, empName }: { empPkey: number; empName: string }) {
  const { data, isLoading, isError } = useQuery<{ data: HistoryRow[] }>({
    queryKey: ['employee-config-history', empPkey],
    queryFn: () =>
      fetch(`/api/employees/${empPkey}/config-history`).then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      }),
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <div className="flex items-center gap-3 pr-10 mb-5">
        <span className="w-10 h-10 rounded-xl bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] flex items-center justify-center flex-shrink-0">
          <History className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-heading text-[19px] font-bold text-[#0F172A] tracking-tight">History</h2>
          <p className="text-[13px] text-slate-500 truncate">{empName}</p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>}
      {isError && <p className="text-sm text-[color:var(--color-danger)] py-8 text-center">Couldn&apos;t load the history.</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-sm text-slate-400 py-8 text-center border border-dashed border-slate-200 rounded-xl">
          No configuration changes recorded for this employee.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[12px] text-slate-500">
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Approval By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-medium text-[#0F172A]">{r.type}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.day_time_desc?.trim() || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_TONE[r.status] ?? 'bg-slate-100 text-slate-600')}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{r.creation_date}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.created_by || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
