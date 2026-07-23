'use client';

import { useQuery } from '@tanstack/react-query';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

interface Branch {
  branch_code: string;
  branch_name: string;
}

export default function FinancialYearPage() {
  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['setup/branches'],
    queryFn: () => fetch('/api/setup/branches').then((r) => r.json()),
  });

  return (
    <SetupCrudPage
      title="Financial Year"
      apiPath="setup/financial-year"
      primaryKey="Fin_year_seq"
      displayKey="fin_year"
      fields={[
        { key: 'start_month', label: 'Year Start', type: 'date', required: true },
        { key: 'end_month', label: 'Year End', type: 'date', required: true },
        {
          key: 'branch_code',
          label: 'Branch',
          type: 'select',
          required: true,
          options: branches.map((b) => ({ value: b.branch_code, label: b.branch_name })),
        },
        {
          key: 'Year_status',
          label: 'Status',
          type: 'select',
          required: true,
          options: [
            { value: 'OPEN', label: 'Open' },
            { value: 'CLOSED', label: 'Closed' },
          ],
        },
        {
          key: 'vattr1',
          label: 'Type',
          type: 'select',
          required: true,
          options: [
            { value: '0', label: 'Leave' },
            { value: '1', label: 'Financial' },
          ],
        },
        { key: 'is_current_finyear', label: 'Is Current Financial Year', type: 'checkbox' },
      ]}
      columns={[
        { key: 'branch_name', label: 'Branch' },
        { key: 'fin_year', label: 'Year' },
        { key: 'start_month', label: 'Start' },
        { key: 'end_month', label: 'End' },
        { key: 'Year_status', label: 'Status' },
        { key: 'type_label', label: 'Type' },
      ]}
    />
  );
}
