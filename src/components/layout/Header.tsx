'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Power, User, UserCog, ChevronDown } from 'lucide-react';
import { useHeaderSlot } from './HeaderSlotContext';

export function Header() {
  const { data: session } = useSession();
  const { setSlotEl } = useHeaderSlot();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  return (
    <header className="min-h-16 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-2.5 flex-shrink-0">
      {/* Pages can portal page-specific content (e.g. title, stats, an employee search bar) in here via useHeaderSlot() */}
      <div ref={setSlotEl} className="flex-1 flex flex-wrap items-center gap-4 min-w-0" />
      <div ref={menuRef} className="relative flex-shrink-0 ml-auto">
        {/* Collapsed by default to just the role badge; hovering reveals the logged-in user id.
            Clicking opens a Profile / Sign Out menu instead of exposing Sign Out as a standing button. */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="group flex items-center text-sm text-[#0F172A] glass-panel rounded-full pl-2.5 pr-2.5 py-1.5 hover:bg-white/70 transition-colors duration-[180ms]"
        >
          <span className="w-6 h-6 rounded-full bg-[color:var(--color-primary)] flex items-center justify-center flex-shrink-0">
            <User className="w-3.5 h-3.5 text-white" />
          </span>
          <div className="flex items-center overflow-hidden max-w-0 opacity-0 group-hover:max-w-[200px] group-hover:opacity-100 group-hover:ml-2 transition-all duration-200 ease-out">
            <span className="font-semibold text-[#0F172A] whitespace-nowrap">{session?.user.loginUserId}</span>
          </div>
          {session?.user.userGroup === 1 && (
            <span className="ml-2 text-xs bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap">
              Admin
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 ml-1 transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+8px)] w-52 bg-white rounded-2xl shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18)] border border-slate-100 py-1.5 z-30 animate-fade-in"
          >
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); router.push('/setup/company'); }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-[#0F172A] hover:bg-slate-50 transition-colors duration-[180ms]"
            >
              <span className="w-7 h-7 rounded-full bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)] flex items-center justify-center flex-shrink-0">
                <UserCog className="w-3.5 h-3.5" />
              </span>
              Profile
            </button>
            <button
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/[0.06] transition-colors duration-[180ms]"
            >
              <span className="w-7 h-7 rounded-full bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)] flex items-center justify-center flex-shrink-0">
                <Power className="w-3.5 h-3.5" strokeWidth={2.25} />
              </span>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
