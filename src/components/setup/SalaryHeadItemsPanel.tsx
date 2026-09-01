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

export function SalaryHeadItemsPanel() {
  const [selectedHeadId, setSelectedHeadId] = useState<number | null>(null);

  const { data: heads = [] } = useQuery<SalaryHead[]>({
    queryKey: ['setup/salary-heads'],
    queryFn: () => fetch('/api/setup/salary-heads').then((r) => r.json()),
  });

  const activeHeads = heads.filter((h) => h.status === 1);
  const activeHeadId = selectedHeadId ?? activeHeads[0]?.head_pkey ?? null;

  if (activeHeads.length === 0) {
    return <p className="text-sm text-gray-500">No active category. Create or reactivate one on the &quot;Salary Head Categories&quot; tab.</p>;
  }

  const categorySelect = (
    <select
      value={activeHeadId ?? ''}
      onChange={(e) => setSelectedHeadId(Number(e.target.value))}
      className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-[#0F172A] hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)]/60 transition-colors duration-150"
    >
      {activeHeads.map((h) => (
        <option key={h.head_pkey} value={h.head_pkey}>{h.head_desc}</option>
      ))}
    </select>
  );

  return (
    <div>
      {activeHeadId && (
        <SetupCrudPage
          hideTitle
          title="Salary Head Items"
          apiPath="setup/salary-head-items"
          queryParams={{ headId: String(activeHeadId) }}
          headerExtra={categorySelect}
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
    </div>
  );
}
