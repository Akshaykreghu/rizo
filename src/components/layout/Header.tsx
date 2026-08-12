'use client';

import { signOut, useSession } from 'next-auth/react';
import { LogOut, User } from 'lucide-react';

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="h-16 flex items-center justify-between px-6 flex-shrink-0">
      <div />
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-[#0F172A] glass-panel rounded-full pl-2.5 pr-3.5 py-1.5">
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
          className="flex items-center gap-1.5 text-sm text-[#64748B] hover:text-[color:var(--color-danger)] transition-colors duration-[180ms] glass-panel rounded-full px-3.5 py-1.5"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </header>
  );
}
