import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function SectionsPage() {
  return (
    <SetupCrudPage
      title="Section"
      apiPath="setup/sections"
      primaryKey="id"
      displayKey="section_name"
      fields={[
        { key: 'section_code', label: 'Section Code', placeholder: 'e.g. SEC001' },
        { key: 'section_name', label: 'Section Name', required: true },
      ]}
      columns={[
        { key: 'section_code', label: 'Code' },
        { key: 'section_name', label: 'Name' },
      ]}
    />
  );
}
