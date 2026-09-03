'use client';

import { signOut, useSession } from 'next-auth/react';
import { Power } from 'lucide-react';

// Deliberately not the admin Header — no Profile link (points at an admin-only page) and no
// header-slot portal (only one ESS page exists so far). Extend this, don't reuse admin Header,
// as more ESS pages are added.
export function EssHeader() {
  const { data: session } = useSession();

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white/60 backdrop-blur-sm">
      <div>
        <div className="font-heading text-lg font-bold text-[#0F172A] tracking-tight">My Requests</div>
        <div className="text-xs text-slate-500">{session?.user.loginUserId}</div>
      </div>
      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-[12.5px] font-semibold text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10 transition-colors duration-150"
      >
        <Power className="w-3.5 h-3.5" strokeWidth={2.25} /> Sign Out
      </button>
    </header>
  );
}
