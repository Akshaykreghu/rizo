'use client';

import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { ShiftsPanel } from '@/components/setup/ShiftsPanel';

export default function ShiftSetupPage() {
  const { slotEl } = useHeaderSlot();

  return (
    <div>
      {/* Page title sits in the global Header row, left-aligned with this content, alongside the account controls. */}
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Shift
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">
              Work shift timings and policy
            </p>
          </div>,
          slotEl
        )}

      <div className="sticky top-0 z-20 glass-card-strong rounded-xl px-3 py-2 flex items-center mb-5">
        <div className="flex items-center gap-1 flex-wrap text-[12.5px] bg-slate-900/[0.03] rounded-lg p-0.5">
          <button
            className={cn(
              'px-3 py-1 rounded-md transition-all duration-[180ms] font-medium border whitespace-nowrap',
              'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] border-[color:var(--color-primary)]/30'
            )}
          >
            Shift Policy
          </button>
        </div>
      </div>

      <ShiftsPanel />
    </div>
  );
}
