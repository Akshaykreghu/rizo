'use client';

import { signOut, useSession } from 'next-auth/react';
import { Power, User } from 'lucide-react';
import { useHeaderSlot } from './HeaderSlotContext';

export function Header() {
  const { data: session } = useSession();
  const { setSlotEl } = useHeaderSlot();

  return (
    <header className="h-16 flex items-center justify-between gap-4 px-6 flex-shrink-0">
      {/* Pages can portal page-specific content (e.g. an employee search bar) in here via useHeaderSlot() */}
      <div ref={setSlotEl} className="flex-1 flex items-center min-w-0" />
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex items-center gap-2 text-sm text-[#0F172A] glass-panel rounded-full pl-2.5 pr-3 py-1.5">
          <span className="w-6 h-6 rounded-full bg-[color:var(--color-primary)] flex items-center justify-center flex-shrink-0">
            <User className="w-3.5 h-3.5 text-white" />
          </span>
          <span className="font-semibold text-[#0F172A]">{session?.user.loginUserId}</span>
          <span className="text-[#CBD5E1]">·</span>
          <span className="text-[#64748B]">{session?.user.companyCode}</span>
          {session?.user.userGroup === 1 && (
            <span className="text-xs bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] px-2.5 py-0.5 rounded-full font-medium">
              Admin
            </span>
          )}
        </div>

        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          title="Sign Out"
          aria-label="Sign Out"
          className="w-9 h-9 rounded-full bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)] flex items-center justify-center hover:bg-[color:var(--color-danger)] hover:text-white transition-colors duration-[180ms] flex-shrink-0"
        >
          <Power className="w-4 h-4" strokeWidth={2.25} />
        </button>
      </div>
    </header>
  );
}
