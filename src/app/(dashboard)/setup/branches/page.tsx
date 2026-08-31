import { SetupCrudPage } from '@/components/setup/SetupCrudPage';
import { BRANCH_FIELDS, BRANCH_COLUMNS } from '@/lib/setupFieldConfigs';

export default function BranchesPage() {
  return (
    <SetupCrudPage
      title="Branches"
      apiPath="setup/branches"
      primaryKey="id"
      displayKey="branch_name"
      fields={BRANCH_FIELDS}
      columns={BRANCH_COLUMNS}
    />
  );
}
