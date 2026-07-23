import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function GradesPage() {
  return (
    <SetupCrudPage
      title="Grades"
      apiPath="setup/grades"
      primaryKey="grade_pkey"
      displayKey="grade_name"
      fields={[
        { key: 'grade_name', label: 'Grade Name', required: true, placeholder: 'e.g. Senior' },
        { key: 'grade_code', label: 'Code', placeholder: 'e.g. SR' },
      ]}
      columns={[
        { key: 'grade_code', label: 'Code' },
        { key: 'grade_name', label: 'Name' },
      ]}
    />
  );
}
