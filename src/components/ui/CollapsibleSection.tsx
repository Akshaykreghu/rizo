'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function SectionHeading({ children }: { children: string }) {
  return <h3 className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-4">{children}</h3>;
}

// Ports legacy setups.ctp's "Other Details" eye-icon toggle — each sub-section (Education/
// Experience/Family/Documents) starts collapsed and expands independently on click.
export function CollapsibleSection({
  title, icon: Icon, defaultOpen = false, disabled, children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  /** Locks the section's own content (Employee Detail's "Editable" toggle off) without touching
   *  the eye button above — that button toggles browsing the read-only content, not editing it,
   *  so it has to stay clickable either way. A <fieldset disabled> around this whole component
   *  (the previous approach) would have disabled the button too: a disabled fieldset cascades to
   *  every descendant form control, with no way to exempt just one of them. Scoping the fieldset
   *  to `children` instead — a sibling of the button, not an ancestor — keeps the two independent. */
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 bg-slate-50/60 hover:bg-slate-50 transition-colors duration-150"
      >
        <span className="flex items-center gap-2.5 text-sm font-semibold text-[#0F172A]">
          <Icon className="w-4 h-4 text-[color:var(--color-primary)]" />
          {title}
        </span>
        {open ? <Eye className="w-4 h-4 text-slate-400" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <fieldset disabled={disabled} className="contents">
          <div className="p-4">{children}</div>
        </fieldset>
      )}
    </div>
  );
}
