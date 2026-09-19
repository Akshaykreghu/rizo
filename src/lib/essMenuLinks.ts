// Maps legacy emp_menu.menu_url values (old CakePHP controller/action paths, e.g.
// "Regularisation/hierarchyindex") to the equivalent page in this app's ESS section, so
// GET /api/ess/menu-access can turn an admin's menu allocation into a real, working link
// instead of just echoing back a dead legacy path.
//
// Coverage is limited to the ~60 distinct menu items actually granted to real employees today
// (see the menu-allocation feature) that have a genuine ESS equivalent. Anything not listed here
// either has no ESS equivalent yet (team-wide reports, bulk uploads, payroll approval — these
// stay admin-only pending a real per-grant authorization review) or is a legacy container/section
// heading with no destination of its own (blank or "#" menu_url).
//
// Keyed by menu_url lowercased and trimmed.
export const ESS_MENU_LINK_MAP: Record<string, string> = {
  // Profile / personal
  employee: '/ess/about',
  'documentmanager/documentmaster': '/ess/about',

  // Leave
  leaverequests: '/ess/requests',
  leaverequest: '/ess/requests',
  'leaverequest/employeeleaves': '/ess/approvals',
  'empreport/leavepolicyreport': '/ess/requests',
  'empreport/leavedetailsreport': '/ess/requests',
  'empreport/leavedaysreport': '/ess/requests',

  // Leave encashment
  leaveencashmentrequest: '/ess/leave-encashment',

  // Attendance / regularisation
  'empreport/attendancereports': '/ess/presence',
  'employeeregister/index': '/ess/presence',
  attendanceregister: '/ess/presence',
  regularisation: '/ess/regularisation',

  // Salary / tax
  'empreport/salarystructure': '/ess/salary',
  salaryslipreports: '/ess/salary',
  'empreport/shiftpolicyreport': '/ess/about',
  'tax/tabs': '/ess/salary',
  'employeetax/tabs': '/ess/salary',

  // Expenses (self-submit only — approval/management stays admin-only)
  'employeeexpenses/expenses': '/ess/requests',
  'employeeexpenses/employeerequests': '/ess/requests',

  // Loans / advances
  employeeloan: '/ess/requests',

  // Career
  promotions: '/ess/about',

  // Holidays
  'grade/holidayreport': '/ess',
};

export function resolveMenuHref(menuUrl: string | null | undefined): string | null {
  if (!menuUrl) return null;
  return ESS_MENU_LINK_MAP[menuUrl.trim().toLowerCase()] ?? null;
}
