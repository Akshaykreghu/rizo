'use client';

import { useEffect } from 'react';
import { AlertTriangle, Info, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// In-app replacement for window.confirm() on consequential actions: a titled card with an
// optional key/value summary of what's about to be affected and an optional highlighted warning.
// Stays open while `pending` (buttons disabled, spinner on confirm) so the caller can close it only
// once the action has actually finished.
export function ConfirmDialog({
  open,
  tone = 'primary',
  title,
  description,
  details,
  warning,
  confirmLabel = 'Confirm',
  pendingLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  tone?: 'primary' | 'danger';
  title: string;
  description?: React.ReactNode;
  details?: { label: string; value: React.ReactNode }[];
  warning?: React.ReactNode;
  confirmLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, pending, onCancel]);

  if (!open) return null;
  const danger = tone === 'danger';
  const Icon = danger ? AlertTriangle : Info;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/35 backdrop-blur-[2px] animate-fade-in" onClick={() => !pending && onCancel()} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-md bg-white rounded-[20px] border border-black/[0.06] shadow-[0_25px_70px_-15px_rgba(0,0,0,0.3)] p-6 animate-modal-in"
      >
        <button
          onClick={onCancel}
          disabled={pending}
          aria-label="Close"
          className="absolute right-4 top-4 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              'shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
              danger ? 'bg-red-50 text-[color:var(--color-danger)]' : 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)]'
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 pt-0.5 pr-6">
            <h2 id="confirm-dialog-title" className="text-[16px] font-semibold text-[#0F172A] tracking-tight break-words">{title}</h2>
            {description && <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500 break-words [overflow-wrap:anywhere]">{description}</p>}
          </div>
        </div>

        {details && details.length > 0 && (
          <dl className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 divide-y divide-slate-100 text-[12.5px]">
            {details.map((d) => (
              <div key={d.label} className="flex items-start justify-between gap-4 px-3.5 py-2">
                <dt className="shrink-0 text-slate-500">{d.label}</dt>
                <dd className="min-w-0 font-medium text-[#0F172A] text-right break-words [overflow-wrap:anywhere]">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {warning && (
          <div
            className={cn(
              'mt-3 rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed border break-words [overflow-wrap:anywhere]',
              danger ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-800'
            )}
          >
            {warning}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={pending}
            className="px-3.5 py-1.5 rounded-[9px] text-[12.5px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            autoFocus
            className={cn(
              'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[9px] text-[12.5px] font-semibold text-white shadow-sm transition-colors disabled:opacity-70',
              danger
                ? 'bg-[color:var(--color-danger)] hover:brightness-95'
                : 'bg-[color:var(--color-primary)] hover:bg-[color:var(--color-primary-dark)]'
            )}
          >
            {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {pending ? pendingLabel ?? confirmLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
