import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function BanksPage() {
  return (
    <SetupCrudPage
      title="Banks"
      apiPath="setup/banks"
      primaryKey="id"
      displayKey="bank_name"
      fields={[
        { key: 'bank_name', label: 'Bank Name', required: true, placeholder: 'e.g. State Bank of India' },
        { key: 'bank_branch', label: 'Branch', placeholder: 'e.g. MG Road' },
        { key: 'ifsc_code', label: 'IFSC Code', placeholder: 'e.g. SBIN0001234' },
        { key: 'acct_no', label: 'Account Number' },
      ]}
      columns={[
        { key: 'bank_name', label: 'Bank Name' },
        { key: 'bank_branch', label: 'Branch' },
        { key: 'ifsc_code', label: 'IFSC Code' },
        { key: 'acct_no', label: 'Account Number' },
      ]}
    />
  );
}
