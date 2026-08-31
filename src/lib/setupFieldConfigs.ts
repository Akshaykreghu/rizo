import type { FieldDef } from '@/components/setup/SetupCrudPage';

/** Shared field/column definitions for the setup CRUD screens that are also embedded as
 * Company Profile tabs (Branches, Financial Year, Banks) — kept here so the standalone
 * /setup/* routes and the Company Profile tabs stay in sync. */

export const BRANCH_FIELDS: FieldDef[] = [
  { key: 'branch_name', label: 'Branch Name', required: true, placeholder: 'e.g. Head Office' },
  { key: 'address', label: 'Address', placeholder: 'Branch address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'pincode', label: 'Pincode' },
];

export const BRANCH_COLUMNS = [
  { key: 'branch_code', label: 'Code' },
  { key: 'branch_name', label: 'Name' },
  { key: 'city', label: 'City' },
];

export const BANK_FIELDS: FieldDef[] = [
  { key: 'bank_name', label: 'Bank Name', required: true, placeholder: 'e.g. State Bank of India' },
  { key: 'bank_branch', label: 'Branch', placeholder: 'e.g. MG Road' },
  { key: 'ifsc_code', label: 'IFSC Code', placeholder: 'e.g. SBIN0001234' },
  { key: 'acct_no', label: 'Account Number' },
];

export const BANK_COLUMNS = [
  { key: 'bank_name', label: 'Bank Name' },
  { key: 'bank_branch', label: 'Branch' },
  { key: 'ifsc_code', label: 'IFSC Code' },
  { key: 'acct_no', label: 'Account Number' },
];

interface BranchOption {
  branch_code: string;
  branch_name: string;
}

export function financialYearFields(branches: BranchOption[]): FieldDef[] {
  return [
    { key: 'start_month', label: 'Year Start', type: 'date', required: true },
    { key: 'end_month', label: 'Year End', type: 'date', required: true },
    {
      key: 'branch_code',
      label: 'Branch',
      type: 'select',
      required: true,
      options: branches.map((b) => ({ value: b.branch_code, label: b.branch_name })),
    },
    {
      key: 'Year_status',
      label: 'Status',
      type: 'select',
      required: true,
      options: [
        { value: 'OPEN', label: 'Open' },
        { value: 'CLOSED', label: 'Closed' },
      ],
    },
    {
      key: 'vattr1',
      label: 'Type',
      type: 'select',
      required: true,
      options: [
        { value: '0', label: 'Leave' },
        { value: '1', label: 'Financial' },
      ],
    },
    { key: 'is_current_finyear', label: 'Is Current Financial Year', type: 'checkbox' },
  ];
}

export const FINANCIAL_YEAR_COLUMNS = [
  { key: 'branch_name', label: 'Branch' },
  { key: 'fin_year', label: 'Year' },
  { key: 'start_month', label: 'Start' },
  { key: 'end_month', label: 'End' },
  { key: 'Year_status', label: 'Status' },
  { key: 'type_label', label: 'Type' },
];
