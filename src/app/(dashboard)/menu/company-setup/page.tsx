import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { navItems } from '@/lib/navItems';
import { CompanySetupGrid } from '@/components/menu/CompanySetupGrid';

export default async function CompanySetupMenuPage() {
  const session = await getServerSession(authOptions);

  const item = navItems.find((i) => i.slug === 'company-setup' && i.children);
  if (!item || !item.children) notFound();
  if (item.adminOnly && session?.user.userGroup !== 1) notFound();

  const Icon = item.icon;

  return (
    <CompanySetupGrid
      label={item.label}
      icon={<Icon className="w-5 h-5" strokeWidth={1.75} />}
      items={item.children}
    />
  );
}
