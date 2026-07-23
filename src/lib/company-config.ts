// Per-company feature flags extracted from legacy hard-coded if-else chains.
// Long-term: replace with plan_feature records in control DB.

export interface CompanyConfig {
  showHierarchyDashboard: boolean;
  useAbsHierarchyBranch: boolean;  // use get_branch_code_abs_fn for filtering
  siteManagementEnabled: boolean;
  incrementNotifications: boolean;
  siteEndDateNotifications: boolean;
}

export function getCompanyConfig(companyCode: string): CompanyConfig {
  const code = companyCode.toUpperCase();
  return {
    showHierarchyDashboard: ['GLET', 'ABSG'].includes(code),
    useAbsHierarchyBranch: ['ABSG', 'GLET', 'GAAR'].includes(code),
    siteManagementEnabled: ['VGFS', 'VSFS', 'GEDE', 'ABSG', 'DEMO', 'GLET'].includes(code),
    incrementNotifications: ['DEMO', 'GLET'].includes(code),
    siteEndDateNotifications: ['VGFS', 'VSFS', 'GEDE', 'ABSG', 'DEMO', 'GLET'].includes(code),
  };
}
