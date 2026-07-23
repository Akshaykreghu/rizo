import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function DepartmentsPage() {
  return (
    <SetupCrudPage
      title="Departments"
      apiPath="setup/departments"
      primaryKey="id"
      displayKey="dept_name"
      fields={[
        { key: 'dept_name', label: 'Department Name', required: true, placeholder: 'e.g. Engineering' },
        { key: 'dept_code', label: 'Department Code', placeholder: 'e.g. ENG' },
      ]}
      columns={[
        { key: 'dept_code', label: 'Code' },
        { key: 'dept_name', label: 'Name' },
      ]}
    />
  );
}
