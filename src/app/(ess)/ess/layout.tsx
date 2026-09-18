import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { EssLegacyShell } from '@/components/ess/EssLegacyShell';
import '@/styles/ess-legacy.css';

// Shell for employee self-service (userGroup 2) logins — deliberately not the admin
// Sidebar/Header, since every admin page/API route rejects userGroup!==1. The nav/visual design
// here is a 1:1 port of New Rizo's components/ESSLayout.jsx (see ess-legacy.css for the ported
// design system, scoped under `.ess-legacy` so it can't leak into or collide with admin styles).
export default async function EssLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.userGroup === 1) redirect('/dashboard');

  return <EssLegacyShell>{children}</EssLegacyShell>;
}
