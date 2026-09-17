'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Power } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/ess/regularisation', label: 'Regularisation' },
  { href: '/ess/leave-encashment', label: 'Leave Encashment' },
];

// Deliberately not the admin Header — no Profile link (points at an admin-only page) and no
// header-slot portal. Now carries a small nav since there's more than one ESS page.
export function EssHeader() {
  const { data: session } = useSession();
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-200 bg-white/60 backdrop-blur-sm">
      <div className="flex items-center justify-between px-6 py-4">
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
      </div>
      <nav className="flex items-center gap-1 px-6 pb-3 text-[12.5px]">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'px-3 py-1.5 rounded-md font-medium transition-colors duration-150',
              pathname === item.href
                ? 'bg-[color:var(--color-primary-light)] text-[color:var(--color-primary)]'
                : 'text-slate-500 hover:bg-slate-100'
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
