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
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Package,
  Receipt,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

const COLLAPSED_STORAGE_KEY = 'rizo-sidebar-collapsed';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
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
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (stored) setCollapsed(stored === 'true');
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next));
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
        'glass-panel flex-shrink-0 text-slate-600 flex flex-col h-full overflow-y-auto transition-[width] duration-200 m-3 mr-0 rounded-3xl shadow-xl shadow-indigo-100/40',
        collapsed ? 'w-[76px]' : 'w-64'
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex items-center border-b border-slate-200/70 py-5',
          collapsed ? 'justify-center px-2' : 'justify-between px-5'
        )}
      >
        <div className={cn('flex items-center gap-3', collapsed && 'flex-col gap-2')}>
          <div className="w-9 h-9 rounded-full brand-ring p-[2px] flex-shrink-0">
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center text-xs font-bold text-indigo-600">
              R
            </div>
          </div>
          {!collapsed && (
            <div>
              <span className="text-lg font-bold text-slate-800 tracking-tight">RIZO</span>
              <p className="text-[11px] text-slate-400 -mt-0.5">HR & Payroll</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={toggleCollapsed}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
        )}
      </div>
      {collapsed && (
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="mx-auto mt-2 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;

          if (item.href && !item.children) {
            const active = isActive(item.href);
            return (
              <Link
                key={item.label}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-2',
                  active
                    ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md shadow-indigo-200'
                    : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-800'
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
          }

          const isOpen = openGroups.has(item.label);
          const hasActiveChild = item.children?.some((c) => isActive(c.href));

          return (
            <div key={item.label}>
              <button
                onClick={() => {
                  if (collapsed) {
                    setCollapsed(false);
                    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, 'false');
                    if (!openGroups.has(item.label)) toggleGroup(item.label);
                  } else {
                    toggleGroup(item.label);
                  }
                }}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-2',
                  hasActiveChild
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-800'
                )}
              >
                <Icon className={cn('w-4 h-4 flex-shrink-0', hasActiveChild && 'text-indigo-600')} />
                {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                {!collapsed &&
                  (isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ))}
              </button>
              {!collapsed && isOpen && (
                <div className="ml-7 mt-1 space-y-0.5 border-l border-slate-200 pl-3">
                  {item.children?.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={cn(
                        'block px-3 py-1.5 rounded-lg text-xs transition-colors',
                        isActive(child.href)
                          ? 'bg-indigo-100 text-indigo-700 font-medium'
                          : 'text-slate-400 hover:bg-slate-100/80 hover:text-slate-700'
                      )}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
