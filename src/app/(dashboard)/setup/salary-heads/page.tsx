'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

interface SalaryHead {
  head_pkey: number;
  head_desc: string;
  status: number;
}

const ITEM_TYPE_OPTIONS = [
  { value: 'Fixed', label: 'Fixed' },
  { value: 'Formula', label: 'Formula' },
  { value: 'Limit', label: 'Limit' },
  { value: 'Manually', label: 'Manually' },
];

const ITEM_PART_OPTIONS = [
  { value: 'Direct', label: 'Direct' },
  { value: 'Indirect', label: 'Admin Only' },
];

export default function SalaryHeadsPage() {
  const [selectedHeadId, setSelectedHeadId] = useState<number | null>(null);

  const { data: heads = [] } = useQuery<SalaryHead[]>({
    queryKey: ['setup/salary-heads'],
    queryFn: () => fetch('/api/setup/salary-heads').then((r) => r.json()),
  });

  const activeHeads = heads.filter((h) => h.status === 1);
  const activeHeadId = selectedHeadId ?? activeHeads[0]?.head_pkey ?? null;

  return (
    <div className="space-y-10">
      <div>
        <SetupCrudPage
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
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Salary Head Items</h2>
        {activeHeads.length === 0 ? (
          <p className="text-sm text-gray-500">No active category. Create or reactivate one above.</p>
        ) : (
          <>
            <div className="mb-4 max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={activeHeadId ?? ''}
                onChange={(e) => setSelectedHeadId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {activeHeads.map((h) => (
                  <option key={h.head_pkey} value={h.head_pkey}>{h.head_desc}</option>
                ))}
              </select>
            </div>

            {activeHeadId && (
              <SetupCrudPage
                title="Salary Head Items"
                apiPath="setup/salary-head-items"
                queryParams={{ headId: String(activeHeadId) }}
                primaryKey="salary_head_item_pkey"
                displayKey="item"
                fields={[
                  { key: 'item', label: 'Item Name', required: true },
                  { key: 'item_type', label: 'Type', type: 'select', options: ITEM_TYPE_OPTIONS },
                  { key: 'item_part', label: 'Visibility', type: 'select', options: ITEM_PART_OPTIONS },
                  { key: 'value', label: 'Available in Structure Builder', type: 'checkbox' },
                  { key: 'is_show_salslip', label: 'Show on Salary Slip', type: 'checkbox' },
                  { key: 'salary_head_item_order1', label: 'Display Order', type: 'number' },
                  { key: 'comments', label: 'Comments', placeholder: 'Explanatory note shown to HR when configuring this item' },
                ]}
                columns={[
                  { key: 'item', label: 'Item' },
                  { key: 'item_type', label: 'Type' },
                  { key: 'item_part', label: 'Visibility' },
                  { key: 'value', label: 'In Builder' },
                ]}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
