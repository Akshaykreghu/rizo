'use client';

import { signOut, useSession } from 'next-auth/react';
import { LogOut, User } from 'lucide-react';

export function Header() {
  const { data: session } = useSession();

  return (
    <header className="h-16 flex items-center justify-between px-6 flex-shrink-0">
      <div />
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-slate-600 glass-panel rounded-full pl-2.5 pr-3.5 py-1.5 shadow-sm">
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center flex-shrink-0">
            <User className="w-3.5 h-3.5 text-white" />
          </span>
          <span className="font-semibold text-slate-700">{session?.user.loginUserId}</span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-400">{session?.user.companyCode}</span>
          {session?.user.userGroup === 1 && (
            <span className="text-xs bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-2.5 py-0.5 rounded-full font-medium shadow-sm shadow-indigo-200">
              Admin
            </span>
          )}
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-rose-600 transition-colors glass-panel rounded-full px-3.5 py-1.5 shadow-sm"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </header>
  );
}
