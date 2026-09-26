'use client';

import { cn } from '@/lib/utils';

const BTN_BASE =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

// Server-state hard blocks the user can't fix by editing a field right there (attendance already
// exists/verified, leave already exists, punch conflict, no leave balance) — distinct from inline
// field-validation text (shown in the form itself) and from the bottom-right toast (reserved for the
// outcome of an action that actually ran: applied, cancelled, approved, rejected, or a failure).
export function AlertModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 backdrop-blur-[2px] p-4 animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-[16px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.25)] p-5 w-full max-w-sm animate-modal-in"
      >
        <p className="text-[13px] text-[color:var(--color-danger-dark)] font-medium mb-4">{message}</p>
        <button
          onClick={onClose}
          className={cn(BTN_BASE, 'w-full justify-center bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)] text-white')}
        >
          OK
        </button>
      </div>
    </div>
  );
}
