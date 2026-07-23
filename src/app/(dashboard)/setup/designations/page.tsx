import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function DesignationsPage() {
  return (
    <SetupCrudPage
      title="Designations"
      apiPath="setup/designations"
      primaryKey="id"
      displayKey="desig_name"
      fields={[
        { key: 'desig_name', label: 'Designation Name', required: true, placeholder: 'e.g. Software Engineer' },
        { key: 'desig_code', label: 'Code', placeholder: 'e.g. SWE' },
      ]}
      columns={[
        { key: 'desig_code', label: 'Code' },
        { key: 'desig_name', label: 'Name' },
      ]}
    />
  );
}
