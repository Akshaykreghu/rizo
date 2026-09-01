'use client';

import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export function SalaryHeadCategoriesPanel() {
  return (
    <SetupCrudPage
      hideTitle
      title="Salary Head Categories"
      apiPath="setup/salary-heads"
      primaryKey="head_pkey"
      displayKey="head_desc"
      fields={[
        { key: 'head_desc', label: 'Category Name', required: true },
        { key: 'head_operator', label: 'Operator', type: 'select', options: [
          { value: 'Addition', label: 'Addition' },
          { value: 'Deduction', label: 'Deduction' },
        ] },
        { key: 'head_occurance', label: 'Occurance', type: 'select', options: [
          { value: 'FIXED', label: 'Fixed' },
          { value: 'VARIABLE', label: 'Variable' },
          { value: 'CONTRIBUTIONS', label: 'Contributions' },
        ] },
        { key: 'salary_head_order1', label: 'Display Order', type: 'number' },
      ]}
      columns={[
        { key: 'head_desc', label: 'Category' },
        { key: 'head_operator', label: 'Operator' },
        { key: 'head_occurance', label: 'Occurance' },
        { key: 'status', label: 'Status' },
      ]}
    />
  );
}
