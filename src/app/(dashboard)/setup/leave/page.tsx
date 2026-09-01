'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { LeaveTypesPanel } from '@/components/setup/LeaveTypesPanel';
import { LeavePolicyGroupsPanel } from '@/components/setup/LeavePolicyGroupsPanel';
import { LeavePolicyPanel } from '@/components/setup/LeavePolicyPanel';

const TABS = [
  { value: 'types' as const, label: 'Leave Types' },
  { value: 'groups' as const, label: 'Leave Policy Groups' },
  { value: 'policy' as const, label: 'Leave Policy' },
];
type Tab = (typeof TABS)[number]['value'];

export default function LeaveSetupPage() {
  const { slotEl } = useHeaderSlot();
  const [tab, setTab] = useState<Tab>('types');

  return (
    <div>
      {/* Page title sits in the global Header row, left-aligned with this content, alongside the account controls. */}
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Leave
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Leave types and accrual/policy rules
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

      {tab === 'types' && <LeaveTypesPanel />}
      {tab === 'groups' && <LeavePolicyGroupsPanel />}
      {tab === 'policy' && <LeavePolicyPanel />}
    </div>
  );
}
