'use client';

import { useQuery } from '@tanstack/react-query';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';
import { financialYearFields, FINANCIAL_YEAR_COLUMNS } from '@/lib/setupFieldConfigs';

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
      fields={financialYearFields(branches)}
      columns={FINANCIAL_YEAR_COLUMNS}
    />
  );
}
