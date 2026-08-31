import { SetupCrudPage } from '@/components/setup/SetupCrudPage';
import { BANK_FIELDS, BANK_COLUMNS } from '@/lib/setupFieldConfigs';

export default function BanksPage() {
  return (
    <SetupCrudPage
      title="Banks"
      apiPath="setup/banks"
      primaryKey="id"
      displayKey="bank_name"
      fields={BANK_FIELDS}
      columns={BANK_COLUMNS}
    />
  );
}
