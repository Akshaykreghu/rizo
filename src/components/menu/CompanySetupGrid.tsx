'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ChevronRight,
  Building2,
  Contact,
  PartyPopper,
  TreePalm,
  Clock,
  DollarSign,
  Fingerprint,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';
import type { NavChild } from '@/lib/navItems';

const ACCENTS = [
  { fg: 'var(--color-primary)', bg: 'var(--color-primary-soft)' },
  { fg: 'var(--color-accent)', bg: 'var(--color-accent-soft)' },
  { fg: 'var(--color-success)', bg: 'var(--color-success-soft)' },
  { fg: 'var(--color-highlight-dark)', bg: 'var(--color-highlight-light)' },
  { fg: 'var(--color-danger)', bg: 'var(--color-danger-soft)' },
];

// One icon per card, matched to what it actually configures — replaces the parent menu's
// single Building2 icon repeated on every card.
const CARD_ICONS: Record<string, LucideIcon> = {
  'Company Profile': Building2,
  'Contacts': Contact,
  'Holiday': PartyPopper,
  'Leave': TreePalm,
  'Shift': Clock,
  'Salary': DollarSign,
  'Devices': Fingerprint,
  'Profession': Briefcase,
};

type Status = 'configured' | 'action-required' | 'not-configured';

interface SectionStatus {
  status: Status;
  detail: string;
}

interface StatusResponse {
  sections: Record<string, SectionStatus>;
  configuredCount: number;
  totalCount: number;
}

const STATUS_DOT: Record<Status, string> = {
  configured: 'bg-[color:var(--color-success)]',
  'action-required': 'bg-[color:var(--color-highlight-dark)]',
  'not-configured': 'bg-slate-300',
};

const STATUS_TEXT: Record<Status, string> = {
  configured: 'text-[color:var(--color-success-dark)]',
  'action-required': 'text-[color:var(--color-highlight-dark)]',
  'not-configured': 'text-slate-400',
};

function StatusBadge({ section }: { section?: SectionStatus }) {
  if (!section) return <div className="h-[15px]" />; // reserves the row's height while loading, avoids layout shift
  return (
    <p className={`flex items-center gap-1.5 text-[11px] font-medium mt-2 ${STATUS_TEXT[section.status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[section.status]}`} />
      {section.detail}
    </p>
  );
}

interface CompanySetupGridProps {
  label: string;
  icon: React.ReactNode;
  items: NavChild[];
}

export function CompanySetupGrid({ label, icon, items }: CompanySetupGridProps) {
  const { data: statusData } = useQuery<StatusResponse>({
    queryKey: ['setup/company-setup-status'],
    queryFn: () => fetch('/api/setup/company-setup-status').then((r) => r.json()),
  });

  // Cards without a `section` render together, unheaded, first — sectioned cards then follow
  // in their own labeled groups, in the order each section first appears.
  const sections = new Map<string | undefined, NavChild[]>();
  for (const child of items) {
    if (!sections.has(child.section)) sections.set(child.section, []);
    sections.get(child.section)!.push(child);
  }
  const sectionEntries = [...sections.entries()].sort(([a], [b]) => (a ? 1 : 0) - (b ? 1 : 0));

  const pct = statusData ? Math.round((statusData.configuredCount / Math.max(statusData.totalCount, 1)) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-7 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-[color:var(--color-primary-soft)] text-[color:var(--color-primary)]">
            {icon}
          </span>
          <div>
            <h1 className="font-heading text-2xl font-bold text-[#0F172A] tracking-tight">{label}</h1>
            <p className="text-[13.5px] text-slate-500 mt-0.5">{items.length} sections</p>
          </div>
        </div>

        {statusData && (
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <span className="text-[12.5px] font-medium text-slate-500 whitespace-nowrap">
              <span className="font-semibold text-[#0F172A]">{statusData.configuredCount} of {statusData.totalCount}</span> sections configured
            </span>
            <div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
              <div
                className="h-full rounded-full bg-[color:var(--color-primary)] transition-[width] duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div>
        {sectionEntries.map(([section, children], si) => {
          const accent = ACCENTS[si % ACCENTS.length];
          return (
            <div
              key={section ?? '__unsectioned'}
              className={si > 0 ? 'mt-10 pt-10 border-t border-[#E5EAF1]' : ''}
            >
              {section && (
                <h2 className="text-[13.5px] font-semibold uppercase tracking-wide text-slate-600 mb-4">
                  {section}
                </h2>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {children.map((child) => {
                  const CardIcon = CARD_ICONS[child.label] ?? Building2;
                  return (
                  <Link
                    key={child.href}
                    href={child.href}
                    className="group surface-card lift-on-hover rounded-2xl p-5 flex items-start justify-between gap-3 border border-slate-200/70 hover:border-slate-300 transition-colors duration-150"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <span
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: accent.bg, color: accent.fg }}
                      >
                        <CardIcon className="w-5 h-5" strokeWidth={1.75} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#0F172A] truncate">{child.label}</p>
                        <p className="text-[12.5px] text-slate-600 mt-1 leading-snug">{child.description}</p>
                        <StatusBadge section={statusData?.sections[child.label]} />
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all duration-150 flex-shrink-0 mt-1" />
                  </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
