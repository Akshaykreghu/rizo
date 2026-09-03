import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { EssHeader } from '@/components/ess/EssHeader';

// Minimal shell for employee self-service (userGroup 2) logins — deliberately not the admin
// Sidebar/Header, since every admin page/API route rejects userGroup!==1. Kept intentionally
// small: one feature (Regularisation) today, structured so more ESS pages can be added as
// separate route segments under here without touching this shell.
export default async function EssLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  if (session.user.userGroup === 1) redirect('/dashboard');

  return (
    <div className="min-h-screen app-shell-bg">
      <EssHeader />
      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
