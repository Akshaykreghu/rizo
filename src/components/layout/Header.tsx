'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { ChevronDown, LogOut, User } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Header() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <header className="h-16 flex items-center justify-between px-6 flex-shrink-0">
      <div />
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-2 text-sm text-[#0F172A] glass-panel rounded-full pl-2.5 pr-3 py-1.5 transition-colors duration-[180ms] hover:bg-white/85"
        >
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
          <ChevronDown className={cn('w-3.5 h-3.5 text-[#64748B] transition-transform duration-[180ms]', open && 'rotate-180')} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 w-44 glass-card-strong rounded-xl p-1.5 z-50"
          >
            <button
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-[#64748B] hover:bg-[color:var(--color-danger)]/10 hover:text-[color:var(--color-danger)] transition-colors duration-[180ms]"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
