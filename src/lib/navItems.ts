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
} from 'lucide-react';

export interface NavChild {
  label: string;
  href: string;
  description: string;
  /** Groups this child under a subheading on the /menu/[slug] grid (Company Setup only, for
   * now) — cards without a section render together, unsectioned, at the top. */
  section?: string;
}

export interface NavItem {
  label: string;
  href?: string;
  /** Present when this item has children — links to /menu/[slug] instead of href. */
  slug?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children?: NavChild[];
  adminOnly?: boolean;
}

export const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Ask RIZO', href: '/assistant', icon: Sparkles },
  { label: 'AI Navigation Demo', href: '/ai-navigation', icon: Wand2 },
  {
    label: 'Employees',
    slug: 'employees',
    icon: Users,
    children: [
      { label: 'Employee', href: '/employees/join', description: 'Onboard new hires and track in-progress joinings.' },
      { label: 'Import Employee', href: '/employees/import', description: 'Bulk-import employee records from a spreadsheet.' },
      { label: 'User Access', href: '/employees/access', description: 'Manage login access and permissions for employees.' },
      { label: 'Allocate Assets', href: '/employees/assets', description: 'Assign or reclaim company assets per employee.' },
      { label: 'Allocate Policies in Bulk', href: '/employees/bulk-policies', description: 'Apply a policy to many employees at once.' },
      { label: 'Menu Allocation', href: '/employees/menu-allocation', description: 'Control which menu sections each employee can see.' },
      { label: 'Document Upload', href: '/employees/documents', description: 'Upload and manage employee documents on file.' },
      { label: 'Income Tax Declarations', href: '/employees/tax-declarations', description: 'Review employee-submitted tax declarations.' },
      { label: 'Promotion Approval', href: '/employees/promotions', description: 'Approve pending promotion and designation changes.' },
      { label: 'Generate Employee Documents', href: '/employees/generate-documents', description: 'Generate offer letters, ID cards and other documents.' },
      { label: 'Remove Employee', href: '/employees/resignations', description: 'Process resignations and offboard employees.' },
    ],
    adminOnly: true,
  },
  {
    label: 'Attendance',
    slug: 'attendance',
    icon: CalendarDays,
    children: [
      { label: 'Register', href: '/attendance/register', description: 'View daily attendance across the organization.' },
      { label: 'Regularisation', href: '/attendance/regularisation', description: 'Approve employee requests to fix missed punches.' },
      { label: 'Shift Planner', href: '/attendance/shift-planner', description: 'Assign and schedule employee work shifts.' },
      { label: 'Overtime', href: '/attendance/overtime', description: 'Track and approve overtime hours worked.' },
      { label: 'Comp Off', href: '/attendance/comp-off', description: 'Manage compensatory time-off earned and used.' },
      { label: 'Check-in Reports', href: '/attendance/checkin', description: 'View location-based check-in activity reports.' },
    ],
  },
  {
    label: 'Leave',
    slug: 'leave',
    icon: TreePalm,
    children: [
      { label: 'Leave Requests', href: '/leave/requests', description: 'Review and approve employee leave applications.' },
      { label: 'Leave Balances', href: '/leave/balances', description: 'View and adjust employee leave balances.' },
      { label: 'Leave Encashment', href: '/leave/encashment', description: 'Process encashment of unused leave days.' },
      { label: 'Bulk Leave Upload', href: '/leave/bulk-upload', description: 'Upload leave records for multiple employees at once.' },
    ],
    adminOnly: true,
  },
  {
    label: 'Payroll',
    slug: 'payroll',
    icon: DollarSign,
    adminOnly: true,
    children: [
      { label: 'Process Payroll', href: '/payroll/process', description: 'Run payroll processing for the current cycle.' },
      { label: 'Approve Payroll', href: '/payroll/approve', description: 'Review and approve processed payroll before payout.' },
      { label: 'Increments', href: '/payroll/increments', description: 'Apply salary increments and revisions.' },
      { label: 'Form-16 Documents', href: '/taxation/form16', description: 'Generate and distribute employee Form-16s.' },
      { label: 'TDS Report', href: '/reports/tds', description: 'View tax deducted at source across employees.' },
    ],
  },
  {
    label: 'Reports',
    slug: 'reports',
    icon: FileText,
    children: [
      { label: 'Employee Report', href: '/reports/employee', description: 'Generate reports on employee master data.' },
      { label: 'Payroll Report', href: '/reports/payroll', description: 'Generate reports on processed payroll runs.' },
      { label: 'Attendance', href: '/reports/attendance', description: 'Generate attendance summary reports.' },
      { label: 'Statutory Report', href: '/reports/statutory', description: 'Generate PF, ESI and other statutory reports.' },
      { label: 'Statutory Upload', href: '/reports/statutory-upload', description: 'Prepare statutory filings ready for portal upload.' },
      { label: 'LOP Report', href: '/reports/lop', description: 'View loss-of-pay days across employees.' },
      { label: 'Loan / Advance Report', href: '/reports/loans-advances', description: 'Track outstanding employee loans and advances.' },
    ],
  },
  {
    label: 'Loans & Advances',
    slug: 'loans-advances',
    icon: CreditCard,
    adminOnly: true,
    children: [
      { label: 'Loans', href: '/loans', description: 'Issue and track employee loan repayments.' },
      { label: 'Advances', href: '/advances', description: 'Issue and track employee salary advances.' },
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
    slug: 'company-setup',
    icon: Building2,
    adminOnly: true,
    children: [
      { label: 'Company Profile', href: '/setup/company', description: 'Edit company details, branches, financial year and banks.', section: 'Company' },
      { label: 'Contacts', href: '/setup/contacts', description: 'Manage company emergency and official contacts.', section: 'Company' },
      { label: 'Profession', href: '/setup/profession', description: 'Manage departments, designations, grades, notice periods, divisions and sections.', section: 'Company' },

      { label: 'Holiday', href: '/setup/holidays', description: 'Manage the company holiday calendar.', section: 'Company Policies' },
      { label: 'Leave', href: '/setup/leave', description: 'Leave types and accrual/policy rules.', section: 'Company Policies' },
      { label: 'Shift', href: '/setup/shift', description: 'Work shift timings and policy.', section: 'Company Policies' },
      { label: 'Salary', href: '/setup/salary', description: 'Salary head categories, items and structure templates.', section: 'Company Policies' },
      { label: 'Year-End Processing', href: '/payroll/year-end', description: 'Run year-end payroll closing and rollovers.', section: 'Company Policies' },

      { label: 'Devices', href: '/setup/devices', description: 'Manage biometric devices and employee-device mapping.', section: 'Devices' },
    ],
  },
  {
    label: 'Settings',
    slug: 'settings',
    icon: Settings,
    adminOnly: true,
    children: [
      { label: 'Tax Heads', href: '/setup/tax-heads', description: 'Configure income tax components and slabs.' },
      { label: 'Statutory Heads', href: '/setup/statutory-heads', description: 'Configure PF, ESI and other statutory components.' },
      { label: 'Expense Types', href: '/setup/expense-types', description: 'Manage categories used for expense claims.' },
    ],
  },
];
