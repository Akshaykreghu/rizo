'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

interface TaxType {
  tax_type_pkey: number;
  tax_type: string;
  tax_status: number;
}
interface TaxHead {
  tax_heads_pkey: number;
  tax_name: string;
  tax_active: string;
}

export default function TaxHeadsPage() {
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [selectedHeadId, setSelectedHeadId] = useState<number | null>(null);

  const { data: types = [] } = useQuery<TaxType[]>({
    queryKey: ['setup/tax-types'],
    queryFn: () => fetch('/api/setup/tax-types').then((r) => r.json()),
  });
  const activeTypes = types.filter((t) => t.tax_status === 1);
  const activeTypeId = selectedTypeId ?? activeTypes[0]?.tax_type_pkey ?? null;

  const { data: heads = [] } = useQuery<TaxHead[]>({
    queryKey: ['setup/tax-heads', { taxTypeFkey: String(activeTypeId ?? '') }],
    queryFn: () => fetch(`/api/setup/tax-heads?taxTypeFkey=${activeTypeId}`).then((r) => r.json()),
    enabled: !!activeTypeId,
  });
  const activeHeads = heads.filter((h) => h.tax_active === 'Y');
  const activeHeadId = selectedHeadId ?? activeHeads[0]?.tax_heads_pkey ?? null;

  return (
    <div className="space-y-10">
      <div>
        <SetupCrudPage
          title="Tax Categories"
          apiPath="setup/tax-types"
          primaryKey="tax_type_pkey"
          displayKey="tax_type"
          fields={[
            { key: 'tax_type', label: 'Category Name', required: true },
            { key: 'tax_desc', label: 'Description' },
            { key: 'tax_occurance', label: 'Occurance' },
            { key: 'tax_operator', label: 'Operator' },
          ]}
          columns={[
            { key: 'tax_type', label: 'Category' },
            { key: 'tax_desc', label: 'Description' },
            { key: 'tax_status', label: 'Status' },
          ]}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Tax Heads</h2>
        {activeTypes.length === 0 ? (
          <p className="text-sm text-gray-500">No active category. Create or reactivate one above.</p>
        ) : (
          <>
            <div className="mb-4 max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={activeTypeId ?? ''}
                onChange={(e) => { setSelectedTypeId(Number(e.target.value)); setSelectedHeadId(null); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {activeTypes.map((t) => (
                  <option key={t.tax_type_pkey} value={t.tax_type_pkey}>{t.tax_type}</option>
                ))}
              </select>
            </div>

            {activeTypeId && (
              <SetupCrudPage
                title="Tax Heads"
                apiPath="setup/tax-heads"
                queryParams={{ taxTypeFkey: String(activeTypeId) }}
                primaryKey="tax_heads_pkey"
                displayKey="tax_name"
                fields={[
                  { key: 'tax_name', label: 'Head Name', required: true },
                  { key: 'tax_details', label: 'Details' },
                  { key: 'attr1', label: 'Yearly Limit (₹)' },
                  { key: 'order_level1', label: 'Display Order', type: 'number' },
                ]}
                columns={[
                  { key: 'tax_name', label: 'Head' },
                  { key: 'attr1', label: 'Yearly Limit' },
                  { key: 'tax_active', label: 'Active' },
                ]}
              />
            )}
          </>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Tax Head Sub-Items</h2>
        {activeHeads.length === 0 ? (
          <p className="text-sm text-gray-500">No active tax head in this category. Create or reactivate one above.</p>
        ) : (
          <>
            <div className="mb-4 max-w-xs">
              <label className="block text-sm font-medium text-gray-700 mb-1">Tax Head</label>
              <select
                value={activeHeadId ?? ''}
                onChange={(e) => setSelectedHeadId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {activeHeads.map((h) => (
                  <option key={h.tax_heads_pkey} value={h.tax_heads_pkey}>{h.tax_name}</option>
                ))}
              </select>
            </div>

            {activeHeadId && (
              <SetupCrudPage
                title="Tax Head Sub-Items"
                apiPath="setup/tax-heads-details"
                queryParams={{ headId: String(activeHeadId) }}
                primaryKey="tax_heads_details_pkey"
                displayKey="tax_heads_details"
                fields={[
                  { key: 'tax_heads_details', label: 'Sub-item Name', required: true },
                  { key: 'tax_heads_details1', label: 'Notes' },
                  { key: 'tax_heads_details2', label: 'Per-line Limit (₹)' },
                ]}
                columns={[
                  { key: 'tax_heads_details', label: 'Sub-item' },
                  { key: 'tax_heads_details2', label: 'Per-line Limit' },
                  { key: 'active', label: 'Active' },
                ]}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
