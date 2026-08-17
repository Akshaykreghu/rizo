'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/Avatar';
import { navItems } from '@/lib/navItems';
import { useEffect, useState } from 'react';

const EXPANDED_STORAGE_KEY = 'rizo-sidebar-expanded';

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user.userGroup === 1;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (stored) setExpanded(stored === 'true');
  }, []);

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      window.localStorage.setItem(EXPANDED_STORAGE_KEY, String(next));
      return next;
    });
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  const visibleItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside
      className={cn(
        'glass-panel flex-shrink-0 flex flex-col h-full my-3 ml-3 rounded-[28px] py-4 transition-[width] duration-200',
        expanded ? 'w-64 items-stretch overflow-visible' : 'w-[72px] items-center overflow-visible'
      )}
    >
      {/* Logo + collapse toggle */}
      <div className={cn('flex items-center flex-shrink-0 mb-5', expanded ? 'justify-between px-4' : 'justify-center')}>
        <div className={cn('flex items-center', expanded && 'gap-2.5')}>
          <div className="w-11 h-11 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center flex-shrink-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/branding/rizo-logo.jpg" alt="RIZO" className="w-full h-full object-contain" />
          </div>
          {expanded && (
            <div>
              <p className="font-heading text-sm font-bold text-[#0F172A] leading-none">RIZO</p>
              <p className="text-[11px] text-[#64748B] mt-1">HR & Payroll</p>
            </div>
          )}
        </div>
        {expanded && (
          <button
            onClick={toggleExpanded}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100/80 hover:text-slate-700 transition-all duration-[180ms]"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
        )}
      </div>
      {!expanded && (
        <button
          onClick={toggleExpanded}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="mb-2 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100/80 hover:text-slate-700 transition-all duration-[180ms]"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      )}

      {/* Nav */}
      <nav className={cn('flex-1 flex flex-col gap-1.5 w-full overflow-y-auto overflow-x-visible scroll-fade', expanded ? 'items-stretch px-3' : 'items-center px-2.5')}>
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const href = item.href ?? `/menu/${item.slug}`;
          const active = item.href
            ? isActive(item.href)
            : isActive(href) || item.children?.some((c) => isActive(c.href));

          return (
            <div key={item.label} className={cn('relative group w-full flex', expanded ? 'justify-stretch' : 'justify-center')}>
              <Link
                href={href}
                aria-label={item.label}
                className={cn(
                  'flex items-center transition-all duration-[180ms]',
                  expanded
                    ? 'w-full gap-3 px-3 py-2.5 rounded-xl text-sm font-medium'
                    : 'w-11 h-11 rounded-2xl justify-center',
                  active ? 'nav-pill-active text-[#1687E8]' : 'text-slate-400 hover:bg-slate-100/80 hover:text-slate-700'
                )}
              >
                <Icon className="w-[22px] h-[22px] flex-shrink-0" strokeWidth={1.75} />
                {expanded && item.label}
              </Link>
              {!expanded && (
                <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 whitespace-nowrap glass-card-strong rounded-xl px-3 py-1.5 text-xs font-medium text-slate-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-[180ms] z-50">
                  {item.label}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User avatar docked at bottom */}
      {session?.user.loginUserId && (
        <div className={cn('relative group flex flex-shrink-0 mt-3', expanded ? 'items-center gap-2.5 px-4' : 'justify-center')}>
          <div className="p-0.5 rounded-full ring-2 ring-white/70 flex-shrink-0">
            <Avatar name={session.user.loginUserId} />
          </div>
          {expanded ? (
            <span className="text-sm font-medium text-slate-600 truncate">{session.user.loginUserId}</span>
          ) : (
            <div className="pointer-events-none absolute left-full bottom-1/2 translate-y-1/2 ml-3 whitespace-nowrap glass-card-strong rounded-xl px-3 py-1.5 text-xs font-medium text-slate-700 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-[180ms] z-50">
              {session.user.loginUserId}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
