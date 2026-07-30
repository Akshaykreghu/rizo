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
  CreditCard,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface NavItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { label: string; href: string }[];
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    label: 'Employees',
    icon: Users,
    children: [
      { label: 'All Employees', href: '/employees' },
      { label: 'Add Employee', href: '/employees/new' },
      { label: 'Employee Join', href: '/employees/join' },
      { label: 'Import Employee', href: '/employees/import' },
      { label: 'User Access', href: '/employees/access' },
      { label: 'Allocate Assets', href: '/employees/assets' },
      { label: 'Allocate Policies in Bulk', href: '/employees/bulk-policies' },
      { label: 'Menu Allocation', href: '/employees/menu-allocation' },
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
    ],
  },
  {
    label: 'Settings',
    icon: Settings,
    adminOnly: true,
    children: [
      { label: 'Tax Heads', href: '/setup/tax-heads' },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = session?.user.userGroup === 1;
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

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
    <aside className="w-64 flex-shrink-0 bg-gray-900 text-gray-200 flex flex-col h-full overflow-y-auto">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-gray-700">
        <span className="text-xl font-bold text-white">RIZO</span>
        <p className="text-xs text-gray-400 mt-0.5">HR & Payroll</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;

          if (item.href && !item.children) {
            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive(item.href)
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
              </Link>
            );
          }

          const isOpen = openGroups.has(item.label);
          const hasActiveChild = item.children?.some((c) => isActive(c.href));

          return (
            <div key={item.label}>
              <button
                onClick={() => toggleGroup(item.label)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  hasActiveChild
                    ? 'text-white bg-gray-800'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
              {isOpen && (
                <div className="ml-7 mt-1 space-y-0.5">
                  {item.children?.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={cn(
                        'block px-3 py-1.5 rounded-lg text-xs transition-colors',
                        isActive(child.href)
                          ? 'bg-indigo-600 text-white font-medium'
                          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
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
