import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { ChevronRight } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { navItems } from '@/lib/navItems';

const ACCENTS = [
  { fg: 'var(--color-primary)', bg: 'var(--color-primary-soft)' },
  { fg: 'var(--color-accent)', bg: 'var(--color-accent-soft)' },
  { fg: 'var(--color-success)', bg: 'var(--color-success-soft)' },
  { fg: 'var(--color-highlight-dark)', bg: 'var(--color-highlight-light)' },
  { fg: 'var(--color-danger)', bg: 'var(--color-danger-soft)' },
];

export default async function MenuSectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);

  const item = navItems.find((i) => i.slug === slug && i.children);
  if (!item || !item.children) notFound();
  if (item.adminOnly && session?.user.userGroup !== 1) notFound();

  const Icon = item.icon;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <span className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-[color:var(--color-primary-soft)] text-[color:var(--color-primary)]">
          <Icon className="w-5 h-5" strokeWidth={1.75} />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight">{item.label}</h1>
          <p className="text-[13.5px] text-slate-500 mt-0.5">{item.children.length} sections</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {item.children.map((child, i) => {
          const accent = ACCENTS[i % ACCENTS.length];
          return (
            <Link
              key={child.href}
              href={child.href}
              className="group surface-card lift-on-hover rounded-2xl p-5 flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: accent.bg, color: accent.fg }}
                >
                  <Icon className="w-5 h-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#0F172A] truncate">{child.label}</p>
                  <p className="text-[12.5px] text-slate-500 mt-1 leading-snug">{child.description}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors duration-[180ms] flex-shrink-0 mt-1" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
