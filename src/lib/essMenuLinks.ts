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
  'empreportnew/leavedetailsreport': '/ess/requests',
  'empreport/leavedaysreport': '/ess/requests',

  // Leave encashment
  leaveencashmentrequest: '/ess/leave-encashment',

  // Attendance / regularisation
  'empreport/attendancereports': '/ess/presence',
  'empreportnew/attendancereports': '/ess/presence',
  'employeeregister/index': '/ess/presence',
  attendanceregister: '/ess/presence',
  regularisation: '/ess/regularisation',

  // Salary / tax
  'empreport/salarystructure': '/ess/salary',
  'empreportnew/salarystructure': '/ess/salary',
  salaryslipreports: '/ess/salary',
  'empreport/shiftpolicyreport': '/ess/about',
  'empreportnew/shiftpolicyreport': '/ess/about',
  'tax/tabs': '/ess/salary',
  'employeetax/tabs': '/ess/salary',

  // Expenses (self-submit only — approval/management stays admin-only)
  'employeeexpenses/expenses': '/ess/requests',
  'employeeexpenses/employeerequests': '/ess/requests',

  // Loans / advances
  employeeloan: '/ess/requests',
  'employeeloan/myloan': '/ess/requests',

  // Career
  promotions: '/ess/about',

  // Holidays
  'grade/holidayreport': '/ess',
};

export function resolveMenuHref(menuUrl: string | null | undefined): string | null {
  if (!menuUrl) return null;
  return ESS_MENU_LINK_MAP[menuUrl.trim().toLowerCase()] ?? null;
}

// Which optional ESS navbar tabs show, driven by the employee's real menu-allocation grants
// (see /api/ess/menu-access) instead of every employee always seeing every tab. Home / About Me /
// My Team are not gated — every user-group-2 login gets those three regardless of allocation.
// Each key lists the real emp_menu.menu_url values (lowercased) that unlock that tab; a tab shows
// if the employee has been granted ANY one of its listed urls.
//
// Two url spellings appear for the same report across companies/imports — an older
// "empreport/..." form (seen in this machine's local mypayrol_mpm121 dump) and the canonical
// "empreportNew/..." form from the real emp_menu seed data — so both are listed per item.
export const TAB_MENU_GATES: Record<string, string[]> = {
  // My Presence — the "Attendance Register" report (emp_menu id 93).
  presence: ['employeeregister/index'],
  // My Salary — the "Salary" report (emp_menu id 23).
  salary: ['empreport/salarystructure', 'empreportnew/salarystructure'],
  // My Requests — any one of: My Leave Requests (21), Attendance Regularisation (99/1108),
  // Expense Requests (98), Resignation Request (43).
  requests: ['leaverequest', 'regularisation', 'employeeexpenses/employeerequests', 'resignationrequest'],
  // Approvals — Team Leave Requests (emp_menu id 22).
  approvals: ['leaverequest/employeeleaves'],
  // Reports — any one of: My Shift Timings (24), Leave Details Report (28), SalarySlip Reports
  // (30), My Loans (40), Tracking Reports (1155), My Asset (1284).
  reports: [
    'empreport/shiftpolicyreport',
    'empreportnew/shiftpolicyreport',
    'empreport/leavedetailsreport',
    'empreportnew/leavedetailsreport',
    'salaryslipreports',
    'employeeloan',
    'employeeloan/myloan',
    'trackingreports/hrreports',
    'asset/empview',
  ],
};
