'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { SetupCrudPage } from '@/components/setup/SetupCrudPage';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';

const TABS = [
  { value: 'categories' as const, label: 'Tax Categories' },
  { value: 'heads' as const, label: 'Tax Heads' },
  { value: 'subitems' as const, label: 'Tax Head Sub-Items' },
];
type Tab = (typeof TABS)[number]['value'];

const INPUT_CLASS =
  'border border-slate-200 bg-white rounded-[9px] px-2.5 py-1.5 text-[12.5px] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-primary)]/25 focus:border-[color:var(--color-primary)] transition-colors';

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
  const { slotEl } = useHeaderSlot();
  const [tab, setTab] = useState<Tab>('categories');
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

  const typeSelect = (
    <select
      value={activeTypeId ?? ''}
      onChange={(e) => { setSelectedTypeId(Number(e.target.value)); setSelectedHeadId(null); }}
      className={INPUT_CLASS}
    >
      {activeTypes.map((t) => (
        <option key={t.tax_type_pkey} value={t.tax_type_pkey}>{t.tax_type}</option>
      ))}
    </select>
  );

  const headSelect = (
    <select
      value={activeHeadId ?? ''}
      onChange={(e) => setSelectedHeadId(Number(e.target.value))}
      className={INPUT_CLASS}
    >
      {activeHeads.map((h) => (
        <option key={h.tax_heads_pkey} value={h.tax_heads_pkey}>{h.tax_name}</option>
      ))}
    </select>
  );

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Tax Heads
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Tax categories, heads, and sub-items used in income tax declarations
            </p>
          </div>,
          slotEl
        )}

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-5">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={cn(
                'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
                tab === t.value
                  ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
                  : 'bg-white text-slate-500 border-transparent hover:bg-white/70'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'categories' && (
        <SetupCrudPage
          hideTitle
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
      )}

      {tab === 'heads' && (
        activeTypes.length === 0 ? (
          <p className="text-[12.5px] text-slate-400">No active category. Create or reactivate one on the &quot;Tax Categories&quot; tab.</p>
        ) : (
          activeTypeId && (
            <SetupCrudPage
              hideTitle
              title="Tax Heads"
              apiPath="setup/tax-heads"
              queryParams={{ taxTypeFkey: String(activeTypeId) }}
              primaryKey="tax_heads_pkey"
              displayKey="tax_name"
              headerExtra={typeSelect}
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
          )
        )
      )}

      {tab === 'subitems' && (
        activeHeads.length === 0 ? (
          <p className="text-[12.5px] text-slate-400">No active tax head in this category. Create or reactivate one on the &quot;Tax Heads&quot; tab.</p>
        ) : (
          activeHeadId && (
            <SetupCrudPage
              hideTitle
              title="Tax Head Sub-Items"
              apiPath="setup/tax-heads-details"
              queryParams={{ headId: String(activeHeadId) }}
              primaryKey="tax_heads_details_pkey"
              displayKey="tax_heads_details"
              headerExtra={headSelect}
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
          )
        )
      )}
    </div>
  );
}
