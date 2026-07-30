import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function NoticePeriodsPage() {
  return (
    <SetupCrudPage
      title="Notice Period"
      apiPath="setup/notice-periods"
      primaryKey="notice_pkey"
      displayKey="description"
      fields={[
        { key: 'description', label: 'Description', required: true, placeholder: 'e.g. One Month' },
        { key: 'notice_days', label: 'Notice Days', type: 'number', required: true },
      ]}
      columns={[
        { key: 'description', label: 'Description' },
        { key: 'notice_days', label: 'Days' },
      ]}
    />
  );
}
