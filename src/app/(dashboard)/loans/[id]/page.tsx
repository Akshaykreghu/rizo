'use client';

import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHeaderSlot } from '@/components/layout/HeaderSlotContext';
import { LoanDetailContent } from '@/components/loans/LoanDetailContent';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function LoanDetailPage() {
  const { slotEl } = useHeaderSlot();
  const router = useRouter();
  const params = useParams<{ id: string }>();

  return (
    <div>
      {slotEl &&
        createPortal(
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight leading-tight truncate">
              Loan Details
            </h1>
            <p className="text-sm text-[#64748B] mt-0.5 truncate">EMI schedule and repayment ledger</p>
          </div>,
          slotEl
        )}

      <button
        onClick={() => router.push('/loans')}
        className={cn(BTN_BASE, 'bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 mb-4')}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to loans
      </button>

      <LoanDetailContent loanId={Number(params.id)} />
    </div>
  );
}
