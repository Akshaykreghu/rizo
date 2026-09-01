'use client';

import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { SalaryHeadCategoriesPanel } from '@/components/setup/SalaryHeadCategoriesPanel';
import { SalaryHeadItemsPanel } from '@/components/setup/SalaryHeadItemsPanel';
import { SalaryStructurePanel } from '@/components/setup/SalaryStructurePanel';

const TABS = [
  { value: 'categories' as const, label: 'Salary Head Categories' },
  { value: 'items' as const, label: 'Salary Head Items' },
  { value: 'salary-structure' as const, label: 'Salary Structure' },
];
type Tab = (typeof TABS)[number]['value'];

function SalarySetupContent() {
  const { slotEl } = useHeaderSlot();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('tab') === 'salary-structure' ? 'salary-structure' : 'categories';
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div>
      {/* Page title sits in the global Header row, left-aligned with this content, alongside the account controls. */}
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Salary
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Salary head categories, items and structure templates
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

      {tab === 'categories' && <SalaryHeadCategoriesPanel />}
      {tab === 'items' && <SalaryHeadItemsPanel />}
      {tab === 'salary-structure' && <SalaryStructurePanel />}
    </div>
  );
}

export default function SalarySetupPage() {
  return (
    <Suspense fallback={null}>
      <SalarySetupContent />
    </Suspense>
  );
}
