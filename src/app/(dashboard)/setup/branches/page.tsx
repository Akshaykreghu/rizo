import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function BranchesPage() {
  return (
    <SetupCrudPage
      title="Branches"
      apiPath="setup/branches"
      primaryKey="id"
      displayKey="branch_name"
      fields={[
        { key: 'branch_name', label: 'Branch Name', required: true, placeholder: 'e.g. Head Office' },
        { key: 'address', label: 'Address', placeholder: 'Branch address' },
        { key: 'city', label: 'City' },
        { key: 'state', label: 'State' },
        { key: 'pincode', label: 'Pincode' },
      ]}
      columns={[
        { key: 'branch_code', label: 'Code' },
        { key: 'branch_name', label: 'Name' },
        { key: 'city', label: 'City' },
      ]}
    />
  );
}
