import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { HeaderSlotProvider } from '@/components/layout/HeaderSlotContext';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  // Employee-self-service logins (userGroup 2) get their own minimal shell instead of the
  // full admin dashboard — every admin page/API route below rejects userGroup!==1 anyway.
  if (session.user.userGroup !== 1) redirect('/ess');

  return (
    <HeaderSlotProvider>
      <div className="flex h-screen overflow-hidden app-shell-bg">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </HeaderSlotProvider>
  );
}
