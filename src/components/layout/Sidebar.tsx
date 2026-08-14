'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  TreePalm,
  DollarSign,
  FileText,
  Building2,
  Settings,
  CreditCard,
  Package,
  Receipt,
  Sparkles,
  Wand2,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/Avatar';
import { useEffect, useState } from 'react';

const EXPANDED_STORAGE_KEY = 'rizo-sidebar-expanded';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children?: { label: string; href: string }[];
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Ask RIZO', href: '/assistant', icon: Sparkles },
  { label: 'AI Navigation Demo', href: '/ai-navigation', icon: Wand2 },
  {
    label: 'Employees',
    icon: Users,
    children: [
      { label: 'Employee Join', href: '/employees/join' },
      { label: 'Import Employee', href: '/employees/import' },
      { label: 'User Access', href: '/employees/access' },
      { label: 'Allocate Assets', href: '/employees/assets' },
      { label: 'Allocate Policies in Bulk', href: '/employees/bulk-policies' },
      { label: 'Menu Allocation', href: '/employees/menu-allocation' },
      { label: 'Document Upload', href: '/employees/documents' },
      { label: 'Income Tax Declarations', href: '/employees/tax-declarations' },
      { label: 'Promotion Approval', href: '/employees/promotions' },
      { label: 'Generate Employee Documents', href: '/employees/generate-documents' },
      { label: 'Remove Employee', href: '/employees/resignations' },
    ],
    adminOnly: true,
  },
  {
    label: 'Attendance',
    icon: CalendarDays,
    children: [
      { label: 'Register', href: '/attendance/register' },
      { label: 'Device Punches', href: '/attendance/edit-punches' },
      { label: 'Regularisation', href: '/attendance/regularisation' },
      { label: 'Shift Planner', href: '/attendance/shift-planner' },
      { label: 'Overtime', href: '/attendance/overtime' },
      { label: 'Comp Off', href: '/attendance/comp-off' },
      { label: 'Check-in Reports', href: '/attendance/checkin' },
    ],
  },
  {
    label: 'Leave',
    icon: TreePalm,
    children: [
      { label: 'Leave Requests', href: '/leave/requests' },
      { label: 'Leave Balances', href: '/leave/balances' },
      { label: 'Leave Encashment', href: '/leave/encashment' },
      { label: 'Bulk Leave Upload', href: '/leave/bulk-upload' },
    ],
    adminOnly: true,
  },
  {
    label: 'Payroll',
    icon: DollarSign,
    adminOnly: true,
    children: [
      { label: 'Process Payroll', href: '/payroll/process' },
      { label: 'Approve Payroll', href: '/payroll/approve' },
      { label: 'Salary Heads', href: '/setup/salary-heads' },
      { label: 'Salary Structure', href: '/setup/salary-structure' },
      { label: 'Increments', href: '/payroll/increments' },
      { label: 'Year-End Processing', href: '/payroll/year-end' },
      { label: 'Form-16 Documents', href: '/taxation/form16' },
      { label: 'TDS Report', href: '/reports/tds' },
    ],
  },
  {
    label: 'Reports',
    icon: FileText,
    children: [
      { label: 'Employee Report', href: '/reports/employee' },
      { label: 'Payroll Report', href: '/reports/payroll' },
      { label: 'Attendance', href: '/reports/attendance' },
      { label: 'Statutory Report', href: '/reports/statutory' },
      { label: 'Statutory Upload', href: '/reports/statutory-upload' },
      { label: 'LOP Report', href: '/reports/lop' },
      { label: 'Loan / Advance Report', href: '/reports/loans-advances' },
    ],
  },
  {
    label: 'Loans & Advances',
    icon: CreditCard,
    adminOnly: true,
    children: [
      { label: 'Loans', href: '/loans' },
      { label: 'Advances', href: '/advances' },
    ],
  },
  {
    label: 'Assets',
    icon: Package,
    adminOnly: true,
    href: '/assets',
  },
  {
    label: 'Expenses',
    icon: Receipt,
    adminOnly: true,
    href: '/expenses',
  },
  {
    label: 'Company Setup',
    icon: Building2,
    adminOnly: true,
    children: [
      { label: 'Company Profile', href: '/setup/company' },
      { label: 'Branches', href: '/setup/branches' },
      { label: 'Departments', href: '/setup/departments' },
      { label: 'Designations', href: '/setup/designations' },
      { label: 'Grades', href: '/setup/grades' },
      { label: 'Banks', href: '/setup/banks' },
      { label: 'Contacts', href: '/setup/contacts' },
      { label: 'Salary Heads', href: '/setup/salary-heads' },
      { label: 'Salary Structure', href: '/setup/salary-structure' },
      { label: 'Financial Year', href: '/setup/financial-year' },
      { label: 'Holiday Calendar', href: '/setup/holidays' },
      { label: 'Leave Types', href: '/setup/leave-types' },
      { label: 'Leave Policy', href: '/setup/leave-policy' },
      { label: 'Shifts', href: '/setup/shifts' },
      { label: 'Attendance Config', href: '/setup/attendance-config' },
      { label: 'Devices', href: '/setup/devices' },
      { label: 'Notice Period', href: '/setup/notice-periods' },
      { label: 'Division', href: '/setup/divisions' },
      { label: 'Section', href: '/setup/sections' },
      { label: 'Employee Devices', href: '/setup/employee-devices' },
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    adminOnly: true,
    children: [
      { label: 'Tax Heads', href: '/setup/tax-heads' },
      { label: 'Statutory Heads', href: '/setup/statutory-heads' },
      { label: 'Expense Types', href: '/setup/expense-types' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user.userGroup === 1;
  const [expanded, setExpanded] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

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

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
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

          if (item.href && !item.children) {
            const active = isActive(item.href);
            return (
              <div key={item.label} className={cn('relative group w-full flex', expanded ? 'justify-stretch' : 'justify-center')}>
                <Link
                  href={item.href}
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
          }

          const hasActiveChild = item.children?.some((c) => isActive(c.href));
          const isOpen = openGroups.has(item.label);

          if (expanded) {
            return (
              <div key={item.label} className="w-full">
                <button
                  onClick={() => toggleGroup(item.label)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-[180ms]',
                    hasActiveChild ? 'nav-pill-active text-[#1687E8]' : 'text-slate-400 hover:bg-slate-100/80 hover:text-slate-700'
                  )}
                >
                  <Icon className="w-[22px] h-[22px] flex-shrink-0" strokeWidth={1.75} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                {isOpen && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-slate-200 pl-3">
                    {item.children?.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          'block px-2.5 py-1.5 rounded-lg text-xs transition-colors',
                          isActive(child.href)
                            ? 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] font-medium'
                            : 'text-slate-500 hover:bg-slate-100/80'
                        )}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div key={item.label} className="relative group w-full flex justify-center">
              <button
                aria-label={item.label}
                className={cn(
                  'w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-[180ms]',
                  hasActiveChild ? 'nav-pill-active text-[#1687E8]' : 'text-slate-400 hover:bg-slate-100/80 hover:text-slate-700'
                )}
              >
                <Icon className="w-[22px] h-[22px]" strokeWidth={1.75} />
              </button>
              <div className="absolute left-full top-0 ml-3 min-w-[220px] glass-card-strong rounded-2xl p-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-[180ms] z-50">
                <p className="px-2.5 pt-1 pb-2 text-xs font-semibold text-slate-400 uppercase tracking-wide font-heading">{item.label}</p>
                <div className="space-y-0.5 max-h-[70vh] overflow-y-auto scroll-fade">
                  {item.children?.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={cn(
                        'block px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                        isActive(child.href)
                          ? 'bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)] font-medium'
                          : 'text-slate-600 hover:bg-slate-100/80'
                      )}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              </div>
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
