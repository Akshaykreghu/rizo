import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function DivisionsPage() {
  return (
    <SetupCrudPage
      title="Division"
      apiPath="setup/divisions"
      primaryKey="id"
      displayKey="div_name"
      fields={[
        { key: 'div_code', label: 'Division Code', placeholder: 'e.g. DIV001' },
        { key: 'div_name', label: 'Division Name', required: true },
      ]}
      columns={[
        { key: 'div_code', label: 'Code' },
        { key: 'div_name', label: 'Name' },
      ]}
    />
  );
}
