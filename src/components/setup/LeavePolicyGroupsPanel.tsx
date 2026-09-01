'use client';

import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export function LeavePolicyGroupsPanel() {
  return (
    <SetupCrudPage
      hideTitle
      title="Leave Policy Groups"
      apiPath="setup/leavepolicy-groups"
      primaryKey="LEAVEPOLICY_GROUP_ID"
      displayKey="LEAVEPOLICY_GROUP_NAME"
      fields={[{ key: 'LEAVEPOLICY_GROUP_NAME', label: 'Leave Policy Group Name', required: true }]}
      columns={[{ key: 'LEAVEPOLICY_GROUP_NAME', label: 'Group Name' }]}
    />
  );
}
