import { SetupCrudPage } from '@/components/setup/SetupCrudPage';

export default function ExpenseTypesPage() {
  return (
    <SetupCrudPage
      title="Expense Types"
      apiPath="setup/expense-types"
      primaryKey="expense_type_pkey"
      displayKey="expense_type_name"
      fields={[
        { key: 'expense_type_name', label: 'Expense Type Name', required: true, placeholder: 'e.g. Travelling Allowance' },
        { key: 'expense_type_code', label: 'Code', placeholder: 'e.g. TA' },
      ]}
      columns={[
        { key: 'expense_type_code', label: 'Code' },
        { key: 'expense_type_name', label: 'Name' },
      ]}
    />
  );
}
