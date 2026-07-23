import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';

// Deliberately outside the (dashboard) route group — no Sidebar/Header, since this is meant to
// open in its own tab as a printable document (mirrors legacy's View Slip opening a separate
// browser window rather than an in-app panel).

export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  return <div className="min-h-screen bg-white text-gray-900">{children}</div>;
}
